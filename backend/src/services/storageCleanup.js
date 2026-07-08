'use strict';

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const logger = require('../utils/logger');
const { getStorageConfig, recordCleanupResult } = require('./storageConfig');
const { resolveProjectPaths, bytesToMB } = require('../utils/systemMetrics');

function listFilesRecursive(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return [];
  }

  const files = [];
  const walk = (currentPath) => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const stats = fs.statSync(fullPath);
          files.push({
            path: fullPath,
            size: stats.size,
            mtime: stats.mtime
          });
        } catch (error) {
          // ignore unreadable files
        }
      }
    }
  };

  walk(targetPath);
  return files;
}

function deleteFiles(fileEntries) {
  let deleted = 0;
  let freedBytes = 0;

  for (const file of fileEntries) {
    try {
      fs.unlinkSync(file.path);
      deleted += 1;
      freedBytes += file.size;
    } catch (error) {
      logger.warn('Failed to delete file during cleanup', { path: file.path, error: error.message });
    }
  }

  return { deleted, freedMB: bytesToMB(freedBytes) };
}

function cleanupLogs() {
  const config = getStorageConfig();
  if (!config.logs.enabled) {
    return { deleted: 0, freedMB: 0, skipped: true };
  }

  const paths = resolveProjectPaths();
  const logDirs = [paths.backendLogs, paths.pm2Logs].filter((dir) => fs.existsSync(dir));
  const maxTotalBytes = config.logs.maxTotalSizeMB * 1024 * 1024;
  const maxFilesPerDirectory = config.logs.maxFilesPerDirectory;
  const toDelete = [];

  for (const dir of logDirs) {
    const logFiles = fs.readdirSync(dir)
      .filter((name) => name.endsWith('.log') || name.endsWith('.csv'))
      .map((name) => {
        const fullPath = path.join(dir, name);
        const stats = fs.statSync(fullPath);
        return { path: fullPath, size: stats.size, mtime: stats.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);

    for (let i = maxFilesPerDirectory; i < logFiles.length; i += 1) {
      toDelete.push(logFiles[i]);
    }
  }

  const allLogFiles = logDirs
    .flatMap((dir) => listFilesRecursive(dir))
    .filter((file) => file.path.endsWith('.log') || file.path.endsWith('.csv'))
    .sort((a, b) => a.mtime - b.mtime);

  let totalBytes = allLogFiles.reduce((sum, file) => sum + file.size, 0);
  for (const file of allLogFiles) {
    if (totalBytes <= maxTotalBytes) {
      break;
    }
    if (!toDelete.some((entry) => entry.path === file.path)) {
      toDelete.push(file);
      totalBytes -= file.size;
    }
  }

  const result = deleteFiles(toDelete);
  recordCleanupResult('logs', result);
  logger.info('Log cleanup completed', result);
  return result;
}

function cleanupExports() {
  const config = getStorageConfig();
  if (!config.exports.enabled) {
    return { deleted: 0, freedMB: 0, skipped: true };
  }

  const paths = resolveProjectPaths();
  const cutoff = Date.now() - config.exports.retentionDays * 24 * 60 * 60 * 1000;
  const files = listFilesRecursive(paths.exports)
    .filter((file) => file.mtime.getTime() < cutoff);

  const result = deleteFiles(files);
  recordCleanupResult('exports', result);
  logger.info('Export cleanup completed', { retentionDays: config.exports.retentionDays, ...result });
  return result;
}

function cleanupBackups() {
  const config = getStorageConfig();
  if (!config.backups.enabled) {
    return { deleted: 0, freedMB: 0, skipped: true };
  }

  const paths = resolveProjectPaths();
  if (!fs.existsSync(paths.backups)) {
    return { deleted: 0, freedMB: 0, skipped: true };
  }

  const cutoff = Date.now() - config.backups.retentionDays * 24 * 60 * 60 * 1000;
  const backupFiles = fs.readdirSync(paths.backups)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const fullPath = path.join(paths.backups, name);
      const stats = fs.statSync(fullPath);
      return { path: fullPath, size: stats.size, mtime: stats.mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const toDelete = backupFiles.filter((file) => file.mtime.getTime() < cutoff);
  for (let i = config.backups.maxCount; i < backupFiles.length; i += 1) {
    if (!toDelete.some((entry) => entry.path === backupFiles[i].path)) {
      toDelete.push(backupFiles[i]);
    }
  }

  const result = deleteFiles(toDelete);
  recordCleanupResult('backups', result);
  logger.info('Backup cleanup completed', { retentionDays: config.backups.retentionDays, ...result });
  return result;
}

async function runAllCleanup() {
  const logs = cleanupLogs();
  const exportFiles = cleanupExports();
  const backups = cleanupBackups();
  return { logs, exports: exportFiles, backups };
}

function start() {
  cron.schedule('30 3 * * *', () => {
    runAllCleanup().catch((error) => {
      logger.error('Scheduled storage cleanup failed:', error);
    });
  }, { timezone: 'UTC' });

  const config = getStorageConfig();
  logger.info('Storage cleanup scheduler started', {
    logs: config.logs.enabled,
    exports: config.exports.enabled,
    backups: config.backups.enabled
  });
}

module.exports = {
  start,
  cleanupLogs,
  cleanupExports,
  cleanupBackups,
  runAllCleanup
};
