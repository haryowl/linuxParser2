// backend/src/routes/deviceCommands.js

const express = require('express');
const { Device, DeviceCommand, UserDeviceAccess, UserDeviceGroupAccess, DeviceGroup } = require('../models');
const { Op } = require('sequelize');
const archiveStatStore = require('../services/archiveStatStore');
const connectionRegistry = require('../services/connectionRegistry');
const { requireAuth } = require('./auth');
const { checkDeviceAccess } = require('../middleware/permissions');
const { getCommandList } = require('../services/commandList');
const { getPresetsForType } = require('../services/commandPresets');
const commandQueue = require('../services/commandQueue');
const {
    createBroadcastCommands,
    summarizeBroadcastJobs,
    getBroadcastJobDetail,
    cancelBroadcastJob,
    getBroadcastIdsForUser
} = require('../services/broadcastCommandService');

const router = express.Router();

async function resolveDeviceAccess(user, deviceId) {
    if (!user) {
        return { allowed: false, error: 'Authentication required' };
    }
    if (user.role === 'admin') {
        const device = await Device.findByPk(deviceId);
        if (!device) {
            return { allowed: false, error: 'Device not found' };
        }
        return { allowed: true, device };
    }

    const hasWritePermission = user.permissions?.menus?.devices?.write === true;
    if (!hasWritePermission) {
        return { allowed: false, error: 'Write permission required for device editing' };
    }

    const device = await Device.findByPk(deviceId);
    if (!device) {
        return { allowed: false, error: 'Device not found' };
    }

    const deviceImei = device.imei;
    const { permissions } = user;
    if (permissions?.devices && permissions.devices.includes(deviceImei)) {
        return { allowed: true, device };
    }

    const userDeviceAccess = await UserDeviceAccess.findOne({
        where: {
            userId: user.userId,
            deviceId: deviceId,
            isActive: true
        }
    });
    if (userDeviceAccess) {
        return { allowed: true, device };
    }

    const userGroupAccess = await UserDeviceGroupAccess.findAll({
        where: {
            userId: user.userId,
            isActive: true
        },
        include: [{
            model: DeviceGroup,
            as: 'group',
            include: [{
                model: Device,
                as: 'devices',
                where: { id: deviceId }
            }]
        }]
    });
    if (userGroupAccess.length > 0) {
        return { allowed: true, device };
    }

    if (permissions?.deviceGroups && permissions.deviceGroups.length > 0) {
        const deviceGroups = await DeviceGroup.findAll({
            where: { id: permissions.deviceGroups },
            include: [{
                model: Device,
                as: 'devices',
                where: { id: deviceId }
            }]
        });
        if (deviceGroups.length > 0) {
            return { allowed: true, device };
        }
    }

    return { allowed: false, error: 'Access denied to this device' };
}

async function getAccessibleImeis(user) {
    if (user.role === 'admin') {
        return null;
    }

    let accessibleImeis = [];
    if (user.permissions?.devices && user.permissions.devices.length > 0) {
        accessibleImeis.push(...user.permissions.devices);
    }

    if (user.permissions?.deviceGroups && user.permissions.deviceGroups.length > 0) {
        const deviceGroups = await DeviceGroup.findAll({
            where: { id: user.permissions.deviceGroups },
            include: ['devices']
        });
        for (const group of deviceGroups) {
            if (group.devices) {
                accessibleImeis.push(...group.devices.map(device => device.imei));
            }
        }
    }

    const userDeviceAccess = await UserDeviceAccess.findAll({
        where: { userId: user.userId, isActive: true },
        include: [{ model: Device, as: 'device', attributes: ['imei'] }]
    });
    for (const access of userDeviceAccess) {
        if (access.device) {
            accessibleImeis.push(access.device.imei);
        }
    }

    const userGroupAccess = await UserDeviceGroupAccess.findAll({
        where: { userId: user.userId, isActive: true },
        include: [{ model: DeviceGroup, as: 'group', include: ['devices'] }]
    });
    for (const access of userGroupAccess) {
        if (access.group?.devices) {
            for (const device of access.group.devices) {
                accessibleImeis.push(device.imei);
            }
        }
    }

    accessibleImeis = [...new Set(accessibleImeis)];
    return accessibleImeis;
}

