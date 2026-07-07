// backend/src/routes/data.js
const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler'); // Import your async error handler
const dataAggregator = require('../services/dataAggregator'); // Import your data service
const { Record, Device, DeviceGroup } = require('../models');
const { Op } = require('sequelize');
const { requireAuth } = require('./auth');
const { checkDeviceAccess, filterDevicesByPermission } = require('../middleware/permissions');
const { getAvailableColumns, columnSets } = require('../utils/columnHelper');
const { resolveAccessibleDeviceImeis, canAccessDeviceImei } = require('../utils/accessibleDevices');
const { userHasMenuAccess } = require('../middleware/permissions');
const { appendTimeRangeFilter, effectiveTimeOrderAsc, findTrackingRecordsChronological } = require('../utils/recordTimeQuery');
const logger = require('../utils/logger');

const TRACKING_MAX_POINTS = Number.parseInt(process.env.TRACKING_MAX_POINTS, 10) || 15000;

// Get device data (with permission check)
router.get('/:deviceId', requireAuth, checkDeviceAccess, asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const data = await dataAggregator.getDeviceData(deviceId); // Call your data service
    res.json(data);
}));

// Get tracking data for a device (using device datetime for filtering)
router.get('/:deviceId/tracking', requireAuth, checkDeviceAccess, asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const { startDate, endDate } = req.query;
    
    const where = {
        deviceImei: deviceId,
        latitude: { [Op.ne]: null },
        longitude: { [Op.ne]: null }
    };
    
    const availableColumns = getAvailableColumns(columnSets.tracking, Record);
    
    const trackingData = await findTrackingRecordsChronological(Record, {
        where,
        startDate,
        endDate,
        limit: TRACKING_MAX_POINTS,
        attributes: availableColumns
    });

    if (trackingData.length === TRACKING_MAX_POINTS) {
        res.setHeader('X-Tracking-Truncated', 'true');
        res.setHeader('X-Tracking-Max-Points', String(TRACKING_MAX_POINTS));
    }
    
    res.json(trackingData);
}));

// Get export data for a device (using device datetime for filtering)
router.get('/:deviceId/export', requireAuth, checkDeviceAccess, asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const { startDate, endDate } = req.query;
    
    const where = {
        deviceImei: deviceId
    };
    
    const availableColumns = getAvailableColumns(columnSets.export, Record);

    if (startDate && endDate) {
        Object.assign(where, appendTimeRangeFilter({}, startDate, endDate));
    }
    
    const exportData = await Record.findAll({
        where,
        attributes: availableColumns,
        order: effectiveTimeOrderAsc()
    });
    
    res.json(exportData);
}));

// Get tracking data for a device by IMEI (for Tracking page)
router.get('/imei/:deviceImei/tracking', requireAuth, asyncHandler(async (req, res) => {
    const { deviceImei } = req.params;
    const { startDate, endDate } = req.query;

    if (!userHasMenuAccess(req.user, 'tracking') && !userHasMenuAccess(req.user, 'devices')) {
        return res.status(403).json({ error: 'Tracking permission required' });
    }

    const accessibleImeis = await resolveAccessibleDeviceImeis(req.user);
    if (!canAccessDeviceImei(accessibleImeis, deviceImei)) {
        return res.status(403).json({ error: 'Access denied to this device' });
    }

    const where = {
        deviceImei,
        latitude: { [Op.ne]: null },
        longitude: { [Op.ne]: null }
    };

    const trackingData = await findTrackingRecordsChronological(Record, {
        where,
        startDate,
        endDate,
        limit: TRACKING_MAX_POINTS,
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

    if (trackingData.length === TRACKING_MAX_POINTS) {
        res.setHeader('X-Tracking-Truncated', 'true');
        res.setHeader('X-Tracking-Max-Points', String(TRACKING_MAX_POINTS));
    }

    logger.debug('Tracking data fetched', {
        deviceImei,
        points: trackingData.length,
        truncated: trackingData.length === TRACKING_MAX_POINTS
    });

    res.json(trackingData);
}));

// Get dashboard data (filtered by user permissions)
router.get('/dashboard', requireAuth, filterDevicesByPermission, asyncHandler(async (req, res) => {
    let accessibleDevices = [];
    console.log('🚀 GET /api/data/dashboard - Starting request for user:', req.user.username);
    console.log('👤 User role:', req.user.role);
    console.log('🔍 User permissions:', req.userPermissions);
    // If admin, get all devices
    if (req.user.role === 'admin') {
        const allDevices = await Device.findAll();
        accessibleDevices = allDevices.map(device => device.imei);
    } else {
        // Filter devices based on user permissions
        const { userPermissions } = req;
        
        // Get devices from direct access (both permissions and UserDeviceAccess table)
        const directDeviceImeis = [];
        
        // From permissions.devices
        if (userPermissions.devices && userPermissions.devices.length > 0) {
            directDeviceImeis.push(...userPermissions.devices);
        }
        
        // From UserDeviceAccess table
        const { UserDeviceAccess } = require('../models');
        const userDeviceAccess = await UserDeviceAccess.findAll({
            where: { 
                userId: req.user.userId,
                isActive: true
            },
            include: [
                {
                    model: Device,
                    as: 'device'
                }
            ]
        });
        
        for (const access of userDeviceAccess) {
            if (access.device && !directDeviceImeis.includes(access.device.imei)) {
                directDeviceImeis.push(access.device.imei);
            }
        }
        
        accessibleDevices.push(...directDeviceImeis);
        
        // Get devices from device groups
        if (userPermissions.deviceGroups && userPermissions.deviceGroups.length > 0) {
            const deviceGroups = await DeviceGroup.findAll({
                where: { id: userPermissions.deviceGroups },
                include: ['devices']
            });
            
            for (const group of deviceGroups) {
                if (group.devices) {
                    accessibleDevices.push(...group.devices.map(device => device.imei));
                }
            }
        }
        
        // Remove duplicates
        accessibleDevices = [...new Set(accessibleDevices)];
    }
    
    // Get stats and realtime data for accessible devices only
    const stats = await dataAggregator.getDashboardData(accessibleDevices);
    const realtimeData = await dataAggregator.getRealtimeData(accessibleDevices);
    console.log(`🔍 User has access to ${accessibleDevices.length} devices:`, accessibleDevices);
    console.log('📊 Dashboard data generated for accessible devices only');
    res.json({ stats, realtimeData });
}));

module.exports = router;
