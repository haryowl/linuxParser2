// backend/src/routes/devices.js
const express = require('express');
const router = express.Router();
const deviceManager = require('../services/deviceManager');
const asyncHandler = require('../utils/asyncHandler'); // Import the asyncHandler middleware
const tagDefinitions = require('../services/tagDefinitions');
const TagParser = require('../services/tagParser');
const { Record, Device, DeviceGroup, UserDeviceAccess, UserDeviceGroupAccess } = require('../models');
const { Op } = require('sequelize');
const { requireAuth } = require('./auth');
const { checkDeviceAccess, filterDevicesByPermission } = require('../middleware/permissions');
const { appendTimeGteFilter, findTrackingRecordsChronological } = require('../utils/recordTimeQuery');
const logger = require('../utils/logger');

function normalizeCoordinateValue(value, maxAbs) {
    if (value === null || value === undefined) {
        return value;
    }
    let numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return value;
    }
    let attempts = 0;
    while (Math.abs(numeric) > maxAbs && attempts < 3) {
        numeric = numeric / 10;
        attempts += 1;
    }
    return numeric;
}

function normalizeCoordinates(latitude, longitude) {
    return {
        latitude: normalizeCoordinateValue(latitude, 90),
        longitude: normalizeCoordinateValue(longitude, 180)
    };
}

function resolveLocationTimestamp(recordDatetime, recordTimestamp) {
    const now = Date.now();
    const datetime = recordDatetime ? new Date(recordDatetime) : null;
    const timestamp = recordTimestamp ? new Date(recordTimestamp) : null;

    if (datetime && !Number.isNaN(datetime.getTime())) {
        if (datetime.getTime() <= now + 5 * 60 * 1000) {
            return datetime.toISOString();
        }
    }

    if (timestamp && !Number.isNaN(timestamp.getTime())) {
        return timestamp.toISOString();
    }

    return new Date().toISOString();
}

// Simple in-memory cache for devices (5 minutes TTL)
const deviceCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedDevices(userId, role) {
    const cacheKey = `${userId}-${role}`;
    const cached = deviceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    return null;
}

function setCachedDevices(userId, role, data) {
    const cacheKey = `${userId}-${role}`;
    deviceCache.set(cacheKey, {
        data,
        timestamp: Date.now()
    });
}

// Function to clear device cache for a specific user
function clearUserDeviceCache(userId) {
    // Clear cache for all roles for this user
    for (const [key] of deviceCache) {
        if (key.startsWith(`${userId}-`)) {
            deviceCache.delete(key);
            console.log(`🗑️ Cleared device cache for user ${userId}`);
        }
    }
}

function clearAllDeviceCache() {
    deviceCache.clear();
    console.log('🗑️ Cleared device cache for all users');
}

