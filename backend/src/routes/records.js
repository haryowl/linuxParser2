const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { Record, Device, DeviceGroup, UserDeviceAccess, UserDeviceGroupAccess } = require('../models');
const { Op } = require('sequelize');
const { Parser: Json2csvParser } = require('json2csv');
const ExcelJS = require('exceljs');
const { requireAuth } = require('./auth');
const { filterDevicesByPermission } = require('../middleware/permissions');
const logger = require('../utils/logger');
const { appendTimeRangeFilter, effectiveTimeOrderDesc } = require('../utils/recordTimeQuery');

const EXPORT_MAX_ROWS = 50000;
const PREVIEW_MAX_ROWS = 1000;
const DEFAULT_RECORDS_RANGE = process.env.DASHBOARD_RECORDS_RANGE || '24h';
const DEFAULT_RECORDS_LIMIT = Number.parseInt(process.env.DASHBOARD_RECORDS_LIMIT, 10) || 500;

function buildMergeKey(record) {
    const deviceImei = record.deviceImei || '';
    const keyParts = [deviceImei];

    if (record.recordNumber !== null && record.recordNumber !== undefined) {
        keyParts.push(`r:${record.recordNumber}`);
    }

    if (record.datetime) {
        const ts = new Date(record.datetime).getTime();
        keyParts.push(`d:${isNaN(ts) ? record.datetime : ts}`);
    }

    if (record.milliseconds !== null && record.milliseconds !== undefined) {
        keyParts.push(`ms:${record.milliseconds}`);
    }

    if (record.id !== null && record.id !== undefined) {
        keyParts.push(`i:${record.id}`);
    }

    return keyParts.join('|');
}

function mergeRecords(records) {
    const merged = new Map();
    for (const item of records) {
        const row = typeof item.toJSON === 'function' ? item.toJSON() : item;
        const key = buildMergeKey(row);
        if (!merged.has(key)) {
            merged.set(key, { ...row });
            continue;
        }
        const existing = merged.get(key);
        for (const [field, value] of Object.entries(row)) {
            if ((existing[field] === null || existing[field] === undefined) && value !== null && value !== undefined) {
                existing[field] = value;
            }
        }
    }
    return Array.from(merged.values());
}

async function getAccessibleDeviceImeis(req) {
    const user = req.user;
    if (!user) {
        return [];
    }

    if (user.role === 'admin') {
        const devices = await Device.findAll({ attributes: ['imei'] });
        return devices.map(device => device.imei);
    }

    const permissions = req.userPermissions || user.permissions || {};
    const accessibleDeviceImeis = new Set();

    if (permissions.devices && permissions.devices.length > 0) {
        permissions.devices.forEach(imei => accessibleDeviceImeis.add(imei));
    }

    if (permissions.deviceGroups && permissions.deviceGroups.length > 0) {
        const deviceGroups = await DeviceGroup.findAll({
            where: { id: permissions.deviceGroups },
            include: ['devices']
        });
        for (const group of deviceGroups) {
            if (group.devices) {
                group.devices.forEach(device => accessibleDeviceImeis.add(device.imei));
            }
        }
    }

    const userDeviceAccess = await UserDeviceAccess.findAll({
        where: {
            userId: user.userId,
            isActive: true
        },
        include: [
            {
                model: Device,
                as: 'device',
                attributes: ['imei']
            }
        ]
    });

    for (const access of userDeviceAccess) {
        if (access.device) {
            accessibleDeviceImeis.add(access.device.imei);
        }
    }

    const userGroupAccess = await UserDeviceGroupAccess.findAll({
        where: {
            userId: user.userId,
            isActive: true
        },
        include: [
            {
                model: DeviceGroup,
                as: 'group',
                include: ['devices']
            }
        ]
    });

    for (const access of userGroupAccess) {
        if (access.group && access.group.devices) {
            access.group.devices.forEach(device => accessibleDeviceImeis.add(device.imei));
        }
    }

    return Array.from(accessibleDeviceImeis);
}

