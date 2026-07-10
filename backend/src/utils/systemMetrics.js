'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cache = require('./cache');
const { resolveDialect, isPostgresDialect } = require('../config/database');

function bytesToMB(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

function getDirectorySize(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return { bytes: 0, files: 0, exists: false, path: targetPath };
  }

  let bytes = 0;
  let files = 0;

  const walk = (currentPath) => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          bytes += fs.statSync(fullPath).size;
          files += 1;
        } catch (error) {
          // ignore unreadable files
        }
      }
    }
  };

  walk(targetPath);
  return { bytes, files, exists: true, path: targetPath };
}

function getFileSize(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return { bytes: 0, exists: false, path: targetPath };
  }
  try {
    const bytes = fs.statSync(targetPath).size;
    return { bytes, exists: true, path: targetPath };
  } catch (error) {
    return { bytes: 0, exists: false, path: targetPath };
  }
}

function resolveProjectPaths() {
  const backendRoot = path.join(__dirname, '..', '..');
  const projectRoot = path.join(backendRoot, '..');
  const dbStorage = process.env.DB_STORAGE || 'backend/data/prod.sqlite';
  const exportDir = process.env.EXPORT_DIR || 'backend/exports';
  const backupDir = process.env.BACKUP_DIR || 'backups';

  return {
    backendRoot,
    projectRoot,
    database: path.isAbsolute(dbStorage) ? dbStorage : path.join(projectRoot, dbStorage),
    backendLogs: path.join(backendRoot, 'logs'),
    pm2Logs: path.join(projectRoot, 'logs'),
    exports: path.isAbsolute(exportDir) ? exportDir : path.join(projectRoot, exportDir),
    backups: path.isAbsolute(backupDir) ? backupDir : path.join(projectRoot, backupDir),
    dataDir: path.join(backendRoot, 'data'),
    sessions: path.join(backendRoot, 'data', 'sessions.sqlite')
  };
}

function formatSizeMB(mb) {
  if (!Number.isFinite(mb)) return '0 MB';
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function getHostDiskUsage(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return null;
  }

  try {
    if (typeof fs.statfsSync !== 'function') {
      return null;
    }

    const stat = fs.statfsSync(targetPath);
    const total = stat.bsize * stat.blocks;
    const free = stat.bsize * stat.bavail;
    const used = Math.max(0, total - free);

    return {
      total,
      free,
      used,
      totalMB: bytesToMB(total),
      freeMB: bytesToMB(free),
      usedMB: bytesToMB(used),
      usedPercent: total > 0 ? Math.round((used / total) * 100) : 0,
      freePercent: total > 0 ? Math.round((free / total) * 100) : 0
    };
  } catch (error) {
    return null;
  }
}

