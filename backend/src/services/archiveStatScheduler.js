// backend/src/services/archiveStatScheduler.js

const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { Device, DeviceCommand } = require('../models');
const connectionRegistry = require('./connectionRegistry');
const commandQueue = require('./commandQueue');
const archiveStatStore = require('./archiveStatStore');

class ArchiveStatScheduler {
    constructor() {
        this.intervalId = null;
        this.stopped = false;
    }

    start(intervalMs = 60000) {
        this.stopped = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        this.intervalId = setInterval(() => {
            this.process().catch(error => {
                if (this.stopped) {
                    return;
                }
                if (error?.message?.includes('connection manager was closed')) {
                    logger.debug('ArchiveStat scheduler skipped after database shutdown');
                    return;
                }
                logger.error('ArchiveStat scheduler error:', error);
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

    async process() {
        if (this.stopped) {
            return;
        }
        const connectedImeis = connectionRegistry.getConnectedImeis();
        if (!connectedImeis || connectedImeis.length === 0) {
            return;
        }

        const devices = await Device.findAll({
            where: { imei: { [Op.in]: connectedImeis } }
        });

        let queued = 0;
        for (const device of devices) {
            if (!archiveStatStore.shouldSendArchivestat(device.imei, 60000)) {
                continue;
            }

            // Stay within Postgres INTEGER / DeviceCommands.commandNumber (signed INT4)
            const commandNumber = Math.floor(Math.random() * 0x7FFFFFFF);
            await DeviceCommand.create({
                deviceId: device.id,
                imei: device.imei,
                commandText: 'ARCHIVESTAT',
                commandNumber,
                status: 'queued',
                priority: 5,
                maxRetries: 3,
                createdBy: null
            });
            archiveStatStore.markArchivestatSent(device.imei);
            queued += 1;
        }

        if (queued > 0) {
            await commandQueue.processQueue();
            logger.info('ARCHIVESTAT queued', { count: queued });
        }
    }
}

module.exports = new ArchiveStatScheduler();