// Get records with optional date filtering - WITH USER PERMISSIONS
router.get('/', requireAuth, filterDevicesByPermission, async (req, res) => {
    try {
        const requestStart = Date.now();
        logger.debug('GET /api/records - Starting request', { username: req.user.username });
        
        let { startDate, endDate, limit = DEFAULT_RECORDS_LIMIT, range, imeis, offset: offsetParam, paginated } = req.query;
        const isPaginated = paginated === '1' || paginated === 'true';
        const queryOffset = Math.max(0, parseInt(offsetParam, 10) || 0);
        const where = {};
        const now = new Date();
        
        let accessibleDeviceImeis = req.accessibleDeviceImeis;

        if (accessibleDeviceImeis === null) {
            logger.debug('Admin user - getting all records');
        } else {
            accessibleDeviceImeis = accessibleDeviceImeis || [];
            if (accessibleDeviceImeis.length > 0) {
                where.deviceImei = { [Op.in]: accessibleDeviceImeis };
            } else {
                where.deviceImei = { [Op.in]: [] };
            }
            logger.debug('User device access applied', { deviceCount: accessibleDeviceImeis.length });
        }
        
        // Better defaults to prevent massive queries
        if (!range && !startDate && !endDate) {
            range = DEFAULT_RECORDS_RANGE;
        }
        
        if (range === '24h') {
            startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            endDate = now;
        } else if (range === '1h') {
            startDate = new Date(now.getTime() - 60 * 60 * 1000);
            endDate = now;
        } else if (range === '7d') {
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            endDate = now;
        } else if (range === 'all') {
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            endDate = now;
        }
        
        if (startDate && endDate) {
            Object.assign(where, appendTimeRangeFilter({}, startDate, endDate));
        }
        
        // Add IMEI filtering if provided
        if (imeis) {
            const imeiList = imeis.split(',').map(imei => imei.trim()).filter(imei => imei);
            if (imeiList.length > 0) {
                // If user has specific IMEI filter, intersect with accessible devices
                if (req.user.role !== 'admin') {
                    const filteredImeis = imeiList.filter(imei => accessibleDeviceImeis.includes(imei));
                    if (filteredImeis.length > 0) {
                        where.deviceImei = { [Op.in]: filteredImeis };
                    } else {
                        where.deviceImei = { [Op.in]: [] }; // No accessible devices match
                    }
                } else {
                    where.deviceImei = { [Op.in]: imeiList };
                }
            }
        }
        
        // Better limit handling to prevent massive queries
        let queryLimit = parseInt(limit, 10);
        const maxPreviewLimit = isPaginated ? PREVIEW_MAX_ROWS : 1000;
        if (limit === 'all' || queryLimit === 0 || isNaN(queryLimit)) {
            queryLimit = maxPreviewLimit;
        } else if (queryLimit > maxPreviewLimit) {
            queryLimit = maxPreviewLimit;
        }
        
        logger.debug('Records query parameters', { range: range || 'custom', limit: queryLimit });
        const dbStart = Date.now();
        
        const desiredAttributes = [
            'id', 'deviceImei', 'timestamp', 'datetime', 'recordNumber', 'milliseconds',
            'latitude', 'longitude', 'altitude', 'speed', 'course', 'satellites', 'hdop', 'direction',
            'status', 'supplyVoltage', 'batteryVoltage', 'temperature', 'acceleration',
            'outputs', 'inputs', 'input0', 'input1', 'input2', 'input3',
            'inputVoltage0', 'inputVoltage1', 'inputVoltage2', 'inputVoltage3',
            'inputVoltage4', 'inputVoltage5', 'inputVoltage6',
            'userData0', 'userData1', 'userData2', 'userData3', 'userData4', 'userData5', 'userData6', 'userData7',
            'modbus0', 'modbus1', 'modbus2', 'modbus3', 'modbus4', 'modbus5', 'modbus6', 'modbus7',
            'modbus8', 'modbus9', 'modbus10', 'modbus11', 'modbus12', 'modbus13', 'modbus14', 'modbus15'
        ];
        const availableAttributes = desiredAttributes.filter(attr => Record.rawAttributes[attr]);

        const records = await Record.findAll({
            where,
            order: effectiveTimeOrderDesc(),
            limit: queryLimit,
            offset: isPaginated ? queryOffset : 0,
            attributes: availableAttributes
        });
        
        const shouldMerge = req.query.merge === '1' || req.query.merge === 'true';
        const outputRecords = shouldMerge ? mergeRecords(records) : records;

        const dbTime = Date.now() - dbStart;
        const totalTime = Date.now() - requestStart;

        if (isPaginated) {
            return res.json({
                records: outputRecords,
                limit: queryLimit,
                offset: queryOffset,
                hasMore: outputRecords.length === queryLimit
            });
        }
        
        logger.info('Records query completed', { 
            dbTime: `${dbTime}ms`, 
            totalTime: `${totalTime}ms`,
            recordsCount: outputRecords.length,
            merged: shouldMerge
        });

        res.json(outputRecords);
    } catch (error) {
        logger.error('Error fetching records:', error);
        res.status(500).json({ 
            error: 'Failed to fetch records', 
            details: error.message, 
            stack: error.stack 
        });
    }
});

