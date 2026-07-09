'use strict';

const { resolveDialect, isPostgresDialect } = require('../config/database');

const sessionStore = isPostgresDialect(resolveDialect())
    ? require('./postgresSessionStore')
    : require('./sqliteSessionStore');

module.exports = sessionStore;