// Get multi-device tracking data with color assignment and GPS filtering
// Get multi-device tracking data with color assignment and GPS filtering - WITH DETAILED PERMISSION CHECK
router.get('/multi-tracking', requireAuth, filterDevicesByPermission, asyncHandler(async (req, res) => {
    const requestStart = Date.now();
    console.log('🚀 GET /api/devices/multi-tracking - Starting request for user:', req.user.username);
    console.log('👤 User role:', req.user.role);
    console.log('🔐 User permissions:', req.user.permissions);
    
    // DETAILED PERMISSION CHECK FOR MULTI-TRACKING
    if (req.user.role !== 'admin') {
        console.log('🔍 Checking multi-tracking permissions for non-admin user...');
        
        // Check if user has multi-tracking menu access
        const hasMultiTrackingAccess = req.user.permissions?.menus?.multiTracking?.access === true;
        console.log('📋 Multi-tracking access check:', hasMultiTrackingAccess);
        
        if (!hasMultiTrackingAccess) {
            console.log('❌ User does not have multi-tracking access');
            console.log('🚫 Available menu permissions:', req.user.permissions?.menus);
            return res.status(403).json({ 
                error: 'Access denied to multi-tracking feature',
                details: 'User does not have multi-tracking permission',
                requiredPermission: 'menus.multiTracking.access'
            });
        }
        
        // Additional check: ensure user has read permission for multi-tracking
        const hasMultiTrackingRead = req.user.permissions?.menus?.multiTracking?.read === true;
        console.log('📖 Multi-tracking read permission:', hasMultiTrackingRead);
        
        if (!hasMultiTrackingRead) {
            console.log('❌ User does not have multi-tracking read permission');
            return res.status(403).json({ 
                error: 'Read access denied to multi-tracking feature',
                details: 'User does not have multi-tracking read permission',
                requiredPermission: 'menus.multiTracking.read'
            });
        }
        
        console.log('✅ Multi-tracking permissions verified for user');
    } else {
        console.log('👑 Admin user - bypassing permission checks');
    }
    
    let devices;
    let accessibleDeviceImeis = [];
    
    // Get devices based on user permissions
    if (req.user.role === 'admin') {
        console.log('👑 Admin user - getting all device locations');
        devices = await Device.findAll({
            order: [['lastSeen', 'DESC']],
            limit: 100 // Reduced limit for better performance
        });
        accessibleDeviceImeis = devices.map(device => device.imei);
    } else {
        console.log('👤 Non-admin user - filtering device locations by permissions');
        
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
        
        console.log(`🔍 User has access to ${accessibleDeviceImeis.length} devices for multi-tracking`);
        
        // Get devices with accessible IMEIs
        if (accessibleDeviceImeis.length > 0) {
            devices = await Device.findAll({
                where: { imei: { [Op.in]: accessibleDeviceImeis } },
                order: [['lastSeen', 'DESC']],
                limit: 100 // Reduced limit for better performance
            });
        } else {
            devices = []; // No accessible devices
        }
    }
    
    // Get device IMEIs for location lookup
    const deviceImeis = devices.map(device => device.imei);
    
    if (deviceImeis.length === 0) {
        console.log('ℹ️ No accessible devices found for multi-tracking');
        return res.json([]);
    }
    
    // OPTIMIZED: Get only recent location data (last 6 hours) with reduced limit
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const historicalRecords = await findTrackingRecordsChronological(Record, {
        where: {
            deviceImei: { [Op.in]: deviceImeis },
            latitude: { [Op.ne]: null },
            longitude: { [Op.ne]: null }
        },
        startDate: sixHoursAgo,
        endDate: new Date(),
        limit: 500,
        attributes: [
            'deviceImei',
            'latitude',
            'longitude',
            'datetime',
            'timestamp',
            'speed',
            'direction',
            'altitude',
            'satellites',
            'hdop'
        ]
    });
    
    // Create location map (take latest for each device)
    const locationMap = new Map();
    const devicePaths = new Map(); // Store paths for each device
    
    // Group records by device
    historicalRecords.forEach((item) => {
        const record = typeof item.toJSON === 'function' ? item.toJSON() : item;
        if (!devicePaths.has(record.deviceImei)) {
            devicePaths.set(record.deviceImei, []);
        }
        devicePaths.get(record.deviceImei).push({
            latitude: record.latitude,
            longitude: record.longitude,
            timestamp: resolveLocationTimestamp(record.datetime, record.timestamp),
            speed: record.speed,
            direction: record.direction,
            altitude: record.altitude,
            satellites: record.satellites,
            hdop: record.hdop
        });
        
        const recordTime = resolveLocationTimestamp(record.datetime, record.timestamp);
        const recordTimeMs = recordTime ? new Date(recordTime).getTime() : 0;
        if (!locationMap.has(record.deviceImei) ||
            recordTimeMs > (locationMap.get(record.deviceImei).timeMs || 0)) {
            locationMap.set(record.deviceImei, {
                latitude: record.latitude,
                longitude: record.longitude,
                timestamp: recordTime,
                timeMs: recordTimeMs,
                speed: record.speed,
                direction: record.direction,
                altitude: record.altitude,
                satellites: record.satellites,
                hdop: record.hdop
            });
        }
    });
    
    // Color palette for devices
    const colorPalette = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
        '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
        '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#D7BDE2',
        '#A9DFBF', '#F9E79F', '#D5DBDB', '#FADBD8', '#D6EAF8'
    ];
    
    // Combine devices with their locations, paths, and assign colors
    const devicesWithLocations = devices.map((device, index) => ({
        ...device.toJSON(),
        location: locationMap.get(device.imei) || null,
        path: devicePaths.get(device.imei) || [], // Add path data
        color: colorPalette[index % colorPalette.length], // Assign color based on index
        colorIndex: index % colorPalette.length
    }));
    
    const totalTime = Date.now() - requestStart;
    console.log(`✅ Multi-tracking data completed in ${totalTime}ms - Found ${devicesWithLocations.length} devices with ${locationMap.size} locations`);
    console.log(`🔍 Accessible devices: ${deviceImeis.join(', ')}`);
    console.log(`🔐 Permission check passed for user: ${req.user.username}`);
    
    res.json(devicesWithLocations);
}));