async function getAccessibleDevices(user) {
    if (user.role === 'admin') {
        return Device.findAll({
            attributes: ['id', 'imei', 'name'],
            order: [['name', 'ASC']]
        });
    }

    const imeis = await getAccessibleImeis(user);
    if (!imeis || imeis.length === 0) {
        return [];
    }

    return Device.findAll({
        where: { imei: { [Op.in]: imeis } },
        attributes: ['id', 'imei', 'name'],
        order: [['name', 'ASC']]
    });
}

async function resolveBroadcastTargetDevices(user, { targetType, groupId, deviceIds }) {
    if (targetType === 'all') {
        return getAccessibleDevices(user);
    }

    if (targetType === 'group') {
        if (!groupId) {
            throw new Error('groupId is required when targetType is group');
        }

        const group = await DeviceGroup.findByPk(groupId);
        if (!group) {
            throw new Error('Device group not found');
        }

        // Prefer groupId column (same source Device menu uses) over association include.
        const groupDevices = await Device.findAll({
            where: { groupId: Number(groupId) },
            attributes: ['id', 'imei', 'name'],
            order: [['name', 'ASC']]
        });

        const allowed = [];
        for (const device of groupDevices) {
            const access = await resolveDeviceAccess(user, device.id);
            if (access.allowed) {
                allowed.push(access.device || device);
            }
        }
        if (!allowed.length) {
            throw new Error(`No accessible devices found in group "${group.name}"`);
        }
        return allowed;
    }

    if (targetType === 'devices') {
        if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
            throw new Error('deviceIds array is required when targetType is devices');
        }

        const allowed = [];
        for (const deviceId of deviceIds) {
            const access = await resolveDeviceAccess(user, deviceId);
            if (access.allowed) {
                allowed.push(access.device);
            }
        }
        return allowed;
    }

    throw new Error('Invalid targetType. Use all, group, or devices.');
}

router.get('/broadcast', requireAuth, async (req, res) => {
    try {
        const accessibleBroadcastIds = req.user.role === 'admin'
            ? null
            : await getBroadcastIdsForUser(req.user.userId);
        const jobs = await summarizeBroadcastJobs(accessibleBroadcastIds);
        res.json(jobs);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load broadcast jobs' });
    }
});

router.get('/broadcast/:broadcastId', requireAuth, async (req, res) => {
    try {
        const detail = await getBroadcastJobDetail(req.params.broadcastId);
        if (!detail) {
            return res.status(404).json({ error: 'Broadcast job not found' });
        }

        if (req.user.role !== 'admin') {
            const accessibleBroadcastIds = await getBroadcastIdsForUser(req.user.userId);
            if (!accessibleBroadcastIds.includes(req.params.broadcastId)) {
                return res.status(403).json({ error: 'Access denied to this broadcast job' });
            }
        }

        res.json(detail);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load broadcast job detail' });
    }
});

router.post('/broadcast', requireAuth, async (req, res) => {
    try {
        const {
            targetType = 'devices',
            groupId,
            deviceIds,
            commandText,
            commandNumber,
            payloadHex,
            priority,
            maxRetries
        } = req.body || {};

        const devices = await resolveBroadcastTargetDevices(req.user, {
            targetType,
            groupId,
            deviceIds
        });

        const result = await createBroadcastCommands(req.user, devices, {
            commandText,
            commandNumber,
            payloadHex,
            priority,
            maxRetries
        });

        await commandQueue.processQueue();

        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message || 'Failed to create broadcast command' });
    }
});

router.post('/broadcast/:broadcastId/cancel', requireAuth, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            const accessibleBroadcastIds = await getBroadcastIdsForUser(req.user.userId);
            if (!accessibleBroadcastIds.includes(req.params.broadcastId)) {
                return res.status(403).json({ error: 'Access denied to this broadcast job' });
            }
        }

        const cancelled = await cancelBroadcastJob(req.params.broadcastId);
        res.json({ broadcastId: req.params.broadcastId, cancelled });
    } catch (error) {
        res.status(500).json({ error: 'Failed to cancel broadcast job' });
    }
});

router.get('/command-list', requireAuth, async (req, res) => {
    try {
        const list = getCommandList();
        res.json(list);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load command list' });
    }
});

