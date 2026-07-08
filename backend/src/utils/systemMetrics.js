'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cache = require('./cache');

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

function getStorageBreakdown() {
  const paths = resolveProjectPaths();
  const database = getFileSize(paths.database);
  const backendLogs = getDirectorySize(paths.backendLogs);
  const pm2Logs = getDirectorySize(paths.pm2Logs);
  const exportsDir = getDirectorySize(paths.exports);
  const backupsDir = getDirectorySize(paths.backups);
  const dataDir = getDirectorySize(paths.dataDir);
  const sessions = getFileSize(paths.sessions);

  const logsBytes = backendLogs.bytes + pm2Logs.bytes;
  const totalBytes = database.bytes + logsBytes + exportsDir.bytes + backupsDir.bytes;

  return {
    database: { ...database, mb: bytesToMB(database.bytes) },
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

function getSystemStatus(getBufferStats) {
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
    storage: getStorageBreakdown(),
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
  resolveProjectPaths
};
