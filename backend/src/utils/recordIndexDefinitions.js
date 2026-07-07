'use strict';

/** Shared Records table index definitions (runtime + manual script). */
const RECORD_INDEXES = [
  { name: 'records_device_imei_idx', fields: ['deviceImei'] },
  { name: 'records_datetime_idx', fields: ['datetime'] },
  { name: 'records_timestamp_idx', fields: ['timestamp'] },
  { name: 'records_device_datetime_idx', fields: ['deviceImei', 'datetime'] },
  { name: 'records_device_id_idx', fields: ['deviceImei', 'id'] }
];

function buildCreateIndexSql(index) {
  const columns = index.fields.map((field) => `"${field}"`).join(', ');
  return `CREATE INDEX IF NOT EXISTS "${index.name}" ON "Records" (${columns})`;
}

module.exports = { RECORD_INDEXES, buildCreateIndexSql };
