// backend/src/services/archiveStatStore.js

const logger = require('../utils/logger');

class ArchiveStatStore {
    constructor() {
        this.statsByImei = new Map();
        this.lastSentAt = new Map();
        this.lastOutSentAt = new Map();
        this.loadedFromDb = false;
    }

    getDeviceArchiveStatModel() {
        return require('../models').DeviceArchiveStat;
    }

    toPlainStat(row) {
        if (!row) {
            return null;
        }
        const json = typeof row.toJSON === 'function' ? row.toJSON() : row;
        return {
            imei: json.imei,
            deviceId: json.deviceId,
            deviceName: json.deviceName,
            total: json.total,
            serv1Transmitted: json.serv1Transmitted,
            serv1Queue: json.serv1Queue,
            serv2Transmitted: json.serv2Transmitted,
            serv2Queue: json.serv2Queue,
            rawReply: json.rawReply,
            updatedAt: json.updatedAt
        };
    }

    async loadFromDatabase() {
        try {
            const DeviceArchiveStat = this.getDeviceArchiveStatModel();
            const rows = await DeviceArchiveStat.findAll({
                order: [['updatedAt', 'DESC']]
            });
            this.statsByImei.clear();
            for (const row of rows) {
                const stat = this.toPlainStat(row);
                if (stat?.imei) {
                    this.statsByImei.set(stat.imei, stat);
                }
            }
            this.loadedFromDb = true;
            logger.info('Loaded archive stats from database', { count: rows.length });
        } catch (error) {
            logger.warn('Could not load archive stats from database:', error.message);
        }
    }

    async persistStats(imei, stats) {
        try {
            const DeviceArchiveStat = this.getDeviceArchiveStatModel();
            await DeviceArchiveStat.upsert({
                imei,
                deviceId: stats.deviceId || null,
                deviceName: stats.deviceName || imei,
                total: stats.total ?? null,
                serv1Transmitted: stats.serv1Transmitted ?? null,
                serv1Queue: stats.serv1Queue ?? null,
                serv2Transmitted: stats.serv2Transmitted ?? null,
                serv2Queue: stats.serv2Queue ?? null,
                rawReply: stats.rawReply || null,
                updatedAt: stats.updatedAt || new Date()
            });
        } catch (error) {
            logger.error('Failed to persist archive stats:', { imei, error: error.message });
        }
    }

    updateStats(imei, stats) {
        if (!imei) {
            return;
        }
        const next = {
            ...stats,
            imei,
            updatedAt: new Date().toISOString()
        };
        this.statsByImei.set(imei, next);
        void this.persistStats(imei, next);
    }

    getStats(imei) {
        return this.statsByImei.get(imei) || null;
    }

    async getAllStats() {
        if (!this.loadedFromDb) {
            await this.loadFromDatabase();
        }

        let nameByImei = new Map();
        try {
            const { Device } = require('../models');
            const imeis = Array.from(this.statsByImei.keys());
            if (imeis.length > 0) {
                const devices = await Device.findAll({
                    where: { imei: imeis },
                    attributes: ['imei', 'name']
                });
                nameByImei = new Map(devices.map((device) => [device.imei, device.name]));
            }
        } catch (error) {
            logger.warn('Could not refresh device names for archive stats:', error.message);
        }

        return Array.from(this.statsByImei.values())
            .map((stat) => ({
                ...stat,
                deviceName: nameByImei.get(stat.imei) || stat.deviceName || stat.imei
            }))
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    shouldSendArchivestat(imei, intervalMs = 60000) {
        const last = this.lastSentAt.get(imei);
        if (!last) {
            return true;
        }
        return Date.now() - last.getTime() >= intervalMs;
    }

    markArchivestatSent(imei) {
        this.lastSentAt.set(imei, new Date());
    }

    shouldSendOut(imei, cooldownMs = 300000) {
        const last = this.lastOutSentAt.get(imei);
        if (!last) {
            return true;
        }
        return Date.now() - last.getTime() >= cooldownMs;
    }

    markOutSent(imei) {
        this.lastOutSentAt.set(imei, new Date());
    }
}

module.exports = new ArchiveStatStore();