// Export the cache clearing function for use in other routes
module.exports = { router, clearUserDeviceCache };

// Get all devices (filtered by user permissions) - OPTIMIZED
router.get('/', requireAuth, filterDevicesByPermission, asyncHandler(async (req, res) => {
    const requestStart = Date.now();
    console.log('🚀 GET /api/devices - Starting request');
    console.log('👤 User:', req.user.username, 'Role:', req.user.role);
    
    // Check cache first
    const cachedDevices = getCachedDevices(req.user.userId, req.user.role);
    if (cachedDevices) {
        const cacheTime = Date.now() - requestStart;
        console.log(`⚡ CACHE HIT: Returning ${cachedDevices.length} cached devices in ${cacheTime}ms`);
        return res.json(cachedDevices);
    }
    
    console.log('🔄 CACHE MISS: Fetching from database...');
    const dbStart = Date.now();
    
    let devices;
    
    // If admin, get all devices with optimized query
    if (req.user.role === 'admin') {
        logger.debug('Admin user - getting all devices');
        devices = await Device.findAll({
            include: [{
                model: require('../models').FieldMapping,
                as: 'mappings',
                where: { enabled: true },
                required: false
            }],
            order: [['lastSeen', 'DESC']],
            // Add limit to prevent loading too many devices at once
            limit: 1000
        });
    } else {
        logger.debug('Non-admin user - filtering devices by permissions');
        
        // Get current device group access from UserDeviceGroupAccess table
        const { UserDeviceGroupAccess } = require('../models');
        const currentGroupAccess = await UserDeviceGroupAccess.findAll({
            where: { 
                userId: req.user.userId,
                isActive: true
            },
            attributes: ['groupId'],
            raw: true
        });
        
        const currentGroupIds = currentGroupAccess.map(access => access.groupId);
        logger.debug('Current device group access', { groupCount: currentGroupIds.length });
        
        // Build efficient query conditions
        const deviceConditions = [];
        const groupConditions = [];
        
        // Direct device access from role permissions
        if (req.userPermissions.devices && req.userPermissions.devices.length > 0) {
            deviceConditions.push({ imei: { [Op.in]: req.userPermissions.devices } });
        }
        
        // Device group access from current UserDeviceGroupAccess table
        if (currentGroupIds.length > 0) {
            groupConditions.push({ id: { [Op.in]: currentGroupIds } });
        }
        
        // User device access from UserDeviceAccess table
        const { UserDeviceAccess } = require('../models');
        const userDeviceAccess = await UserDeviceAccess.findAll({
            where: { 
                userId: req.user.userId,
                isActive: true
            },
            attributes: ['deviceId'],
            raw: true
        });
        
        if (userDeviceAccess.length > 0) {
            const deviceIds = userDeviceAccess.map(access => access.deviceId);
            deviceConditions.push({ id: { [Op.in]: deviceIds } });
        }
        
        // Combine all conditions
        const whereCondition = deviceConditions.length > 0 ? { [Op.or]: deviceConditions } : {};
        
        // Get devices with single optimized query
        devices = await Device.findAll({
            where: whereCondition,
            include: [
                {
                    model: require('../models').FieldMapping,
                    as: 'mappings',
                    where: { enabled: true },
                    required: false
                }
            ],
            order: [['lastSeen', 'DESC']],
            limit: 1000
        });
        
        // Filter devices by group access if groups were specified
        if (groupConditions.length > 0) {
            devices = devices.filter(device => {
                // If user has direct device access, include the device
                if (deviceConditions.length > 0) {
                    return true;
                }
                // Otherwise, only include devices from accessible groups
                return currentGroupIds.includes(device.groupId);
            });
        }
    }
    
    const dbTime = Date.now() - dbStart;
    logger.info('Database query completed', { 
        dbTime: `${dbTime}ms`, 
        deviceCount: devices.length 
    });
    
    // Cache the result
    setCachedDevices(req.user.userId, req.user.role, devices);
    
    const totalTime = Date.now() - requestStart;
    logger.info('Request completed', { 
        totalTime: `${totalTime}ms`, 
        deviceCount: devices.length 
    });
    
    res.json(devices);
}));

