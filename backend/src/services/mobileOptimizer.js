const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('../utils/logger');

const execAsync = promisify(exec);

class MobileOptimizer {
  constructor() {
    this.batteryLevel = 100;
    this.isCharging = false;
    this.optimizationLevel = 'normal';
    this.storageInfo = {
      total: 0,
      used: 0,
      available: 0
    };
    this.monitoringInterval = null;
  }

  async initialize() {
    logger.info('Initializing mobile optimizer...');
    
    // Start monitoring
    await this.updateSystemInfo();
    this.startMonitoring();
    
    // Set initial optimization level
    this.adjustPerformance();
    
    logger.info('Mobile optimizer initialized');
  }

  async updateSystemInfo() {
    try {
      // Get battery info (Android-specific)
      await this.getBatteryInfo();
      
      // Get storage info
      await this.getStorageInfo();
      
      // Get memory info
      await this.getMemoryInfo();
      
    } catch (error) {
      logger.warn('Failed to update system info:', error.message);
    }
  }

  async getBatteryInfo() {
    try {
      // Try to get battery info from Android system
      const { stdout } = await execAsync('dumpsys battery');
      
      // Parse battery level
      const levelMatch = stdout.match(/level:\s*(\d+)/);
      if (levelMatch) {
        this.batteryLevel = parseInt(levelMatch[1]);
      }
      
      // Parse charging status
      const chargingMatch = stdout.match(/powered:\s*(true|false)/);
      if (chargingMatch) {
        this.isCharging = chargingMatch[1] === 'true';
      }
      
    } catch (error) {
      // Fallback to default values
      this.batteryLevel = 100;
      this.isCharging = false;
    }
  }

