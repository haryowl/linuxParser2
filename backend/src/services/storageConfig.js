'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const CONFIG_FILE = path.join(__dirname, '..', '..', 'data', 'storage-config.json');

const DEFAULT_CONFIG = {
  logs: {
    enabled: true,
    maxTotalSizeMB: 500,
    maxFilesPerDirectory: 5,
    lastCleanupAt: null,
    lastCleanupDeleted: 0,
    lastCleanupFreedMB: 0
  },
  exports: {
    enabled: true,
    retentionDays: 30,
    lastCleanupAt: null,
    lastCleanupDeleted: 0,
    lastCleanupFreedMB: 0
  },
  backups: {
    enabled: true,
    retentionDays: 7,
    maxCount: 20,
    lastCleanupAt: null,
    lastCleanupDeleted: 0,
    lastCleanupFreedMB: 0
  }
};

function readFileConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return {
        logs: { ...DEFAULT_CONFIG.logs, ...(parsed.logs || {}) },
        exports: { ...DEFAULT_CONFIG.exports, ...(parsed.exports || {}) },
        backups: { ...DEFAULT_CONFIG.backups, ...(parsed.backups || {}) }
      };
    }
  } catch (error) {
    logger.warn('Failed to read storage config file', { error: error.message });
  }
  return { ...DEFAULT_CONFIG };
}

function writeFileConfig(config) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getStorageConfig() {
  const fileConfig = readFileConfig();
  const envExportDays = Number.parseInt(process.env.EXPORT_RETENTION_DAYS, 10);
  const envBackupDays = Number.parseInt(process.env.BACKUP_RETENTION_DAYS, 10);

  return {
    logs: {
      ...fileConfig.logs,
      enabled: fileConfig.logs.enabled !== false
    },
    exports: {
      ...fileConfig.exports,
      enabled: fileConfig.exports.enabled !== false,
      retentionDays: Number.isFinite(fileConfig.exports.retentionDays) && fileConfig.exports.retentionDays > 0
        ? fileConfig.exports.retentionDays
        : (Number.isFinite(envExportDays) && envExportDays > 0 ? envExportDays : 30)
    },
    backups: {
      ...fileConfig.backups,
      enabled: fileConfig.backups.enabled !== false,
      retentionDays: Number.isFinite(fileConfig.backups.retentionDays) && fileConfig.backups.retentionDays > 0
        ? fileConfig.backups.retentionDays
        : (Number.isFinite(envBackupDays) && envBackupDays > 0 ? envBackupDays : 7),
      maxCount: Number.isFinite(fileConfig.backups.maxCount) && fileConfig.backups.maxCount > 0
        ? fileConfig.backups.maxCount
        : 20
    },
    source: 'file'
  };
}

function updateStorageConfig(updates = {}) {
  const current = readFileConfig();
  const next = {
    logs: { ...current.logs, ...(updates.logs || {}) },
    exports: { ...current.exports, ...(updates.exports || {}) },
    backups: { ...current.backups, ...(updates.backups || {}) }
  };

  if (typeof next.logs.enabled !== 'boolean') {
    next.logs.enabled = Boolean(next.logs.enabled);
  }
  if (typeof next.exports.enabled !== 'boolean') {
    next.exports.enabled = Boolean(next.exports.enabled);
  }
  if (typeof next.backups.enabled !== 'boolean') {
    next.backups.enabled = Boolean(next.backups.enabled);
  }

  const logSize = Number.parseInt(next.logs.maxTotalSizeMB, 10);
  next.logs.maxTotalSizeMB = Number.isFinite(logSize) && logSize > 0 ? logSize : 500;

  const logFiles = Number.parseInt(next.logs.maxFilesPerDirectory, 10);
  next.logs.maxFilesPerDirectory = Number.isFinite(logFiles) && logFiles > 0 ? logFiles : 5;

  const exportDays = Number.parseInt(next.exports.retentionDays, 10);
  next.exports.retentionDays = Number.isFinite(exportDays) && exportDays > 0 ? exportDays : 30;

  const backupDays = Number.parseInt(next.backups.retentionDays, 10);
  next.backups.retentionDays = Number.isFinite(backupDays) && backupDays > 0 ? backupDays : 7;

  const backupCount = Number.parseInt(next.backups.maxCount, 10);
  next.backups.maxCount = Number.isFinite(backupCount) && backupCount > 0 ? backupCount : 20;

  writeFileConfig(next);
  return getStorageConfig();
}

function recordCleanupResult(section, result) {
  const current = readFileConfig();
  current[section] = {
    ...current[section],
    lastCleanupAt: new Date().toISOString(),
    lastCleanupDeleted: result.deleted || 0,
    lastCleanupFreedMB: result.freedMB || 0
  };
  writeFileConfig(current);
}

module.exports = {
  getStorageConfig,
  updateStorageConfig,
  recordCleanupResult
};
