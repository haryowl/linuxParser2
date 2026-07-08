'use strict';

const { DataTypes } = require('sequelize');
const logger = require('./logger');

const DEVICE_LOCATION_COLUMNS = [
    { name: 'lastLatitude', type: DataTypes.FLOAT },
    { name: 'lastLongitude', type: DataTypes.FLOAT },
    { name: 'lastLocationAt', type: DataTypes.DATE },
    { name: 'lastSpeed', type: DataTypes.FLOAT },
    { name: 'lastDirection', type: DataTypes.FLOAT },
    { name: 'lastAltitude', type: DataTypes.FLOAT },
    { name: 'lastSatellites', type: DataTypes.INTEGER },
    { name: 'lastHdop', type: DataTypes.FLOAT }
];

let cachedDeviceColumns = null;
let cachedAt = 0;
const CACHE_MS = 60 * 1000;

async function getTableColumns(sequelize, tableName) {
    const dialect = sequelize.getDialect();
    if (dialect === 'sqlite') {
        const [rows] = await sequelize.query(`PRAGMA table_info("${tableName}")`);
        return new Set((rows || []).map((row) => row.name));
    }

    const queryInterface = sequelize.getQueryInterface();
    const desc = await queryInterface.describeTable(tableName);
    return new Set(Object.keys(desc || {}));
}

async function refreshDeviceColumnCache(sequelize) {
    cachedDeviceColumns = await getTableColumns(sequelize, 'Devices');
    cachedAt = Date.now();
    return cachedDeviceColumns;
}

async function getDeviceTableColumns(sequelize, { force = false } = {}) {
    if (!force && cachedDeviceColumns && (Date.now() - cachedAt) < CACHE_MS) {
        return cachedDeviceColumns;
    }
    return refreshDeviceColumnCache(sequelize);
}

/**
 * Filter requested attributes to columns that actually exist in the Devices table.
 * Model attributes alone are not enough — Sequelize may declare columns not yet migrated.
 */
async function filterExistingDeviceAttributes(sequelize, desiredAttributes) {
    const columns = await getDeviceTableColumns(sequelize);
    const filtered = desiredAttributes.filter((attr) => columns.has(attr));
    if (filtered.length === 0) {
        // Absolute fallback — never pass an empty attributes list
        return ['id', 'name', 'imei', 'status', 'lastSeen'].filter((attr) => columns.has(attr));
    }
    return filtered;
}

function hasDeviceColumn(columnName) {
    return Boolean(cachedDeviceColumns && cachedDeviceColumns.has(columnName));
}

async function ensureDeviceLocationColumns(sequelize) {
    const queryInterface = sequelize.getQueryInterface();
    let existing;

    try {
        existing = await getTableColumns(sequelize, 'Devices');
    } catch (error) {
        logger.warn('Could not read Devices table schema before ensuring location columns', {
            error: error.message
        });
        existing = new Set();
    }

    for (const column of DEVICE_LOCATION_COLUMNS) {
        if (existing.has(column.name)) {
            continue;
        }

        try {
            await queryInterface.addColumn('Devices', column.name, {
                type: column.type,
                allowNull: true
            });
            logger.info(`Added Devices.${column.name}`);
            existing.add(column.name);
        } catch (error) {
            const message = error?.message || '';
            if (message.includes('duplicate column') || message.includes('already exists')) {
                logger.debug(`Devices.${column.name} already exists`);
                existing.add(column.name);
            } else {
                logger.warn(`Could not add Devices.${column.name}: ${message}`);
            }
        }
    }

    cachedDeviceColumns = existing;
    cachedAt = Date.now();

    const missing = DEVICE_LOCATION_COLUMNS
        .map((column) => column.name)
        .filter((name) => !existing.has(name));

    if (missing.length > 0) {
        logger.warn('Devices GPS location columns still missing after ensure', { missing });
    } else {
        logger.info('Devices GPS location columns ready', {
            columns: DEVICE_LOCATION_COLUMNS.map((column) => column.name)
        });
    }

    return existing;
}

module.exports = {
    ensureDeviceLocationColumns,
    DEVICE_LOCATION_COLUMNS,
    getDeviceTableColumns,
    filterExistingDeviceAttributes,
    hasDeviceColumn,
    refreshDeviceColumnCache
};
