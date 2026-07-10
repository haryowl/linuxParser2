'use strict';

/** Shared Records table index definitions (runtime + manual script). */
const RECORD_INDEXES = [
  { name: 'records_device_imei_idx', fields: ['deviceImei'] },
  { name: 'records_datetime_idx', fields: ['datetime'] },
  { name: 'records_timestamp_idx', fields: ['timestamp'] },
  { name: 'records_device_datetime_idx', fields: ['deviceImei', 'datetime'] },
  { name: 'records_device_id_idx', fields: ['deviceImei', 'id'] }
];

/** Partial unique index for safe device retries (ON CONFLICT DO NOTHING). */
const RECORD_DEDUP_INDEX = {
  name: 'records_dedup_idx',
  fields: ['deviceImei', 'datetime', 'recordNumber'],
  createSql: {
    postgres: `CREATE UNIQUE INDEX IF NOT EXISTS "records_dedup_idx"
      ON "Records" ("deviceImei", "datetime", "recordNumber")
      WHERE "datetime" IS NOT NULL AND "recordNumber" IS NOT NULL`,
    sqlite: `CREATE UNIQUE INDEX IF NOT EXISTS records_dedup_idx
      ON Records (deviceImei, datetime, recordNumber)
      WHERE datetime IS NOT NULL AND recordNumber IS NOT NULL`
  }
};

function buildCreateIndexSql(index) {
  const columns = index.fields.map((field) => `"${field}"`).join(', ');
  return `CREATE INDEX IF NOT EXISTS "${index.name}" ON "Records" (${columns})`;
}

module.exports = { RECORD_INDEXES, RECORD_DEDUP_INDEX, buildCreateIndexSql };
