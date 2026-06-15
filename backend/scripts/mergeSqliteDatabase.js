#!/usr/bin/env node
'use strict';

/**
 * Merge data from an old server SQLite DB into the current (new) production DB.
 *
 * Usage (app stopped):
 *   cd /opt/linuxParser2/backend
 *   node scripts/mergeSqliteDatabase.js ./data/old-prod.sqlite
 *   node scripts/mergeSqliteDatabase.js ./data/old-prod.sqlite --skip-records
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sqlite3 = require('sqlite3');
const { loadProductionEnv } = require('../src/utils/loadProductionEnv');

loadProductionEnv();

const args = process.argv.slice(2);
const skipRecords = args.includes('--skip-records');
const oldDbPath = path.resolve(args.find((a) => !a.startsWith('--')) || '');

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
  }
];

function openDb(filename, readonly = false) {
  const mode = readonly ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE;
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filename, mode, (err) => (err ? reject(err) : resolve(db)));
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

function isCorruptError(err) {
  const msg = (err && err.message) || String(err);
  return /malformed|SQLITE_CORRUPT|disk image/i.test(msg);
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

async function safeCount(db, table, schema) {
  try {
    const row = await get(db, `SELECT COUNT(*) AS c FROM ${schema}."${table}"`);
    return row.c;
  } catch (error) {
    return { error: error.message };
  }
}

async function probeOldTable(db, table) {
  try {
    await get(db, `SELECT 1 FROM olddb."${table}" LIMIT 1`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function buildColumnList(mainCols, oldCols) {
  return mainCols.filter((c) => oldCols.includes(c));
}

function buildMergeSql(spec, cols) {
  const { name, conflictColumn, extraWhere, remapGroupId, skipIfMissingRefs } = spec;
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
    where += ` AND o."${conflictColumn}" NOT IN (SELECT "${conflictColumn}" FROM main."${name}")`;
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
    INSERT INTO main."${name}" (${colList})
    SELECT ${selectCols}
    FROM olddb."${name}" o
    WHERE ${where}
  `;

  return sql;
}

async function mergeTable(db, spec, stats, failed) {
  const { name } = spec;

  const inMain = await tableExists(db, name, 'main');
  const inOld = await tableExists(db, name, 'olddb');
  if (!inMain || !inOld) {
    console.log(`  skip ${name} (missing on ${!inMain ? 'new' : 'old'} DB)`);
    return;
  }

  const probe = await probeOldTable(db, name);
  if (!probe.ok) {
    failed.push({ table: name, error: probe.error });
    console.log(`  skip ${name} (old table unreadable: ${probe.error})`);
    return;
  }

  const mainCols = await getColumns(db, name, 'main');
  const oldCols = await getColumns(db, name, 'olddb');
  const cols = buildColumnList(mainCols, oldCols);

  if (cols.length === 0) {
    console.log(`  skip ${name} (no shared columns)`);
    return;
  }

  const before = await countRowsSafe(db, name, 'main');
  const sql = buildMergeSql(spec, cols);

  await run(db, 'BEGIN');
  try {
    await run(db, sql);
    await run(db, 'COMMIT');
    const after = await countRowsSafe(db, name, 'main');
    stats[name] = after - before;
    console.log(`  ${name}: +${after - before} rows (${before} -> ${after})`);
  } catch (error) {
    await run(db, 'ROLLBACK').catch(() => {});
    failed.push({ table: name, error: error.message });
    console.log(`  FAILED ${name}: ${error.message}`);
  }
}

async function countRowsSafe(db, table, schema) {
  const row = await get(db, `SELECT COUNT(*) AS c FROM ${schema}."${table}"`);
  return row.c;
}

async function mergeRecordsBatched(db, stats, failed) {
  const name = 'Records';
  const inMain = await tableExists(db, name, 'main');
  const inOld = await tableExists(db, name, 'olddb');
  if (!inMain || !inOld) {
    console.log(`  skip ${name} (missing)`);
    return;
  }

  const probe = await probeOldTable(db, name);
  if (!probe.ok) {
    failed.push({ table: name, error: probe.error });
    console.log(`  skip ${name} (old table unreadable: ${probe.error})`);
    return;
  }

  const mainCols = await getColumns(db, name, 'main');
  const oldCols = await getColumns(db, name, 'olddb');
  const cols = buildColumnList(mainCols, oldCols);
  if (cols.length === 0) {
    console.log(`  skip ${name} (no shared columns)`);
    return;
  }

  let imeis = [];
  try {
    imeis = await all(db, 'SELECT imei FROM olddb.Devices ORDER BY imei');
  } catch (error) {
    failed.push({ table: name, error: `Cannot read old Devices: ${error.message}` });
    console.log(`  skip ${name} (${error.message})`);
    return;
  }

  const before = await countRowsSafe(db, name, 'main');
  const colList = cols.map((c) => `"${c}"`).join(', ');
  let inserted = 0;
  let skippedImeis = 0;

  console.log(`  ${name}: merging per device (${imeis.length} IMEIs)...`);

  for (const { imei } of imeis) {
    const sql = `
      INSERT INTO main."${name}" (${colList})
      SELECT ${cols.map((c) => `o."${c}"`).join(', ')}
      FROM olddb."${name}" o
      WHERE o."deviceImei" = ?
        AND NOT EXISTS (
          SELECT 1 FROM main."${name}" n
          WHERE n."deviceImei" = o."deviceImei"
            AND n."timestamp" = o."timestamp"
            AND (n."datetime" = o."datetime" OR (n."datetime" IS NULL AND o."datetime" IS NULL))
        )
    `;

    await run(db, 'BEGIN');
    try {
      const result = await run(db, sql, [imei]);
      await run(db, 'COMMIT');
      inserted += result.changes || 0;
    } catch (error) {
      await run(db, 'ROLLBACK').catch(() => {});
      skippedImeis += 1;
      if (!isCorruptError(error)) {
        console.log(`    warn IMEI ${imei}: ${error.message}`);
      }
    }
  }

  const after = await countRowsSafe(db, name, 'main');
  stats[name] = after - before;
  console.log(`  ${name}: +${after - before} rows (${before} -> ${after}), skipped ${skippedImeis} IMEI(s) with errors`);

  if (after === before && isCorruptError({ message: 'probe' }) || skippedImeis === imeis.length) {
    failed.push({
      table: name,
      error: 'Records table corrupt — re-copy prod.sqlite from old server with WAL checkpoint'
    });
  }
}

function runIntegrityCheck(dbPath) {
  const result = spawnSync('sqlite3', [dbPath, 'PRAGMA quick_check;'], { encoding: 'utf8' });
  const out = (result.stdout || '').trim();
  const firstLine = out.split('\n')[0] || '';
  return { ok: firstLine === 'ok', output: out };
}

async function main() {
  if (!oldDbPath || !fs.existsSync(oldDbPath)) {
    console.error('Usage: node scripts/mergeSqliteDatabase.js /path/to/old-prod.sqlite [--skip-records]');
    process.exit(1);
  }

  const { buildSequelizeOptions } = require('../src/config/database');
  const newDbPath = buildSequelizeOptions().options.storage;

  console.log('Merge SQLite databases');
  console.log('  New (target):', newDbPath);
  console.log('  Old (source):', oldDbPath);

  const oldCheck = runIntegrityCheck(oldDbPath);
  if (!oldCheck.ok) {
    console.log('\nWARNING: Old database integrity check failed:');
    console.log(oldCheck.output.split('\n').slice(0, 5).join('\n'));
    console.log('Will merge readable tables only. For full history, re-copy a clean prod.sqlite from old server.\n');
  }

  const backupPath = `${newDbPath}.pre-merge-${Date.now()}`;
  fs.copyFileSync(newDbPath, backupPath);
  console.log('  Backup:', backupPath);

  const db = await openDb(newDbPath);
  const attachPath = oldDbPath.replace(/'/g, "''");
  await run(db, `ATTACH DATABASE '${attachPath}' AS olddb`);

  console.log('\nPre-merge counts:');
  for (const table of ['Devices', 'Records', 'device_groups', 'users']) {
    if (await tableExists(db, table, 'main')) {
      const mainCount = await safeCount(db, table, 'main');
      const oldCount = (await tableExists(db, table, 'olddb'))
        ? await safeCount(db, table, 'olddb')
        : 'n/a';
      const mainStr = typeof mainCount === 'object' ? `ERR: ${mainCount.error}` : mainCount;
      const oldStr = typeof oldCount === 'object' ? `ERR: ${oldCount.error}` : oldCount;
      console.log(`  ${table}: new=${mainStr} old=${oldStr}`);
    }
  }

  console.log('\nMerging (new server users are kept)...');
  const stats = {};
  const failed = [];

  for (const spec of MERGE_TABLES) {
    await mergeTable(db, spec, stats, failed);
  }

  if (!skipRecords) {
    await mergeRecordsBatched(db, stats, failed);
  } else {
    console.log('  skip Records (--skip-records)');
  }

  await run(db, 'DETACH olddb');
  await new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));

  console.log('\nDone.');
  Object.entries(stats).forEach(([table, n]) => console.log(`  ${table}: +${n}`));

  if (failed.length > 0) {
    console.log('\nWarnings / skipped:');
    failed.forEach(({ table, error }) => console.log(`  ${table}: ${error}`));
    console.log('\nIf Records failed: get a fresh copy from old server:');
    console.log('  pm2 stop gali-parse && sqlite3 prod.sqlite "PRAGMA wal_checkpoint(FULL);"');
    console.log('  then scp prod.sqlite to new server as old-prod.sqlite');
  }

  console.log('\nNext:');
  console.log('  cd /opt/linuxParser2 && pm2 start gali-parse');
  console.log('  sqlite3 backend/data/prod.sqlite "SELECT COUNT(*) FROM Records;"');

  if (failed.some((f) => f.table === 'Records' && isCorruptError({ message: f.error }))) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error('Merge failed:', error.message);
  process.exit(1);
});
