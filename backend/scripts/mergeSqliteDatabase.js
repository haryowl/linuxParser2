#!/usr/bin/env node
'use strict';

/**
 * Merge data from an old server SQLite DB into the current (new) production DB.
 *
 * For different IMEIs on old vs new: appends old devices + history, keeps new server users.
 *
 * Usage (on NEW server, app stopped):
 *   cd /opt/linuxParser2/backend
 *   node scripts/mergeSqliteDatabase.js ./data/old-prod.sqlite
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { loadProductionEnv } = require('../src/utils/loadProductionEnv');

loadProductionEnv();

const MERGE_TABLES = [
  {
    name: 'device_groups',
    conflictColumn: 'id',
    extraWhere: 'name NOT IN (SELECT name FROM main.device_groups)'
  },
  { name: 'Devices', conflictColumn: 'imei', remapGroupId: true },
  { name: 'FieldMappings', conflictColumn: 'id' },
  { name: 'AlertRules', conflictColumn: 'id' },
  { name: 'alerts', conflictColumn: 'id' },
  {
    name: 'user_device_access',
    conflictColumn: 'id',
    skipIfMissingRefs: 'device_access'
  },
  {
    name: 'user_device_group_access',
    conflictColumn: 'id',
    skipIfMissingRefs: 'group_access'
  },
  {
    name: 'roles',
    conflictColumn: 'id',
    extraWhere: 'name NOT IN (SELECT name FROM main.roles)'
  },
  {
    name: 'Records',
    conflictColumn: null,
    extraWhere: 'deviceImei IN (SELECT imei FROM olddb.Devices)'
  }
];

function openDb(filename) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filename, (err) => (err ? reject(err) : resolve(db)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function tableExists(db, table, schema) {
  const row = await get(
    db,
    `SELECT name FROM ${schema}.sqlite_master WHERE type='table' AND name=?`,
    [table]
  );
  return Boolean(row);
}

async function getColumns(db, table, schema) {
  const rows = await all(db, `PRAGMA ${schema}.table_info("${table}")`);
  return rows.map((c) => c.name);
}

async function countRows(db, table, schema) {
  const row = await get(db, `SELECT COUNT(*) AS c FROM ${schema}.${table}`);
  return row.c;
}

function buildColumnList(mainCols, oldCols) {
  return mainCols.filter((c) => oldCols.includes(c));
}

async function mergeTable(db, spec, stats) {
  const { name, conflictColumn, extraWhere, remapGroupId, skipIfMissingRefs } = spec;

  const inMain = await tableExists(db, name, 'main');
  const inOld = await tableExists(db, name, 'olddb');
  if (!inMain || !inOld) {
    console.log(`  skip ${name} (missing on ${!inMain ? 'new' : 'old'} DB)`);
    return;
  }

  const mainCols = await getColumns(db, name, 'main');
  const oldCols = await getColumns(db, name, 'olddb');
  const cols = buildColumnList(mainCols, oldCols);

  if (cols.length === 0) {
    console.log(`  skip ${name} (no shared columns)`);
    return;
  }

  const before = await countRows(db, name, 'main');
  const colList = cols.map((c) => `"${c}"`).join(', ');

  const selectCols = cols.map((c) => {
    if (remapGroupId && c === 'groupId') {
      return `CASE
        WHEN o."groupId" IS NULL THEN NULL
        WHEN EXISTS (SELECT 1 FROM main.device_groups g WHERE g.id = o."groupId") THEN o."groupId"
        WHEN EXISTS (
          SELECT 1 FROM main.device_groups g
          WHERE g.name = (SELECT og.name FROM olddb.device_groups og WHERE og.id = o."groupId")
        ) THEN (
          SELECT g.id FROM main.device_groups g
          WHERE g.name = (SELECT og.name FROM olddb.device_groups og WHERE og.id = o."groupId")
          LIMIT 1
        )
        ELSE NULL
      END AS "groupId"`;
    }
    return `o."${c}"`;
  }).join(', ');

  let where = '1=1';
  if (conflictColumn) {
    where += ` AND o."${conflictColumn}" NOT IN (SELECT "${conflictColumn}" FROM main.${name})`;
  }
  if (extraWhere) {
    where += ` AND (${extraWhere})`;
  }
  if (skipIfMissingRefs === 'device_access') {
    where += ' AND o."userId" IN (SELECT id FROM main.users) AND o."deviceId" IN (SELECT id FROM main.Devices)';
  }
  if (skipIfMissingRefs === 'group_access') {
    where += ' AND o."userId" IN (SELECT id FROM main.users) AND o."groupId" IN (SELECT id FROM main.device_groups)';
  }

  const sql = `
    INSERT INTO main.${name} (${colList})
    SELECT ${selectCols}
    FROM olddb.${name} o
    WHERE ${where}
  `;

  await run(db, 'BEGIN');
  try {
    await run(db, sql);
    await run(db, 'COMMIT');
    const after = await countRows(db, name, 'main');
    stats[name] = after - before;
    console.log(`  ${name}: +${after - before} rows (${before} -> ${after})`);
  } catch (error) {
    await run(db, 'ROLLBACK');
    throw new Error(`${name}: ${error.message}`);
  }
}

async function main() {
  const oldDbPath = path.resolve(process.argv[2] || '');
  if (!oldDbPath || !fs.existsSync(oldDbPath)) {
    console.error('Usage: node scripts/mergeSqliteDatabase.js /path/to/old-prod.sqlite');
    process.exit(1);
  }

  const { buildSequelizeOptions } = require('../src/config/database');
  const newDbPath = buildSequelizeOptions().options.storage;

  console.log('Merge SQLite databases');
  console.log('  New (target):', newDbPath);
  console.log('  Old (source):', oldDbPath);

  const backupPath = `${newDbPath}.pre-merge-${Date.now()}`;
  fs.copyFileSync(newDbPath, backupPath);
  console.log('  Backup:', backupPath);

  const db = await openDb(newDbPath);
  const attachPath = oldDbPath.replace(/'/g, "''");
  await run(db, `ATTACH DATABASE '${attachPath}' AS olddb`);

  console.log('\nPre-merge counts:');
  for (const table of ['Devices', 'Records', 'device_groups', 'users']) {
    if (await tableExists(db, table, 'main')) {
      const mainCount = await countRows(db, table, 'main');
      const oldCount = (await tableExists(db, table, 'olddb'))
        ? await countRows(db, table, 'olddb')
        : 0;
      console.log(`  ${table}: new=${mainCount} old=${oldCount}`);
    }
  }

  console.log('\nMerging (new server users are kept)...');
  const stats = {};

  for (const spec of MERGE_TABLES) {
    await mergeTable(db, spec, stats);
  }

  await run(db, 'DETACH olddb');
  await new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));

  console.log('\nDone.');
  Object.entries(stats).forEach(([table, n]) => console.log(`  ${table}: +${n}`));
  console.log('\nNext:');
  console.log('  cd /opt/linuxParser2 && pm2 start ecosystem.config.js');
  console.log('  sqlite3 backend/data/prod.sqlite "SELECT COUNT(*) FROM Records;"');
}

main().catch((error) => {
  console.error('Merge failed:', error.message);
  process.exit(1);
});
