// backend/src/models/index.js
const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

// Import model definitions
const defineDevice = require('./device');
const defineFieldMapping = require('./mapping');
const defineAlertRule = require('./alertRule');
const defineRecord = require('./record');
const defineAlert = require('./alert');
const defineUser = require('./user');
const defineDeviceGroup = require('./deviceGroup');
const defineUserDeviceAccess = require('./userDeviceAccess');
const defineUserDeviceGroupAccess = require('./userDeviceGroupAccess');
const defineRole = require('./role');
const defineDeviceCommand = require('./deviceCommand');
const defineDeviceArchiveStat = require('./deviceArchiveStat');

const { buildSequelizeOptions } = require('../config/database');

const dbConfig = buildSequelizeOptions();
const sequelize = dbConfig.url
    ? new Sequelize(dbConfig.url, dbConfig.options)
    : new Sequelize(dbConfig.options);

// Initialize models
const Device = defineDevice(sequelize);
const FieldMapping = defineFieldMapping(sequelize);
const AlertRule = defineAlertRule(sequelize);
const Record = defineRecord(sequelize);
const Alert = defineAlert(sequelize);
const User = defineUser(sequelize);
const DeviceGroup = defineDeviceGroup(sequelize);
const UserDeviceAccess = defineUserDeviceAccess(sequelize);
const UserDeviceGroupAccess = defineUserDeviceGroupAccess(sequelize);
const Role = defineRole(sequelize);
const DeviceCommand = defineDeviceCommand(sequelize);
const DeviceArchiveStat = defineDeviceArchiveStat(sequelize);

// Setup associations
Device.hasMany(FieldMapping, {
    foreignKey: 'deviceId',
    as: 'mappings'
});

AlertRule.hasMany(Alert, {
    foreignKey: 'ruleId',
    as: 'alerts'
});

Alert.belongsTo(AlertRule, {
    foreignKey: 'ruleId',
    as: 'rule'
});

// User Management Associations
User.hasMany(UserDeviceAccess, {
    foreignKey: 'userId',
    as: 'userDeviceAccess'
});

User.hasMany(UserDeviceGroupAccess, {
    foreignKey: 'userId',
    as: 'userGroupAccess'
});

User.hasMany(DeviceGroup, {
    foreignKey: 'createdBy',
    as: 'createdGroups'
});

Device.hasMany(UserDeviceAccess, {
    foreignKey: 'deviceId',
    as: 'deviceUserAccess'  // CHANGED: was 'userAccess'
});

Device.belongsTo(DeviceGroup, {
    foreignKey: 'groupId',
    as: 'group'
});

DeviceGroup.hasMany(Device, {
    foreignKey: 'groupId',
    as: 'devices'
});

DeviceGroup.hasMany(UserDeviceGroupAccess, {
    foreignKey: 'groupId',
    as: 'userGroupAccess'
});

DeviceGroup.belongsTo(User, {
    foreignKey: 'createdBy',
    as: 'creator'
});

UserDeviceAccess.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
});

UserDeviceAccess.belongsTo(Device, {
    foreignKey: 'deviceId',
    as: 'device'
});

UserDeviceAccess.belongsTo(User, {
    foreignKey: 'grantedBy',
    as: 'grantedByUser'
});

UserDeviceGroupAccess.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
});

UserDeviceGroupAccess.belongsTo(DeviceGroup, {
    foreignKey: 'groupId',
    as: 'group'
});

UserDeviceGroupAccess.belongsTo(User, {
    foreignKey: 'grantedBy',
    as: 'grantedByUser'
});

// Role Management Associations
User.belongsTo(Role, {
    foreignKey: 'roleId',
    as: 'userRole'
});

Role.hasMany(User, {
    foreignKey: 'roleId',
    as: 'users'
});

Role.belongsTo(User, {
    foreignKey: 'createdBy',
    as: 'creator'
});

// Device command associations
Device.hasMany(DeviceCommand, {
    foreignKey: 'deviceId',
    as: 'commands'
});

DeviceCommand.belongsTo(Device, {
    foreignKey: 'deviceId',
    as: 'device'
});

// Add user device access associations
User.belongsToMany(Device, {
    through: UserDeviceAccess,
    foreignKey: 'userId',
    otherKey: 'deviceId',
    as: 'deviceAccess'
});

Device.belongsToMany(User, {
    through: UserDeviceAccess,
    foreignKey: 'deviceId',
    otherKey: 'userId',
    as: 'userAccess'
});

// Add user device group access associations
User.belongsToMany(DeviceGroup, {
    through: UserDeviceGroupAccess,
    foreignKey: 'userId',
    otherKey: 'groupId',
    as: 'groupAccess'
});

DeviceGroup.belongsToMany(User, {
    through: UserDeviceGroupAccess,
    foreignKey: 'groupId',
    otherKey: 'userId',
    as: 'groupUserAccess'
});

// Export models and Sequelize instance
module.exports = {
    sequelize,
    Device,
    FieldMapping,
    AlertRule,
    Record,
    Alert,
    User,
    DeviceGroup,
    UserDeviceAccess,
    UserDeviceGroupAccess,
    Role,
    DeviceCommand,
    DeviceArchiveStat
};