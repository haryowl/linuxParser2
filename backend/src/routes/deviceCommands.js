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
        const effectiveCommandNumber = Number.isFinite(parsedCommandNumber)
            ? parsedCommandNumber
            : (!payloadHex && commandText ? Math.floor(Math.random() * 0xFFFFFFFF) : null);

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
                ? parsedCommandNumber
                : (!payloadHex && commandText ? Math.floor(Math.random() * 0xFFFFFFFF) : null);

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