// Get device locations with latest GPS data - HYBRID FAST VERSION
// Get device locations with latest GPS data - WITH USER PERMISSIONS
router.get('/locations', requireAuth, filterDevicesByPermission, asyncHandler(async (req, res) => {
    const requestStart = Date.now();
    console.log('🚀 GET /api/devices/locations - Starting request for user:', req.user.username);
    
    let devices;
    let accessibleDeviceImeis = [];
    
    // Get devices based on user permissions
    if (req.user.role === 'admin') {
        console.log('👑 Admin user - getting all device locations');
        devices = await Device.findAll({
            order: [['lastSeen', 'DESC']],
            limit: 1000
        });
        accessibleDeviceImeis = devices.map(device => device.imei);
    } else {
        console.log('👤 Non-admin user - filtering device locations by permissions');
        
        // Get devices from permissions
        if (req.userPermissions.devices && req.userPermissions.devices.length > 0) {
            accessibleDeviceImeis.push(...req.userPermissions.devices);
        }
        
        // Get devices from device groups
        if (req.userPermissions.deviceGroups && req.userPermissions.deviceGroups.length > 0) {
            const { DeviceGroup } = require('../models');
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
        const { UserDeviceAccess } = require('../models');
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
        const { UserDeviceGroupAccess } = require('../models');
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
        
        console.log(`🔍 User has access to ${accessibleDeviceImeis.length} devices for locations`);
        
        // Get devices with accessible IMEIs
        if (accessibleDeviceImeis.length > 0) {
            devices = await Device.findAll({
                where: { imei: { [Op.in]: accessibleDeviceImeis } },
                order: [['lastSeen', 'DESC']],
                limit: 1000
            });
        } else {
            devices = []; // No accessible devices
        }
    }
    
    // Get device IMEIs for location lookup
    const deviceImeis = devices.map(device => device.imei);
    
    if (deviceImeis.length === 0) {
        console.log('ℹ️ No accessible devices found for locations');
        return res.json([]);
    }
    
    // Get recent location data (last 24 hours for better coverage, but limit results)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentRecords = await Record.findAll({
        where: appendTimeGteFilter({
            deviceImei: { [Op.in]: deviceImeis },
            latitude: { [Op.ne]: null },
            longitude: { [Op.ne]: null }
        }, oneDayAgo),
        attributes: [
            'deviceImei',
            'latitude',
            'longitude', 
            'datetime',
            'timestamp',
            'speed',
            'direction',
            'altitude',
            'satellites',
            'hdop'
        ],
        order: [[require('sequelize').literal('COALESCE(datetime, timestamp)'), 'DESC']],
        limit: 500, // Reduced limit for speed
        raw: true
    });
    
    // Create location map (take latest for each device)
    const locationMap = new Map();
    recentRecords.forEach(record => {
        const normalized = normalizeCoordinates(record.latitude, record.longitude);
        const resolvedTimestamp = resolveLocationTimestamp(record.datetime, record.timestamp);
        const recordTime = record.datetime || record.timestamp;
        const recordTimeMs = recordTime ? new Date(recordTime).getTime() : 0;
        const existing = locationMap.get(record.deviceImei);
        const existingTimeMs = existing?.lastRecordTime ? new Date(existing.lastRecordTime).getTime() : 0;

        if (!existing || recordTimeMs > existingTimeMs) {
            locationMap.set(record.deviceImei, {
                latitude: normalized.latitude,
                longitude: normalized.longitude,
                timestamp: resolvedTimestamp,
                lastRecordTime: recordTime,
                speed: record.speed,
                direction: record.direction,
                altitude: record.altitude,
                satellites: record.satellites,
                hdop: record.hdop
            });
        }
    });
    
    // Combine devices with their locations
    const devicesWithLocations = devices.map(device => ({
        ...device.toJSON(),
        location: locationMap.get(device.imei) || null
    }));
    
    const totalTime = Date.now() - requestStart;
    console.log(`✅ Device locations completed in ${totalTime}ms - Found ${devicesWithLocations.length} devices with ${locationMap.size} locations`);
    console.log(`🔍 Accessible devices: ${deviceImeis.join(', ')}`);
    
    res.json(devicesWithLocations);
}));

