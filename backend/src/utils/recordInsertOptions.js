'use strict';

const { resolveDialect, isPostgresDialect } = require('../config/database');

const DEDUP_FIELDS = ['deviceImei', 'datetime', 'recordNumber'];

function isDuplicateKeyError(error) {
  if (!error) {
    return false;
  }
  if (error.name === 'SequelizeUniqueConstraintError') {
    return true;
  }
  const code = error.original?.code || error.parent?.code;
  if (code === '23505' || code === 'SQLITE_CONSTRAINT') {
    return true;
  }
  const message = error.message || '';
  return message.includes('UNIQUE constraint failed') || message.includes('duplicate key value');
}

function getBulkInsertOptions(extra = {}) {
  const options = {
    validate: false,
    ignoreDuplicates: true,
    ...extra
  };

  if (isPostgresDialect(resolveDialect())) {
    options.conflictFields = DEDUP_FIELDS;
  }

  return options;
}

function getDefaultFlushAckTimeoutMs() {
  const configured = parseInt(process.env.FLUSH_ACK_TIMEOUT_MS, 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return isPostgresDialect(resolveDialect()) ? 8000 : 2000;
}

module.exports = {
  DEDUP_FIELDS,
  isDuplicateKeyError,
  getBulkInsertOptions,
  getDefaultFlushAckTimeoutMs
};
