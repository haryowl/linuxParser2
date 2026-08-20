const express = require('express');
const router = express.Router();
const { Record, Device } = require('../models');
const { Op } = require('sequelize');
const { Parser: Json2csvParser } = require('json2csv');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const logger = require('../utils/logger');
const { requireAuth } = require('./auth');
const { checkMenuAccess } = require('../middleware/permissions');
const { formatDateTimeYmdHms, cellValue } = require('../utils/formatDateTime');

router.use(requireAuth);
router.use(checkMenuAccess('data-sm'));

// Store auto-export configurations
const autoExportConfigs = new Map();


// File path for storing auto-export configs
const CONFIG_FILE = path.join(__dirname, '../../data/auto-export-configs.json');

// Load configs from file on startup
function loadConfigs() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            const configs = JSON.parse(data);
            logger.info('Loaded auto-export configs from file', { count: configs.length });
            return configs;
        }
    } catch (error) {
        logger.error('Error loading auto-export configs:', error);
    }
    return [];
}

// Save configs to file
function saveConfigs() {
    try {
        // Ensure data directory exists
        const dataDir = path.dirname(CONFIG_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        const configs = Array.from(autoExportConfigs.entries()).map(([jobId, config]) => ({
            jobId,
            type: config.type,
            time: config.time,
            times: config.times, // Support multiple times
            hoursBack: config.hoursBack, // Time range configuration
            devices: config.devices,
            fields: config.fields,
            customHeaders: config.customHeaders
        }));
        
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
        logger.info('Saved auto-export configs to file', { count: configs.length });
    } catch (error) {
        logger.error('Error saving auto-export configs:', error);
    }
}

// Initialize configs from file on startup
const savedConfigs = loadConfigs();
savedConfigs.forEach(config => {
    if (config.type === 'data-sm') {
        // Support both old format (single time) and new format (multiple times)
        const times = config.times || (config.time ? [config.time] : []);
        const hoursBack = config.hoursBack || 24; // Default to 24 hours (yesterday)
        
        // Create a cron job for each time
        const jobs = [];
        times.forEach(time => {
            const [hour, minute] = time.split(':').map(Number);
            const cronExpression = `${minute} ${hour} * * *`;
            
            const job = cron.schedule(cronExpression, async () => {
                await performDataSMAutoExport(
                    config.devices, 
                    config.fields, 
                    config.customHeaders, 
                    config.jobId,
                    hoursBack
                );
            }, {
                scheduled: true,
                timezone: "UTC"
            });
            
            jobs.push({ time, job });
        });
        
        autoExportConfigs.set(config.jobId, {
            type: config.type,
            time: times[0] || '00:00', // Keep for backward compatibility
            times: times,
            hoursBack: hoursBack,
            devices: config.devices,
            fields: config.fields,
            customHeaders: config.customHeaders,
            jobs: jobs // Array of jobs
        });
        
        logger.info('Restored auto-export job', { 
            jobId: config.jobId, 
            times: times,
            hoursBack: hoursBack 
        });
    }
});


// Configure auto-export for Data SM
// Enhanced to support multiple schedules per day and configurable time range
router.post('/sm', async (req, res) => {
    try {
        const { enabled, time, times, hoursBack, devices, fields, customHeaders } = req.body;
        
        logger.info('Auto-export request received', {
            enabled,
            time,
            times,
            hoursBack,
            devicesCount: devices?.length || 0,
            fieldsCount: fields?.length || 0
        });
        
        if (enabled) {
            // Support both old format (single time) and new format (multiple times)
            const exportTimes = times || (time ? [time] : ['00:00']);
            const timeRange = hoursBack || 24; // Default to 24 hours if not specified
            
            // Validate hoursBack (must be between 1 and 168 hours = 7 days)
            if (timeRange < 1 || timeRange > 168) {
                return res.status(400).json({ 
                    error: 'Time range (hoursBack) must be between 1 and 168 hours (7 days)' 
                });
            }
            
            // Stop and remove all existing data-sm jobs
            for (const [jobId, config] of autoExportConfigs.entries()) {
                if (config.type === 'data-sm') {
                    if (config.jobs) {
                        config.jobs.forEach(({ job }) => job.stop());
                    } else if (config.job) {
                        config.job.stop(); // Backward compatibility
                    }
                    autoExportConfigs.delete(jobId);
                }
            }
            
            // Create new job ID
            const jobId = `data-sm-${Date.now()}`;
            
            // Create a cron job for each time
            const jobs = [];
            exportTimes.forEach(exportTime => {
                const [hour, minute] = exportTime.split(':').map(Number);
                
                if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
                    logger.warn('Invalid time format, skipping', { exportTime });
                    return;
                }
                
                const cronExpression = `${minute} ${hour} * * *`; // Daily at specified time
                
                const job = cron.schedule(cronExpression, async () => {
                    await performDataSMAutoExport(devices, fields, customHeaders, jobId, timeRange);
                }, {
                    scheduled: true,
                    timezone: "UTC"
                });
                
                jobs.push({ time: exportTime, job });
            });
            
            if (jobs.length === 0) {
                return res.status(400).json({ error: 'No valid export times provided' });
            }
            
            // Store configuration
            autoExportConfigs.set(jobId, {
                type: 'data-sm',
                time: exportTimes[0], // Keep for backward compatibility
                times: exportTimes,
                hoursBack: timeRange,
                devices,
                fields,
                customHeaders,
                jobs: jobs
            });
            
            logger.debug('Stored auto-export configuration', { 
                jobId, 
                times: exportTimes,
                hoursBack: timeRange,
                jobsCount: jobs.length
            });
            
            // Save configs to file
            saveConfigs();
            logger.info('Auto-export scheduled for Data SM', { 
                times: exportTimes, 
                hoursBack: timeRange,
                jobId 
            });
            res.json({ 
                success: true, 
                message: `Auto-export scheduled for Data SM at ${exportTimes.join(', ')} UTC (${timeRange} hours back)`,
                jobId,
                times: exportTimes,
                hoursBack: timeRange
            });
        } else {
            // Disable auto-export
            for (const [jobId, config] of autoExportConfigs.entries()) {
                if (config.type === 'data-sm') {
                    if (config.jobs) {
                        config.jobs.forEach(({ job }) => job.stop());
                    } else if (config.job) {
                        config.job.stop(); // Backward compatibility
                    }
                    autoExportConfigs.delete(jobId);
                }
            }
            saveConfigs();
            logger.info('Auto-export disabled for Data SM');
            res.json({ 
                success: true, 
                message: 'Auto-export disabled for Data SM' 
            });
        }
    } catch (error) {
        logger.error('Error configuring auto-export:', error);
        res.status(500).json({ error: 'Failed to configure auto-export' });
    }
});

