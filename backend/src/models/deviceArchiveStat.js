const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const DeviceArchiveStat = sequelize.define('DeviceArchiveStat', {
        imei: {
            type: DataTypes.STRING,
            primaryKey: true,
            allowNull: false
        },
        deviceId: {
            type: DataTypes.UUID,
            allowNull: true
        },
        deviceName: {
            type: DataTypes.STRING,
            allowNull: true
        },
        total: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        serv1Transmitted: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        serv1Queue: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        serv2Transmitted: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        serv2Queue: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        rawReply: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        updatedAt: {
            type: DataTypes.DATE,
            allowNull: false
        }
    }, {
        tableName: 'device_archive_stats',
        timestamps: false
    });

    return DeviceArchiveStat;
};
