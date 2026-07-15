// backend/src/services/commandQueue.js

const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { DeviceCommand } = require('../models');
const connectionRegistry = require('./connectionRegistry');
const { buildCommandPacket } = require('./commandPacketBuilder');

const OFFLINE_RETRY_MS = 10000;

class CommandQueue {
    constructor() {
        this.intervalId = null;
        this.stopped = false;
    }

    start(intervalMs = 5000) {
        this.stopped = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        this.intervalId = setInterval(() => {
            this.processQueue().catch(error => {
                if (this.stopped) {
                    return;
                }
                if (error?.message?.includes('connection manager was closed')) {
                    logger.debug('Command queue skipped after database shutdown');
                    return;
                }
                logger.error('Command queue processing error:', error);
            });
        }, intervalMs);
    }

    stop() {
        this.stopped = true;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    getNextAttemptAt(retryCount) {
        const baseMs = 5000;
        const delay = Math.min(baseMs * Math.pow(2, retryCount), 5 * 60 * 1000);
        return new Date(Date.now() + delay);
    }

    async processQueue() {
        if (this.stopped) {
            return;
        }
        if (!DeviceCommand) {
            logger.error('DeviceCommand model is not loaded. Ensure backend/src/models/index.js exports DeviceCommand and the migration ran.');
            return;
        }
        const now = new Date();
        const commands = await DeviceCommand.findAll({
            where: {
                status: { [Op.in]: ['queued', 'failed'] },
                [Op.or]: [
                    { nextAttemptAt: null },
                    { nextAttemptAt: { [Op.lte]: now } }
                ]
            },
            order: [['priority', 'DESC'], ['createdAt', 'ASC']],
            limit: 50
        });

        for (const command of commands) {
            await this.processCommand(command);
        }
    }

    async processQueueForImei(imei) {
        if (!imei || this.stopped) {
            return;
        }

        const now = new Date();
        const commands = await DeviceCommand.findAll({
            where: {
                imei,
                status: { [Op.in]: ['queued', 'failed'] },
                [Op.or]: [
                    { nextAttemptAt: null },
                    { nextAttemptAt: { [Op.lte]: now } }
                ]
            },
            order: [['priority', 'DESC'], ['createdAt', 'ASC']],
            limit: 20
        });

        for (const command of commands) {
            await this.processCommand(command);
        }
    }

    async processCommand(command) {
        const socket = connectionRegistry.getSocketByImei(command.imei);
        if (!socket || !socket.writable) {
            await command.update({
                status: 'queued',
                errorMessage: 'Waiting for device connection',
                nextAttemptAt: new Date(Date.now() + OFFLINE_RETRY_MS)
            });
            return;
        }

        if (command.retryCount >= command.maxRetries) {
            await command.update({
                status: 'failed',
                errorMessage: 'Max retries exceeded',
                nextAttemptAt: null
            });
            return;
        }

        let packetHex = command.rawPayloadHex;
        if (!packetHex) {
            try {
                const packetInfo = buildCommandPacket({
                    imei: command.imei,
                    deviceNumber: 0,
                    commandNumber: command.commandNumber,
                    commandText: command.commandText
                });
                packetHex = packetInfo.packetHex;
            } catch (error) {
                await this.markFailed(command, error.message);
                return;
            }
        }

        const normalizedHex = packetHex.replace(/^0x/i, '').replace(/\s+/g, '');
        const packet = Buffer.from(normalizedHex, 'hex');
        try {
            // Flip to "sent" before write so a fast device reply can match this row.
            await command.update({
                status: 'sent',
                sentAt: new Date(),
                lastAttemptAt: new Date(),
                errorMessage: null,
                nextAttemptAt: null,
                commandNumber: Number.isFinite(Number(command.commandNumber))
                    ? (Number(command.commandNumber) >>> 0)
                    : command.commandNumber
            });

            logger.info('Sending command packet', {
                commandId: command.id,
                imei: command.imei,
                broadcastId: command.broadcastId || null,
                bytes: packet.length,
                packetHex: normalizedHex.toUpperCase()
            });
            await new Promise((resolve, reject) => {
                socket.write(packet, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        } catch (error) {
            await this.markFailed(command, error.message || 'Socket write failed');
        }
    }

    async markFailed(command, message) {
        const nextAttemptAt = this.getNextAttemptAt(command.retryCount + 1);
        await command.update({
            status: 'failed',
            errorMessage: message,
            retryCount: command.retryCount + 1,
            lastAttemptAt: new Date(),
            nextAttemptAt
        });
    }
}

module.exports = new CommandQueue();
