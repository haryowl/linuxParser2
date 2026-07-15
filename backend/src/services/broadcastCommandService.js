'use strict';

const { randomUUID } = require('crypto');
const { Op } = require('sequelize');
const { Device, DeviceCommand } = require('../models');
const connectionRegistry = require('./connectionRegistry');

function buildEffectiveCommandNumber(commandNumber, commandText, payloadHex) {
    const parsed = commandNumber !== undefined && commandNumber !== null && commandNumber !== ''
        ? Number(commandNumber)
        : null;
    if (Number.isFinite(parsed)) {
        return parsed >>> 0;
    }
    if (!payloadHex && commandText) {
        // Keep within signed INT4 range used by DeviceCommands.commandNumber (Postgres INTEGER)
        return Math.floor(Math.random() * 0x7FFFFFFF);
    }
    return null;
}

async function createBroadcastCommands(user, devices, options) {
    const {
        commandText,
        commandNumber,
        payloadHex,
        priority,
        maxRetries
    } = options;

    if (!commandText && !payloadHex) {
        throw new Error('commandText or payloadHex is required');
    }
    if (!Array.isArray(devices) || devices.length === 0) {
        throw new Error('No accessible devices found for this broadcast target');
    }

    const broadcastId = randomUUID();
    const sharedCommandNumber = buildEffectiveCommandNumber(commandNumber, commandText, payloadHex);
    const created = [];

    for (const device of devices) {
        // Unique id per device so replies map cleanly (same text, different 0xE0).
        // If caller forced commandNumber, keep it shared intentionally.
        const deviceCommandNumber = commandNumber !== undefined && commandNumber !== null && commandNumber !== ''
            ? sharedCommandNumber
            : buildEffectiveCommandNumber(undefined, commandText, payloadHex);

        const record = await DeviceCommand.create({
            deviceId: device.id,
            imei: device.imei,
            commandText: commandText || null,
            commandNumber: deviceCommandNumber,
            rawPayloadHex: payloadHex || null,
            status: 'queued',
            priority: typeof priority === 'number' ? priority : 5,
            maxRetries: typeof maxRetries === 'number' ? maxRetries : 50,
            createdBy: user?.userId || null,
            broadcastId
        });
        created.push({
            commandId: record.id,
            deviceId: device.id,
            imei: device.imei,
            deviceName: device.name,
            status: record.status,
            commandNumber: record.commandNumber
        });
    }

    return {
        broadcastId,
        commandText: commandText || null,
        commandNumber: sharedCommandNumber,
        totalDevices: created.length,
        items: created
    };
}

async function summarizeBroadcastJobs(accessibleBroadcastIds = null) {
    const where = {
        broadcastId: { [Op.ne]: null }
    };

    if (Array.isArray(accessibleBroadcastIds)) {
        if (!accessibleBroadcastIds.length) {
            return [];
        }
        where.broadcastId = { [Op.in]: accessibleBroadcastIds };
    }

    const rows = await DeviceCommand.findAll({
        where,
        attributes: [
            'broadcastId',
            'commandText',
            'commandNumber',
            'createdAt',
            'status',
            'imei'
        ],
        order: [['createdAt', 'DESC']]
    });

    const jobs = new Map();
    const connected = new Set(connectionRegistry.getConnectedImeis() || []);

    for (const row of rows) {
        if (!jobs.has(row.broadcastId)) {
            jobs.set(row.broadcastId, {
                broadcastId: row.broadcastId,
                commandText: row.commandText,
                commandNumber: row.commandNumber,
                createdAt: row.createdAt,
                totalDevices: 0,
                queued: 0,
                sent: 0,
                replied: 0,
                failed: 0,
                waitingForConnection: 0
            });
        }

        const job = jobs.get(row.broadcastId);
        job.totalDevices += 1;
        if (row.status === 'queued') {
            job.queued += 1;
            if (!connected.has(row.imei)) {
                job.waitingForConnection += 1;
            }
        } else if (row.status === 'sent') {
            job.sent += 1;
        } else if (row.status === 'replied') {
            job.replied += 1;
        } else if (row.status === 'failed') {
            job.failed += 1;
        }
    }

    return Array.from(jobs.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getBroadcastJobDetail(broadcastId) {
    const commands = await DeviceCommand.findAll({
        where: { broadcastId },
        include: [{
            model: Device,
            as: 'device',
            attributes: ['id', 'name', 'imei']
        }],
        order: [['createdAt', 'ASC']]
    });

    if (!commands.length) {
        return null;
    }

    const connected = new Set(connectionRegistry.getConnectedImeis() || []);
    const first = commands[0];

    return {
        broadcastId,
        commandText: first.commandText,
        commandNumber: first.commandNumber,
        createdAt: first.createdAt,
        summary: {
            totalDevices: commands.length,
            queued: commands.filter((item) => item.status === 'queued').length,
            sent: commands.filter((item) => item.status === 'sent').length,
            replied: commands.filter((item) => item.status === 'replied').length,
            failed: commands.filter((item) => item.status === 'failed').length,
            waitingForConnection: commands.filter((item) => item.status === 'queued' && !connected.has(item.imei)).length
        },
        items: commands.map((item) => ({
            id: item.id,
            deviceId: item.deviceId,
            imei: item.imei,
            deviceName: item.device?.name || item.imei,
            status: item.status,
            errorMessage: item.errorMessage,
            isConnected: connected.has(item.imei),
            createdAt: item.createdAt,
            sentAt: item.sentAt,
            repliedAt: item.repliedAt,
            replyText: item.replyText,
            replyDataHex: item.replyDataHex
        }))
    };
}

async function cancelBroadcastJob(broadcastId) {
    const [updated] = await DeviceCommand.update(
        {
            status: 'failed',
            errorMessage: 'Broadcast cancelled by user',
            nextAttemptAt: null
        },
        {
            where: {
                broadcastId,
                status: 'queued'
            }
        }
    );

    return updated;
}

async function getBroadcastIdsForUser(userId) {
    const rows = await DeviceCommand.findAll({
        where: {
            broadcastId: { [Op.ne]: null },
            createdBy: userId
        },
        attributes: ['broadcastId'],
        group: ['broadcastId']
    });
    return rows.map((row) => row.broadcastId);
}

module.exports = {
    createBroadcastCommands,
    summarizeBroadcastJobs,
    getBroadcastJobDetail,
    cancelBroadcastJob,
    getBroadcastIdsForUser
};