function formatUptimeSeconds(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function buildHealthCheck(status, value, detail) {
  return { status, value, detail };
}

function buildSystemHealth(metrics) {
  const heapUsedMB = metrics.memory.process.heapUsedMB;
  const systemUsedPercent = metrics.memory.system.usedPercent;
  const appStorageMB = metrics.storage.total.mb;
  const disk = metrics.disk;
  const cacheEntries = metrics.cache?.activeEntries ?? 0;

  const memoryStatus = heapUsedMB < 800 ? 'healthy' : (heapUsedMB < 1500 ? 'warning' : 'error');
  const systemMemoryStatus = systemUsedPercent < 85 ? 'healthy' : (systemUsedPercent < 95 ? 'warning' : 'error');

  let storageStatus = 'healthy';
  let storageDetail = `Database ${formatSizeMB(metrics.storage.database.mb)}, logs ${formatSizeMB(metrics.storage.logs.mb)}`;

  if (disk) {
    storageDetail = `${formatSizeMB(appStorageMB)} app data · ${disk.freePercent}% disk free (${formatSizeMB(disk.freeMB)} available)`;
    if (disk.freePercent < 5) {
      storageStatus = 'error';
    } else if (disk.freePercent < 15 || appStorageMB >= 20480) {
      storageStatus = 'warning';
    }
  } else if (appStorageMB >= 20480) {
    storageStatus = 'warning';
    storageDetail = `${formatSizeMB(appStorageMB)} app data (large dataset)`;
  }

  const dbDialect = metrics.storage.database?.dialect || 'sqlite';
  const dbDetail = dbDialect === 'postgres'
    ? [
        metrics.storage.database.name || 'PostgreSQL',
        metrics.storage.database.recordCount != null
          ? `${Number(metrics.storage.database.recordCount).toLocaleString('en-US')} records`
          : null,
        metrics.storage.database.deviceCount != null
          ? `${Number(metrics.storage.database.deviceCount).toLocaleString('en-US')} devices`
          : null
      ].filter(Boolean).join(' · ')
    : 'SQLite database file size';

  const dbStatus = dbDialect === 'postgres' && metrics.storage.database.exists === false
    ? 'error'
    : 'healthy';

  const checks = {
    database: buildHealthCheck(
      dbStatus,
      formatSizeMB(metrics.storage.database.mb),
      dbDetail
    ),
    memory: buildHealthCheck(
      memoryStatus,
      formatSizeMB(heapUsedMB),
      `Process heap · ${formatSizeMB(metrics.memory.process.heapTotalMB)} allocated`
    ),
    systemMemory: buildHealthCheck(
      systemMemoryStatus,
      `${systemUsedPercent}%`,
      `${formatSizeMB(metrics.memory.system.usedMB)} / ${formatSizeMB(metrics.memory.system.totalMB)} RAM`
    ),
    storage: buildHealthCheck(
      storageStatus,
      formatSizeMB(appStorageMB),
      storageDetail
    ),
    cache: buildHealthCheck(
      'healthy',
      `${cacheEntries} active`,
      `${metrics.cache?.totalEntries ?? 0} total API cache entries`
    ),
    uptime: buildHealthCheck(
      metrics.uptime > 0 ? 'healthy' : 'error',
      formatUptimeSeconds(metrics.uptime),
      'Server process uptime'
    )
  };

  let status = 'healthy';
  if (Object.values(checks).some((check) => check.status === 'error')) {
    status = 'error';
  } else if (Object.values(checks).some((check) => check.status === 'warning')) {
    status = 'warning';
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    checks,
    metrics: {
      appStorageMB,
      disk
    }
  };
}
async function getPostgresDatabaseStats() {
  try {
    const { sequelize } = require('../models');
    const [rows] = await sequelize.query(`
      SELECT
        pg_database_size(current_database())::bigint AS db_bytes,
        current_database() AS db_name,
        (SELECT COUNT(*)::bigint FROM "Records") AS record_count,
        (SELECT COUNT(*)::bigint FROM "Devices") AS device_count
    `);
    const row = rows[0] || {};
    const bytes = Number(row.db_bytes) || 0;

    return {
      bytes,
      exists: true,
      path: row.db_name || 'PostgreSQL',
      dialect: 'postgres',
      name: row.db_name || null,
      recordCount: Number(row.record_count) || 0,
      deviceCount: Number(row.device_count) || 0,
      mb: bytesToMB(bytes)
    };
  } catch (error) {
    return {
      bytes: 0,
      exists: false,
      path: 'PostgreSQL',
      dialect: 'postgres',
      error: error.message,
      mb: 0
    };
  }
}

async function getStorageBreakdown() {
  const paths = resolveProjectPaths();
  let database;

  if (isPostgresDialect(resolveDialect())) {
    database = await getPostgresDatabaseStats();
  } else {
    const fileSize = getFileSize(paths.database);
    database = {
      ...fileSize,
      mb: bytesToMB(fileSize.bytes),
      dialect: 'sqlite'
    };
  }

  const backendLogs = getDirectorySize(paths.backendLogs);
  const pm2Logs = getDirectorySize(paths.pm2Logs);
  const exportsDir = getDirectorySize(paths.exports);
  const backupsDir = getDirectorySize(paths.backups);
  const dataDir = getDirectorySize(paths.dataDir);
  const sessions = getFileSize(paths.sessions);

  const logsBytes = backendLogs.bytes + pm2Logs.bytes;
  const totalBytes = database.bytes + logsBytes + exportsDir.bytes + backupsDir.bytes;

  return {
    database,
    logs: {
      bytes: logsBytes,
      mb: bytesToMB(logsBytes),
      backendLogs: { ...backendLogs, mb: bytesToMB(backendLogs.bytes) },
      pm2Logs: { ...pm2Logs, mb: bytesToMB(pm2Logs.bytes) }
    },
    exports: { ...exportsDir, mb: bytesToMB(exportsDir.bytes) },
    backups: { ...backupsDir, mb: bytesToMB(backupsDir.bytes) },
    dataDir: { ...dataDir, mb: bytesToMB(dataDir.bytes) },
    sessions: { ...sessions, mb: bytesToMB(sessions.bytes) },
    total: { bytes: totalBytes, mb: bytesToMB(totalBytes) }
  };
}

async function getSystemStatus(getBufferStats) {
  const paths = resolveProjectPaths();
  const processMemory = process.memoryUsage();
  const systemMemory = {
    total: os.totalmem(),
    free: os.freemem(),
    used: os.totalmem() - os.freemem()
  };

  return {
    uptime: process.uptime(),
    cpu: os.cpus().length,
    platform: os.platform(),
    version: process.version,
    pid: process.pid,
    startTime: new Date(Date.now() - process.uptime() * 1000),
    memory: {
      process: {
        rss: processMemory.rss,
        heapUsed: processMemory.heapUsed,
        heapTotal: processMemory.heapTotal,
        external: processMemory.external,
        arrayBuffers: processMemory.arrayBuffers || 0,
        rssMB: bytesToMB(processMemory.rss),
        heapUsedMB: bytesToMB(processMemory.heapUsed),
        heapTotalMB: bytesToMB(processMemory.heapTotal)
      },
      system: {
        total: systemMemory.total,
        free: systemMemory.free,
        used: systemMemory.used,
        totalMB: bytesToMB(systemMemory.total),
        freeMB: bytesToMB(systemMemory.free),
        usedMB: bytesToMB(systemMemory.used),
        usedPercent: systemMemory.total > 0
          ? Math.round((systemMemory.used / systemMemory.total) * 100)
          : 0
      }
    },
    storage: await getStorageBreakdown(),
    disk: getHostDiskUsage(paths.projectRoot),
    cache: cache.getStats(),
    buffers: typeof getBufferStats === 'function' ? getBufferStats() : null
  };
}

module.exports = {
  bytesToMB,
  getDirectorySize,
  getFileSize,
  getStorageBreakdown,
  getSystemStatus,
  buildSystemHealth,
  resolveProjectPaths
};
