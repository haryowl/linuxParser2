'use strict';

const logger = require('./logger');

async function ensureDeviceArchiveStatTable(sequelize) {
    const queryInterface = sequelize.getQueryInterface();
    const tables = await queryInterface.showAllTables();
    const tableNames = tables.map((t) => t.toString());

    if (tableNames.includes('device_archive_stats')) {
        return;
    }

    await queryInterface.createTable('device_archive_stats', {
        imei: {
            type: sequelize.Sequelize.STRING,
            primaryKey: true,
            allowNull: false
        },
        deviceId: {
            type: sequelize.Sequelize.UUID,
            allowNull: true
        },
        deviceName: {
            type: sequelize.Sequelize.STRING,
            allowNull: true
        },
        total: {
            type: sequelize.Sequelize.INTEGER,
            allowNull: true
        },
        serv1Transmitted: {
            type: sequelize.Sequelize.INTEGER,
            allowNull: true
        },
        serv1Queue: {
            type: sequelize.Sequelize.INTEGER,
            allowNull: true
        },
        serv2Transmitted: {
            type: sequelize.Sequelize.INTEGER,
            allowNull: true
        },
        serv2Queue: {
            type: sequelize.Sequelize.INTEGER,
            allowNull: true
        },
        rawReply: {
            type: sequelize.Sequelize.TEXT,
            allowNull: true
        },
        updatedAt: {
            type: sequelize.Sequelize.DATE,
            allowNull: false
        }
    });

    logger.info('Created device_archive_stats table');
}

module.exports = { ensureDeviceArchiveStatTable };
