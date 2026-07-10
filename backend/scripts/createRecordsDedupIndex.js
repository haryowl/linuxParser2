#!/usr/bin/env node
'use strict';

/**
 * Create the Records dedup partial unique index (Postgres or SQLite).
 *
 * Postgres on large DBs: uses CONCURRENTLY to avoid long write locks.
 *
 * Usage:
 *   cd backend
 *   node scripts/createRecordsDedupIndex.js
 *   node scripts/createRecordsDedupIndex.js --check-only
 */

const { loadProductionEnv } = require('../src/utils/loadProductionEnv');
const { buildSequelizeOptions, isPostgresDialect, resolveDialect } = require('../src/config/database');
const { RECORD_DEDUP_INDEX } = require('../src/utils/recordIndexDefinitions');

loadProductionEnv();

const checkOnly = process.argv.includes('--check-only');

async function main() {
  const dialect = resolveDialect();
  const { Sequelize } = require('sequelize');
  const dbConfig = buildSequelizeOptions();
  const sequelize = dbConfig.url
    ? new Sequelize(dbConfig.url, dbConfig.options)
    : new Sequelize(dbConfig.options);

  try {
    await sequelize.authenticate();

    const duplicateSql = isPostgresDialect(dialect)
      ? `SELECT COUNT(*)::bigint AS duplicates FROM (
           SELECT "deviceImei", "datetime", "recordNumber", COUNT(*) AS cnt
           FROM "Records"
           WHERE "datetime" IS NOT NULL AND "recordNumber" IS NOT NULL
           GROUP BY "deviceImei", "datetime", "recordNumber"
           HAVING COUNT(*) > 1
         ) d`
      : `SELECT COUNT(*) AS duplicates FROM (
           SELECT deviceImei, datetime, recordNumber, COUNT(*) AS cnt
           FROM Records
           WHERE datetime IS NOT NULL AND recordNumber IS NOT NULL
           GROUP BY deviceImei, datetime, recordNumber
           HAVING COUNT(*) > 1
         )`;

    const [duplicateRows] = await sequelize.query(duplicateSql);
    const duplicateGroups = Number(duplicateRows[0]?.duplicates || 0);
    console.log(`Duplicate (deviceImei, datetime, recordNumber) groups: ${duplicateGroups}`);

    if (duplicateGroups > 0) {
      console.error('');
      console.error('Cannot create unique dedup index while duplicates exist.');
      console.error('Resolve duplicates first, then re-run this script.');
      process.exit(1);
    }

    if (checkOnly) {
      console.log('Check only — no index changes made.');
      return;
    }

    const baseSql = RECORD_DEDUP_INDEX.createSql[dialect];
    if (!baseSql) {
      console.error(`Unsupported dialect: ${dialect}`);
      process.exit(1);
    }

    if (isPostgresDialect(dialect)) {
      const concurrentSql = baseSql
        .replace('CREATE UNIQUE INDEX IF NOT EXISTS', 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS');
      console.log('Creating dedup index CONCURRENTLY (may take several minutes on large tables)...');
      await sequelize.query(concurrentSql);
    } else {
      console.log('Creating dedup index...');
      await sequelize.query(baseSql);
    }

    console.log(`Dedup index ${RECORD_DEDUP_INDEX.name} is ready.`);
  } finally {
    await sequelize.close();
  }
}

main().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