// Get auto-export status
// Enhanced to return multiple schedules and time range
router.get('/status', async (req, res) => {
    try {
        const status = [];
        // Get only the latest Data SM config (most recent jobId)
        let latestDataSMConfig = null;
        let latestJobId = null;
        
        for (const [jobId, config] of autoExportConfigs.entries()) {
            if (config.type === 'data-sm') {
                if (!latestJobId || jobId > latestJobId) {
                    latestDataSMConfig = config;
                    latestJobId = jobId;
                }
            }
        }
        
        if (latestDataSMConfig) {
            status.push({
                jobId: latestJobId,
                type: latestDataSMConfig.type,
                time: latestDataSMConfig.time, // Backward compatibility
                times: latestDataSMConfig.times || (latestDataSMConfig.time ? [latestDataSMConfig.time] : []),
                hoursBack: latestDataSMConfig.hoursBack || 24, // Default to 24 if not set
                devices: latestDataSMConfig.devices,
                enabled: true
            });
        }
        
        res.json(status);
    } catch (error) {
        logger.error('Error getting auto-export status:', error);
        res.status(500).json({ error: 'Failed to get auto-export status' });
    }
});

// Perform Data SM auto-export
// Enhanced to support: 1 file per day, same filename for all schedules on same day (overwrites)
// hoursBack represents number of days to export (each day = 24 hours)
async function performDataSMAutoExport(devices, fields, customHeaders, jobId, hoursBack = 24) {
    logger.info('Auto-export triggered', { 
        timestamp: new Date().toISOString(),
        devicesCount: devices?.length || 0,
        fieldsCount: fields?.length || 0,
        hoursBack: hoursBack,
        jobId 
    });
    
    const startTime = Date.now();
    let totalRecordsCount = 0;
    let filesGenerated = 0;
    const generatedFiles = [];
    
    try {
        // Calculate number of days (hoursBack represents days, each day = 24 hours)
        const days = Math.ceil(hoursBack / 24);
        
        logger.info('Starting Data SM auto-export', { 
            mode: '1 file per day (24 hours each)',
            days: days,
            hoursBack: hoursBack
        });
        
        // Create exports directory if it doesn't exist
        const exportsDir = path.join(__dirname, '../../exports');
        if (!fs.existsSync(exportsDir)) {
            fs.mkdirSync(exportsDir, { recursive: true });
        }
        
        // Get device information with group details (same as manual export)
        const { DeviceGroup } = require('../models');
        
        // Get device information for all target devices
        // If no devices specified, get all devices
        let deviceRecords;
        if (!devices || devices.length === 0) {
            deviceRecords = await Device.findAll({
                include: [{
                    model: DeviceGroup,
                    as: 'group',
                    attributes: ['name']
                }],
                attributes: ['imei', 'name']
            });
        } else {
            deviceRecords = await Device.findAll({
                where: { imei: devices },
                include: [{
                    model: DeviceGroup,
                    as: 'group',
                    attributes: ['name']
                }],
                attributes: ['imei', 'name']
            });
        }
        
        // Process each device separately
        for (const deviceRecord of deviceRecords) {
            try {
                const deviceImei = deviceRecord.imei;
                const groupName = deviceRecord.group ? deviceRecord.group.name : 'Unknown';
                const deviceName = deviceRecord.name || deviceRecord.imei;
                
                // Process each day separately (from today going back)
                for (let dayOffset = 0; dayOffset < days; dayOffset++) {
                    // Calculate day boundaries in LOCAL time (00:00:00 to 23:59:59 for same calendar date)
                    const now = new Date();
                    const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset);
                    
                    // Start of day: 00:00:00.000
                    const dayStart = new Date(targetDate);
                    dayStart.setHours(0, 0, 0, 0);
                    
                    // End of day: 23:59:59.999
                    const dayEnd = new Date(targetDate);
                    dayEnd.setHours(23, 59, 59, 999);
                    
                    // Generate filename for this day (without timestamp - same for all schedules)
                    // Use local date components to match the actual calendar day
                    const dateStr = `${String(targetDate.getDate()).padStart(2, '0')}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${targetDate.getFullYear()}`;
                    const filename = `${groupName}_${deviceName}_${dateStr}.pfsl`;
                    const filepath = path.join(exportsDir, filename);
                    
                    logger.debug('Processing day', {
                        deviceImei,
                        dayOffset,
                        dateStr,
                        dayStart: dayStart.toISOString(),
                        dayEnd: dayEnd.toISOString(),
                        filename
                    });
                    
                    // Query records for this specific device and day
                    const records = await Record.findAll({
                        where: {
                            deviceImei: deviceImei,
                            datetime: { 
                                [Op.gte]: dayStart,
                                [Op.lte]: dayEnd
                            }
                        },
                        order: [['datetime', 'DESC']] // Same as manual export
                    });
                    
                    // Filter records to ensure they belong to the same calendar date (safety check)
                    // Also filter out records that only have IMEI and timestamp (same as manual export)
                    const filteredRecords = records.filter(record => {
                        // First, ensure the record's datetime falls within the target calendar date
                        if (record.datetime) {
                            const recordDate = new Date(record.datetime);
                            const recordYear = recordDate.getFullYear();
                            const recordMonth = recordDate.getMonth();
                            const recordDay = recordDate.getDate();
                            
                            // Check if record's date matches target date (all in local time)
                            if (recordYear !== targetDate.getFullYear() || 
                                recordMonth !== targetDate.getMonth() || 
                                recordDay !== targetDate.getDate()) {
                                return false; // Skip records not from this calendar date
                            }
                        }
                        
                        // Filter out records that only have IMEI and timestamp (same as manual export)
                        const hasGPS = record.latitude !== null && record.latitude !== undefined && 
                                      record.longitude !== null && record.longitude !== undefined;
                        const hasAltitude = record.altitude !== null && record.altitude !== undefined;
                        const hasSatellites = record.satellites !== null && record.satellites !== undefined;
                        const hasSpeed = record.speed !== null && record.speed !== undefined;
                        const hasSensorData = (record.userData0 !== null && record.userData0 !== undefined) ||
                                            (record.userData1 !== null && record.userData1 !== undefined) ||
                                            (record.userData2 !== null && record.userData2 !== undefined) ||
                                            (record.modbus0 !== null && record.modbus0 !== undefined);
                        
                        return hasGPS || hasAltitude || hasSatellites || hasSpeed || hasSensorData;
                    });
                    
                    if (filteredRecords.length === 0) {
                        logger.debug('No records found for device/day during auto-export', { 
                            deviceImei, 
                            dateStr 
                        });
                        continue; // Skip this day if no records
                    }
                    
                    // Transform data with custom headers and date formatting (same as manual export)
                    const transformedData = filteredRecords.map(record => {
                        const transformed = {};
                        
                        // Map each field to its custom header with proper formatting
                        Object.keys(customHeaders).forEach(field => {
                            switch (field) {
                                case 'deviceImei':
                                    transformed[customHeaders[field]] = record.deviceImei;
                                    break;
                                case 'datetime':
                                    // Same Asia/Jakarta wall clock as Data SM preview / manual export
                                    transformed[customHeaders[field]] = formatDateTimeYmdHms(record.datetime);
                                    break;
                                case 'latitude':
                                    transformed[customHeaders[field]] = cellValue(record.latitude);
                                    break;
                                case 'longitude':
                                    transformed[customHeaders[field]] = cellValue(record.longitude);
                                    break;
                                case 'altitude':
                                    transformed[customHeaders[field]] = cellValue(record.altitude);
                                    break;
                                case 'satellites':
                                    transformed[customHeaders[field]] = cellValue(record.satellites);
                                    break;
                                case 'speed':
                                    transformed[customHeaders[field]] = cellValue(record.speed);
                                    break;
                                case 'userData0':
                                    transformed[customHeaders[field]] = cellValue(record.userData0);
                                    break;
                                case 'userData1':
                                    transformed[customHeaders[field]] = cellValue(record.userData1);
                                    break;
                                case 'userData2':
                                    transformed[customHeaders[field]] = cellValue(record.userData2);
                                    break;
                                case 'modbus0':
                                    transformed[customHeaders[field]] = cellValue(record.modbus0);
                                    break;
                                default:
                                    transformed[customHeaders[field]] = cellValue(record[field]);
                            }
                        });
                        return transformed;
                    });
                    
                    // Generate CSV without headers - Manual approach to avoid quotes (same as manual export)
                    const headers = Object.values(customHeaders);
                    let csv = '';
                    
                    transformedData.forEach(row => {
                        const values = headers.map(header => {
                            const value = row[header];
                            return value !== null && value !== undefined ? value : '';
                        });
                        csv += values.join(';') + '\n';
                    });
                    
                    // Write file (will overwrite if exists - same filename for all schedules on same day)
                    fs.writeFileSync(filepath, csv);
                    
                    totalRecordsCount += filteredRecords.length;
                    filesGenerated++;
                    generatedFiles.push({
                        filename,
                        recordsCount: filteredRecords.length,
                        fileSize: csv.length,
                        dateStr
                    });
                    
                    logger.info('Device/day export completed', { 
                        filename, 
                        recordsCount: filteredRecords.length,
                        deviceImei,
                        dateStr
                    });
                }
                
            } catch (deviceError) {
                logger.error('Error processing device during auto-export', { 
                    deviceImei: deviceRecord.imei,
                    error: deviceError.message 
                });
            }
        }
        
        const duration = Date.now() - startTime;
        
        logger.info('Data SM auto-export completed successfully', {
            filesGenerated,
            totalRecordsCount,
            duration: `${duration}ms`,
            daysProcessed: days,
            generatedFiles: generatedFiles.map(f => `${f.filename} (${f.recordsCount} records)`)
        });
        
    } catch (error) {
        const duration = Date.now() - startTime;
        
        logger.error('Error during Data SM auto-export', {
            error: error.message,
            stack: error.stack,
            duration: `${duration}ms`
        });
        
        throw error;
    }
}

module.exports = router; 