// Get available IMEIs for Data Export filtering
router.get('/imeis', requireAuth, filterDevicesByPermission, async (req, res) => {
    try {
        const imeis = await getAccessibleDeviceImeis(req);
        res.json(imeis);
    } catch (error) {
        logger.error('Error fetching available IMEIs:', error);
        res.status(500).json({
            error: 'Failed to fetch available IMEIs',
            details: error.message
        });
    }
});

// Get records by device IMEI
router.get('/device/:imei', async (req, res) => {
    try {
        const { imei } = req.params;
        const { startDate, endDate, limit = 100 } = req.query;
        const where = { deviceImei: imei };
        
        if (startDate && endDate) {
            Object.assign(where, appendTimeRangeFilter({}, startDate, endDate));
        }
        
        const records = await Record.findAll({
            where,
            order: effectiveTimeOrderDesc(),
            limit: parseInt(limit, 10)
        });
        
        res.json(records);
    } catch (error) {
        logger.error('Error fetching device records:', error);
        res.status(500).json({ 
            error: 'Failed to fetch device records',
            details: error.message 
        });
    }
});

// Export records
router.post('/export', requireAuth, filterDevicesByPermission, async (req, res) => {
    try {
        const { startDate, endDate, format, fields, imeis } = req.body;
        const where = {};
        
        // Use DATETIME field for time filtering instead of TIMESTAMP
        if (startDate && endDate) {
            Object.assign(where, appendTimeRangeFilter({}, startDate, endDate));
        }
        
        // Add IMEI filtering if provided, respecting user permissions
        if (imeis && imeis.length > 0) {
            if (req.user.role === 'admin') {
                where.deviceImei = { [Op.in]: imeis };
            } else {
                const accessibleImeis = await getAccessibleDeviceImeis(req);
                const filteredImeis = imeis.filter(imei => accessibleImeis.includes(imei));
                where.deviceImei = { [Op.in]: filteredImeis };
            }
        } else if (req.user.role !== 'admin') {
            const accessibleImeis = await getAccessibleDeviceImeis(req);
            where.deviceImei = { [Op.in]: accessibleImeis.length > 0 ? accessibleImeis : [] };
        }
        
        // Include all possible fields in the query to ensure they're available for export
        const allFields = [
            'id', 'deviceImei', 'timestamp', 'datetime', 'recordNumber',
            'latitude', 'longitude', 'speed', 'direction', 'altitude', 'course', 'satellites', 'hdop',
            'status', 'supplyVoltage', 'batteryVoltage',
            'input0', 'input1', 'input2', 'input3',
            'inputVoltage0', 'inputVoltage1', 'inputVoltage2', 'inputVoltage3', 'inputVoltage4', 'inputVoltage5', 'inputVoltage6',
            'userData0', 'userData1', 'userData2', 'userData3', 'userData4', 'userData5', 'userData6', 'userData7',
            'modbus0', 'modbus1', 'modbus2', 'modbus3', 'modbus4', 'modbus5', 'modbus6', 'modbus7',
            'modbus8', 'modbus9', 'modbus10', 'modbus11', 'modbus12', 'modbus13', 'modbus14', 'modbus15'
        ];
        
        const records = await Record.findAll({
            where,
            attributes: allFields,
            order: effectiveTimeOrderDesc(),
            limit: EXPORT_MAX_ROWS
        });

        const truncated = records.length === EXPORT_MAX_ROWS;
        const data = mergeRecords(records);
        const selectedData = data.map(row => {
            const filtered = {};
            fields.forEach(field => {
                filtered[field] = row[field];
            });
            return filtered;
        });
        
        if (truncated) {
            res.setHeader('X-Export-Truncated', 'true');
            res.setHeader('X-Export-Max-Rows', String(EXPORT_MAX_ROWS));
        }

        if (format === 'csv') {
            const parser = new Json2csvParser({ fields });
            const csv = parser.parse(selectedData);
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="records.csv"');
            res.send(csv);
        } else if (format === 'excel') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Records');
            
            // Add headers
            worksheet.columns = fields.map(field => ({ header: field, key: field }));
            
            // Add data
            selectedData.forEach(row => {
                worksheet.addRow(row);
            });
            
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="records.xlsx"');
            
            await workbook.xlsx.write(res);
            res.end();
        } else {
            res.json(selectedData);
        }
        
    } catch (error) {
        logger.error('Error exporting records:', error);
        res.status(500).json({ 
            error: 'Failed to export records',
            details: error.message 
        });
    }
});