router.get('/:deviceId/presets', requireAuth, checkDeviceAccess, async (req, res) => {
    try {
        const device = await Device.findByPk(req.params.deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const deviceType = device?.customFields?.deviceType || device?.customFields?.type || null;
        const presets = getPresetsForType(deviceType);
        return res.json({ deviceType: deviceType || 'default', presets });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to load presets' });
    }
});

router.get('/:deviceId/history', requireAuth, checkDeviceAccess, async (req, res) => {
    try {
        const commands = await DeviceCommand.findAll({
            where: {
                deviceId: req.params.deviceId
            },
            order: [['createdAt', 'DESC']],
            limit: 100
        });
        res.json(commands);
    } catch (error) {
        res.status(500).json({ error: 'Failed to load command history' });
    }
});

router.post('/:deviceId/send', requireAuth, checkDeviceAccess, async (req, res) => {
    try {
        const { commandText, commandNumber, payloadHex, priority, maxRetries } = req.body || {};
        if (!commandText && !payloadHex) {
            return res.status(400).json({ error: 'commandText or payloadHex is required' });
        }

        const device = await Device.findByPk(req.params.deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const parsedCommandNumber = commandNumber !== undefined && commandNumber !== null && commandNumber !== ''
            ? Number(commandNumber)
            : null;
        // Prefer unsigned 32-bit ids that still fit Postgres INTEGER (signed INT4)
        const effectiveCommandNumber = Number.isFinite(parsedCommandNumber)
            ? (parsedCommandNumber >>> 0)
            : (!payloadHex && commandText ? Math.floor(Math.random() * 0x7FFFFFFF) : null);

        const commandRecord = await DeviceCommand.create({
            deviceId: device.id,
            imei: device.imei,
            commandText: commandText || null,
            commandNumber: effectiveCommandNumber,
            rawPayloadHex: payloadHex || null,
            status: 'queued',
            priority: typeof priority === 'number' ? priority : 5,
            maxRetries: typeof maxRetries === 'number' ? maxRetries : 5,
            createdBy: req.user?.userId || null
        });

        await commandQueue.processQueue();

        res.json({
            commandId: commandRecord.id,
            status: commandRecord.status
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to queue command' });
    }
});

router.post('/send-bulk', requireAuth, async (req, res) => {
    try {
        const { deviceIds, commandText, commandNumber, payloadHex, priority, maxRetries } = req.body || {};
        if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
            return res.status(400).json({ error: 'deviceIds array is required' });
        }
        if (!commandText && !payloadHex) {
            return res.status(400).json({ error: 'commandText or payloadHex is required' });
        }

        const parsedCommandNumber = commandNumber !== undefined && commandNumber !== null && commandNumber !== ''
            ? Number(commandNumber)
            : null;

        const results = [];
        for (const deviceId of deviceIds) {
            const access = await resolveDeviceAccess(req.user, deviceId);
            if (!access.allowed) {
                results.push({ deviceId, error: access.error || 'Access denied' });
                continue;
            }

            const effectiveCommandNumber = Number.isFinite(parsedCommandNumber)
                ? (parsedCommandNumber >>> 0)
                : (!payloadHex && commandText ? Math.floor(Math.random() * 0x7FFFFFFF) : null);

            const commandRecord = await DeviceCommand.create({
                deviceId: access.device.id,
                imei: access.device.imei,
                commandText: commandText || null,
                commandNumber: effectiveCommandNumber,
                rawPayloadHex: payloadHex || null,
                status: 'queued',
                priority: typeof priority === 'number' ? priority : 5,
                maxRetries: typeof maxRetries === 'number' ? maxRetries : 5,
                createdBy: req.user?.userId || null
            });

            results.push({ deviceId, commandId: commandRecord.id, status: commandRecord.status });
        }

        await commandQueue.processQueue();

        res.json({
            total: results.length,
            results
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to queue commands' });
    }
});

router.get('/queue/stats', requireAuth, async (req, res) => {
    try {
        const counts = await DeviceCommand.findAll({
            attributes: ['status', [DeviceCommand.sequelize.fn('count', DeviceCommand.sequelize.col('status')), 'count']],
            group: ['status']
        });
        res.json(counts);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch queue stats' });
    }
});

router.get('/archivestat', requireAuth, async (req, res) => {
    try {
        const allStats = await archiveStatStore.getAllStats();
        const connectedImeis = new Set(connectionRegistry.getConnectedImeis() || []);
        const enriched = allStats.map((item) => ({
            ...item,
            isConnected: connectedImeis.has(item.imei)
        }));

        if (req.user.role === 'admin') {
            return res.json(enriched);
        }

        const imeis = await getAccessibleImeis(req.user);
        if (!imeis || imeis.length === 0) {
            return res.json([]);
        }

        const filtered = enriched.filter((item) => imeis.includes(item.imei));
        res.json(filtered);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch archive stats' });
    }
});

module.exports = router;