  async getStorageInfo() {
    try {
      const { stdout } = await execAsync('df -h /data');
      const lines = stdout.split('\n');
      
      if (lines.length > 1) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 4) {
          this.storageInfo = {
            total: this.parseStorageSize(parts[1]),
            used: this.parseStorageSize(parts[2]),
            available: this.parseStorageSize(parts[3])
          };
        }
      }
    } catch (error) {
      logger.warn('Failed to get storage info:', error.message);
    }
  }

  parseStorageSize(sizeStr) {
    const match = sizeStr.match(/^(\d+(?:\.\d+)?)([KMGT])?$/);
    if (match) {
      const value = parseFloat(match[1]);
      const unit = match[2] || '';
      
      switch (unit) {
        case 'K': return value / 1024 / 1024; // Convert to GB
        case 'M': return value / 1024; // Convert to GB
        case 'G': return value;
        case 'T': return value * 1024; // Convert to GB
        default: return value / 1024 / 1024; // Assume bytes
      }
    }
    return 0;
  }

  async getMemoryInfo() {
    try {
      const { stdout } = await execAsync('free -m');
      const lines = stdout.split('\n');
      
      if (lines.length > 1) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 3) {
          const totalMem = parseInt(parts[1]);
          const usedMem = parseInt(parts[2]);
          const memUsage = (usedMem / totalMem) * 100;
          
          // Adjust optimization based on memory usage
          if (memUsage > 80) {
            this.optimizationLevel = 'power_save';
          } else if (memUsage > 60) {
            this.optimizationLevel = 'balanced';
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to get memory info:', error.message);
    }
  }

  adjustPerformance() {
    const oldLevel = this.optimizationLevel;
    
    // Determine optimization level based on battery and storage
    if (this.batteryLevel < 20 || this.storageInfo.available < 1) {
      this.optimizationLevel = 'power_save';
    } else if (this.batteryLevel < 50 || this.storageInfo.available < 5) {
      this.optimizationLevel = 'balanced';
    } else {
      this.optimizationLevel = 'performance';
    }
    
    if (oldLevel !== this.optimizationLevel) {
      logger.info(`Performance level changed: ${oldLevel} -> ${this.optimizationLevel}`);
      this.applyOptimizations();
    }
  }

  applyOptimizations() {
    switch (this.optimizationLevel) {
      case 'power_save':
        this.applyPowerSaveMode();
        break;
      case 'balanced':
        this.applyBalancedMode();
        break;
      case 'performance':
        this.applyPerformanceMode();
        break;
    }
  }

  applyPowerSaveMode() {
    logger.info('Applying power save optimizations...');
    
    // Reduce polling frequency
    global.POLLING_INTERVAL = 60000; // 1 minute
    
    // Disable non-essential features
    global.ENABLE_WEBSOCKET = false;
    global.ENABLE_REALTIME_UPDATES = false;
    
    // Reduce log verbosity
    logger.level = 'error';
    
    // Trigger storage cleanup
    this.cleanupStorage();
  }

  applyBalancedMode() {
    logger.info('Applying balanced optimizations...');
    
    // Normal polling frequency
    global.POLLING_INTERVAL = 30000; // 30 seconds
    
    // Enable essential features
    global.ENABLE_WEBSOCKET = true;
    global.ENABLE_REALTIME_UPDATES = true;
    
    // Moderate logging
    logger.level = 'warn';
  }

  applyPerformanceMode() {
    logger.info('Applying performance optimizations...');
    
    // Fast polling frequency
    global.POLLING_INTERVAL = 15000; // 15 seconds
    
    // Enable all features
    global.ENABLE_WEBSOCKET = true;
    global.ENABLE_REALTIME_UPDATES = true;
    
    // Full logging
    logger.level = 'info';
  }

  async cleanupStorage() {
    try {
      logger.info('Starting storage cleanup...');
      
      // Clean old log files
      await this.cleanupLogs();
      
      // Clean old database records
      await this.cleanupDatabase();
      
      // Compress database
      await this.compressDatabase();
      
      logger.info('Storage cleanup completed');
    } catch (error) {
      logger.error('Storage cleanup failed:', error.message);
    }
  }

  async cleanupLogs() {
    try {
      const logsDir = path.join(__dirname, '..', '..', 'logs');
      const files = fs.readdirSync(logsDir);
      
      // Keep only the 3 most recent log files
      const logFiles = files
        .filter(file => file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: path.join(logsDir, file),
          mtime: fs.statSync(path.join(logsDir, file)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime);
      
      // Delete old log files
      for (let i = 3; i < logFiles.length; i++) {
        fs.unlinkSync(logFiles[i].path);
        logger.info(`Deleted old log file: ${logFiles[i].name}`);
      }
    } catch (error) {
      logger.warn('Failed to cleanup logs:', error.message);
    }
  }

  async cleanupDatabase() {
    try {
      const { Record } = require('../models');
      
      // Delete records older than 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const deletedCount = await Record.destroy({
        where: {
          timestamp: {
            [require('sequelize').Op.lt]: thirtyDaysAgo
          }
        }
      });
      
      if (deletedCount > 0) {
        logger.info(`Deleted ${deletedCount} old records`);
      }
    } catch (error) {
      logger.warn('Failed to cleanup database:', error.message);
    }
  }

  async compressDatabase() {
    try {
      const { sequelize } = require('../models');
      const { resolveDialect } = require('../config/database');

      if (resolveDialect() !== 'sqlite') {
        return;
      }

      await sequelize.query('VACUUM');
      logger.info('Database compressed');
    } catch (error) {
      logger.warn('Failed to compress database:', error.message);
    }
  }

  startMonitoring() {
    // Update system info every 5 minutes
    this.monitoringInterval = setInterval(async () => {
      await this.updateSystemInfo();
      this.adjustPerformance();
    }, 5 * 60 * 1000);
    
    logger.info('Mobile monitoring started');
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logger.info('Mobile monitoring stopped');
    }
  }

  getStatus() {
    return {
      batteryLevel: this.batteryLevel,
      isCharging: this.isCharging,
      optimizationLevel: this.optimizationLevel,
      storage: this.storageInfo,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
  }
}

module.exports = new MobileOptimizer(); 