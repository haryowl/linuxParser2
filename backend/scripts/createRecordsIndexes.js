#!/usr/bin/env node
'use strict';

/**
 * Create Records table indexes on an existing SQLite DB (e.g. old copied prod.sqlite).
 *
 * Stop the app first so the DB is not locked:
 *   pm2 stop gali-parse
 *
 * Usage:
 *   cd /opt/linuxParser2/backend
 *   node scripts/createRecordsIndexes.js
 *   node scripts/createRecordsIndexes.js ./data/prod.sqlite
 *   node scripts/createRecordsIndexes.js ./data/prod.sqlite --list-only
 *   node scripts/createRecordsIndexes.js ./data/prod.sqlite --dry-run
 *
 * After indexes are created:
 *   pm2 start gali-parse
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { loadProductionEnv } = require('../src/utils/loadProductionEnv');
const { buildSequelizeOptions } = require('../src/config/database');
const { RECORD_INDEXES, buildCreateIndexSql } = require('../src/utils/recordIndexDefinitions');

loadProductionEnv();

const args = process.argv.slice(2);
const listOnly = args.includes('--list-only');
const dryRun = args.includes('--dry-run');
const skipIntegrity = args.includes('--skip-integrity-check');
const dbArg = args.find((a) => !a.startsWith('--'));

function resolveDbPath() {
  if (dbArg) {
    return path.resolve(dbArg);
  }
  const { options } = buildSequelizeOptions();
  return options.storage;
}

function openDb(filename) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filename, sqlite3.OPEN_READWRITE, (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function runGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function runAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function runExec(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

function formatDuration(ms) {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${bytes} B`;
}

async function listRecordsIndexes(db) {
  const rows = await runAll(
    db,
    `SELECT name, sql FROM sqlite_master
     WHERE type = 'index' AND tbl_name = 'Records' AND name NOT LIKE 'sqlite_%'
     ORDER BY name`
  );
  return rows;
}

async function tableExists(db, tableName) {
  const row = await runGet(
    db,
    `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName]
  );
  return Boolean(row);
}

async function quickIntegrityCheck(db) {
  try {
    const row = await runGet(db, 'PRAGMA quick_check(1)');
    return row?.quick_check || 'unknown';
  } catch (error) {
    return `error: ${error.message}`;
  }
}

async function main() {
  const dbPath = resolveDbPath();

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(dbPath);
  console.log('Records index setup');
  console.log('===================');
  console.log(`Database: ${dbPath}`);
  console.log(`Size:     ${formatBytes(stat.size)}`);
  console.log('');

  const db = await openDb(dbPath);

  try {
    if (!(await tableExists(db, 'Records'))) {
      console.error('Table "Records" not found in this database.');
      process.exit(1);
    }

    const existing = await listRecordsIndexes(db);
    console.log('Existing Records indexes:');
    if (existing.length === 0) {
      console.log('  (none)');
    } else {
      for (const row of existing) {
        console.log(`  - ${row.name}`);
      }
    }
    console.log('');

    if (listOnly) {
      return;
    }

    const missing = RECORD_INDEXES.filter(
      (index) => !existing.some((row) => row.name === index.name)
    );

    if (missing.length === 0) {
      console.log('All required Records indexes already exist. Nothing to do.');
      return;
    }

    console.log('Indexes to create:');
    for (const index of missing) {
      console.log(`  - ${index.name} (${index.fields.join(', ')})`);
    }
    console.log('');

    if (dryRun) {
      console.log('Dry run — SQL that would run:');
      for (const index of missing) {
        console.log(`  ${buildCreateIndexSql(index)};`);
      }
      return;
    }

    if (!skipIntegrity) {
      const check = await quickIntegrityCheck(db);
      console.log(`PRAGMA quick_check(1): ${check}`);
      if (check !== 'ok') {
        console.warn('');
        console.warn('Warning: database integrity check did not return "ok".');
        console.warn('Indexes may still be created, but fix corruption first if possible.');
        console.warn('Continue anyway with: --skip-integrity-check');
        console.warn('');
      }
    }

    console.log('Applying SQLite pragmas for large index build...');
    await runExec(db, 'PRAGMA journal_mode = WAL;');
    await runExec(db, 'PRAGMA busy_timeout = 60000;');
    await runExec(db, 'PRAGMA synchronous = NORMAL;');

    const totalStart = Date.now();

    for (const index of missing) {
      const sql = buildCreateIndexSql(index);
      const start = Date.now();
      console.log(`Creating ${index.name} ...`);
      await runExec(db, sql);
      console.log(`  done in ${formatDuration(Date.now() - start)}`);
    }

    console.log('');
    console.log('Running ANALYZE Records ...');
    const analyzeStart = Date.now();
    await runExec(db, 'ANALYZE "Records";');
    console.log(`  done in ${formatDuration(Date.now() - analyzeStart)}`);

    console.log('');
    console.log(`Finished in ${formatDuration(Date.now() - totalStart)}`);
    console.log('');
    console.log('Final Records indexes:');
    const finalIndexes = await listRecordsIndexes(db);
    for (const row of finalIndexes) {
      console.log(`  - ${row.name}`);
    }

    console.log('');
    console.log('Next step: pm2 start gali-parse');
  } finally {
    await new Promise((resolve, reject) => {
      db.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

main().catch((error) => {
  console.error('Failed:', error.message);
  process.exit(1);
});