// Export Data SM records with custom field mapping
// Export Data SM records with custom field mapping
router.post('/export-sm', requireAuth, filterDevicesByPermission, async (req, res) => {
    try {
        const { startDate, endDate, fields, customHeaders, imeis, fileExtension = 'pfsl' } = req.body;
        logger.info('Export-SM request received', {
            startDate,
            endDate,
            imeisCount: imeis?.length || 0,
            fieldsCount: fields?.length || 0,
            fileExtension,
            username: req.user.username,
            role: req.user.role
        });
        
        const where = {};
        
        // Filter by user permissions - only show records from accessible devices
        let accessibleDeviceImeis = [];
        
        if (req.user.role === 'admin') {
            logger.debug('Admin user - getting all records for export');
        } else {
            logger.debug('Non-admin user - filtering export records by permissions');
            
            // Get devices from permissions
            if (req.userPermissions.devices && req.userPermissions.devices.length > 0) {
                accessibleDeviceImeis.push(...req.userPermissions.devices);
            }
            
            // Get devices from device groups
            if (req.userPermissions.deviceGroups && req.userPermissions.deviceGroups.length > 0) {
                const deviceGroups = await DeviceGroup.findAll({
                    where: { id: req.userPermissions.deviceGroups },
                    include: ['devices']
                });
                
                for (const group of deviceGroups) {
                    if (group.devices) {
                        accessibleDeviceImeis.push(...group.devices.map(device => device.imei));
                    }
                }
            }
            
            // Get devices from UserDeviceAccess table
            const userDeviceAccess = await UserDeviceAccess.findAll({
                where: { 
                    userId: req.user.userId,
                    isActive: true
                },
                include: [
                    {
                        model: Device,
                        as: 'device',
                        attributes: ['imei']
                    }
                ]
            });
            
            for (const access of userDeviceAccess) {
                if (access.device && !accessibleDeviceImeis.includes(access.device.imei)) {
                    accessibleDeviceImeis.push(access.device.imei);
                }
            }
            
            // Get devices from UserDeviceGroupAccess table
            const userGroupAccess = await UserDeviceGroupAccess.findAll({
                where: { 
                    userId: req.user.userId,
                    isActive: true
                },
                include: [
                    {
                        model: DeviceGroup,
                        as: 'group',
                        include: ['devices']
                    }
                ]
            });
            
            for (const access of userGroupAccess) {
                if (access.group && access.group.devices) {
                    for (const device of access.group.devices) {
                        if (!accessibleDeviceImeis.includes(device.imei)) {
                            accessibleDeviceImeis.push(device.imei);
                        }
                    }
                }
            }
            
            // Remove duplicates
            accessibleDeviceImeis = [...new Set(accessibleDeviceImeis)];
            
            logger.debug('User device access for export', { deviceCount: accessibleDeviceImeis.length });
        }
        
        // Use DATETIME field for time filtering
        if (startDate && endDate) {
            Object.assign(where, appendTimeRangeFilter({}, startDate, endDate));
        }
        
        // Add IMEI filtering if provided - but respect user permissions
        if (imeis && imeis.length > 0) {
            if (req.user.role === 'admin') {
                where.deviceImei = { [Op.in]: imeis };
            } else {
                // Filter IMEIs by accessible devices
                const filteredImeis = imeis.filter(imei => accessibleDeviceImeis.includes(imei));
                if (filteredImeis.length > 0) {
                    where.deviceImei = { [Op.in]: filteredImeis };
                } else {
                    where.deviceImei = { [Op.in]: [] }; // No accessible devices match
                }
            }
        } else if (req.user.role !== 'admin') {
            // If no specific IMEIs requested, filter by all accessible devices
            if (accessibleDeviceImeis.length > 0) {
                where.deviceImei = { [Op.in]: accessibleDeviceImeis };
            } else {
                where.deviceImei = { [Op.in]: [] }; // No accessible devices
            }
        }
        
        // Include all required fields for Data SM
        const allFields = [
            'id', 'deviceImei', 'datetime', 'latitude', 'longitude', 'speed', 'altitude', 'satellites',
            'userData0', 'userData1', 'userData2', 'modbus0'
        ];
        
        logger.debug('Export query where clause', { where });
        
        const records = await Record.findAll({
            where,
            attributes: allFields,
            order: effectiveTimeOrderDesc(),
            limit: EXPORT_MAX_ROWS
        });

        const mergedRecords = mergeRecords(records);
        logger.debug('Records found for export', { count: records.length, mergedCount: mergedRecords.length, truncated: records.length === EXPORT_MAX_ROWS });
        
        // Filter out records that only have IMEI and timestamp (no meaningful data)
        const filteredRecords = mergedRecords.filter(record => {
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
        
        logger.debug('Filtered records for export', { meaningfulRecords: filteredRecords.length });
        
        // Transform data with custom headers and date formatting
        const transformedData = filteredRecords.map(record => {
            const transformed = {};
            
            // Map each field to its custom header with proper formatting
            Object.keys(customHeaders).forEach(field => {
                switch (field) {
                    case 'deviceImei':
                        transformed[customHeaders[field]] = record.deviceImei;
                        break;
                    case 'datetime':
                        // Format date as YYYY-MM-DD HH:MM:SS
                        if (record.datetime) {
                            const date = new Date(record.datetime);
                            const year = date.getFullYear();
                            const month = String(date.getMonth() + 1).padStart(2, '0');
                            const day = String(date.getDate()).padStart(2, '0');
                            const hours = String(date.getHours()).padStart(2, '0');
                            const minutes = String(date.getMinutes()).padStart(2, '0');
                            const seconds = String(date.getSeconds()).padStart(2, '0');
                            transformed[customHeaders[field]] = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
                        } else {
                            transformed[customHeaders[field]] = '';
                        }
                        break;
                    case 'latitude':
                        transformed[customHeaders[field]] = record.latitude || '';
                        break;
                    case 'longitude':
                        transformed[customHeaders[field]] = record.longitude || '';
                        break;
                    case 'altitude':
                        transformed[customHeaders[field]] = record.altitude || '';
                        break;
                    case 'satellites':
                        transformed[customHeaders[field]] = record.satellites || '';
                        break;
                    case 'speed':
                        transformed[customHeaders[field]] = record.speed || '';
                        break;
                    case 'userData0':
                        transformed[customHeaders[field]] = record.userData0 || '';
                        break;
                    case 'userData1':
                        transformed[customHeaders[field]] = record.userData1 || '';
                        break;
                    case 'userData2':
                        transformed[customHeaders[field]] = record.userData2 || '';
                        break;
                    case 'modbus0':
                        transformed[customHeaders[field]] = record.modbus0 || '';
                        break;
                    default:
                        transformed[customHeaders[field]] = record[field] || '';
                }
            });
            return transformed;
        });
        
        // Generate CSV without headers - Manual approach to avoid quotes
        const headers = Object.values(customHeaders);
        let csv = '';
        
        transformedData.forEach(row => {
            const values = headers.map(header => {
                const value = row[header];
                return value !== null && value !== undefined ? value : '';
            });
            csv += values.join(';') + '\n';
        });
        
        // Generate filename with device groups
        const deviceRecords = await Device.findAll({
            where: { imei: imeis },
            include: [{
                model: DeviceGroup,
                as: 'group',
                attributes: ['name']
            }],
            attributes: ['imei', 'name']
        });
        
        // Generate date string for filename
        const dateStr = `${String(new Date().getDate()).padStart(2, '0')}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${new Date().getFullYear()}`;
        
        // Create filename based on device groups
        let filename;
        if (deviceRecords.length === 1) {
            const device = deviceRecords[0];
            const groupName = device.group ? device.group.name : 'Unknown';
            const deviceName = device.name || device.imei;
            filename = `${groupName}_${deviceName}_${dateStr}.${fileExtension}`;
        } else {
            // Multiple devices - use group names or "all_devices"
            const groupNames = [...new Set(deviceRecords.map(d => d.group ? d.group.name : 'Unknown'))];
            if (groupNames.length === 1) {
                filename = `${groupNames[0]}_all_devices_${dateStr}.${fileExtension}`;
            } else {
                filename = `all_devices_${dateStr}.${fileExtension}`;
            }
        }
        
        logger.info('Export completed', { filename, recordsCount: transformedData.length });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
        
    } catch (error) {
        logger.error('Error exporting Data SM records:', error);
        res.status(500).json({ 
            error: 'Failed to export Data SM records',
            details: error.message 
        });
    }
});

const exportRecordsService = require('../services/exportRecordsService');

router.post('/export/async', requireAuth, filterDevicesByPermission, async (req, res) => {
    try {
        const { startDate, endDate, format, fields, imeis } = req.body;
        if (!fields || !Array.isArray(fields) || fields.length === 0) {
            return res.status(400).json({ error: 'Export fields are required' });
        }

        const job = exportRecordsService.createExportJob(req, {
            startDate,
            endDate,
            format: format || 'csv',
            fields,
            imeis
        });

        res.status(202).json(job);
    } catch (error) {
        logger.error('Failed to queue export job:', error);
        res.status(500).json({ error: 'Failed to queue export job' });
    }
});

router.get('/export/jobs/:jobId', requireAuth, async (req, res) => {
    const job = exportRecordsService.getExportJobStatus(
        req.params.jobId,
        req.user.userId,
        req.user.role === 'admin'
    );

    if (!job) {
        return res.status(404).json({ error: 'Export job not found' });
    }

    res.json(job);
});

router.get('/export/jobs/:jobId/download', requireAuth, async (req, res) => {
    const job = exportRecordsService.getExportJob(
        req.params.jobId,
        req.user.userId,
        req.user.role === 'admin'
    );

    if (!job || job.status !== 'completed' || !job.filePath || !fs.existsSync(job.filePath)) {
        return res.status(404).json({ error: 'Export file not ready' });
    }

    if (job.truncated) {
        res.setHeader('X-Export-Truncated', 'true');
        res.setHeader('X-Export-Max-Rows', String(exportRecordsService.EXPORT_MAX_ROWS));
    }

    res.setHeader('Content-Type', job.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="records-export.${job.extension || 'csv'}"`);
    res.sendFile(path.resolve(job.filePath));
});

module.exports = router;