// Get device by ID (with permission check)
router.get('/:id', requireAuth, checkDeviceAccess, asyncHandler(async (req, res) => {
    const device = await deviceManager.getDeviceById(req.params.id);
    if (!device) {
        return res.status(404).json({ message: 'Device not found' });
    }
    res.json(device);
}));

// Get device groups (filtered by user permissions)
// Get device groups (filtered by user permissions)
router.get('/groups', requireAuth, filterDevicesByPermission, async (req, res) => {
    try {
        let groups;
        
        if (req.user.role === 'admin') {
            // Admin can see all groups - NO RESTRICTIONS
            groups = await DeviceGroup.findAll({
                include: ['devices'],
                order: [['name', 'ASC']]
            });
        } else {
            // Non-admin users can only see groups they have access to
            const accessibleGroupIds = req.userPermissions.deviceGroups || [];
            
            if (accessibleGroupIds.length > 0) {
                groups = await DeviceGroup.findAll({
                    where: { id: { [Op.in]: accessibleGroupIds } },
                    include: ['devices'],
                    order: [['name', 'ASC']]
                });
            } else {
                groups = []; // No accessible groups
            }
        }
        
        console.log(`🔍 User has access to ${groups.length} device groups`);
        res.json(groups);
    } catch (error) {
        console.error('Error fetching device groups:', error);
        res.status(500).json({ error: 'Failed to fetch device groups' });
    }
});

// Update device (with permission check)
router.put('/:id', requireAuth, checkDeviceAccess, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const device = await deviceManager.getDeviceById(id);
    if (!device) {
        return res.status(404).json({ message: 'Device not found' });
    }

    // Validate customFields if provided
    if (updates.customFields && typeof updates.customFields !== 'object') {
        return res.status(400).json({ message: 'Custom fields must be an object' });
    }

    // Filter out empty custom field values
    if (updates.customFields) {
        const filteredCustomFields = {};
        Object.entries(updates.customFields).forEach(([key, value]) => {
            if (key.trim() && value !== null && value !== undefined && value !== '') {
                filteredCustomFields[key.trim()] = value;
            }
        });
        updates.customFields = filteredCustomFields;
    }

    await device.update(updates);
    clearAllDeviceCache();
    
    // Return the updated device
    const updatedDevice = await deviceManager.getDeviceById(id);
    res.json({ 
        message: 'Device updated successfully',
        device: updatedDevice
    });
}));

// Delete device (with permission check)
router.delete('/:id', requireAuth, checkDeviceAccess, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const device = await deviceManager.getDeviceById(id);
    if (!device) {
        return res.status(404).json({ message: 'Device not found' });
    }

    await device.destroy();
    res.json({ message: 'Device deleted successfully' });
}));

// Get multi-device tracking data with color assignment
// Get multi-device tracking data with color assignment and GPS filtering
