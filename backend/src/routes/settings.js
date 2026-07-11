    // backend/src/routes/settings.js
    const express = require('express');
    const router = express.Router();
    const asyncHandler = require('../utils/asyncHandler');
    const { requireAuth } = require('./auth');
    const { checkMenuAccess, requireAdmin } = require('../middleware/permissions');
    const { getRetentionConfig, updateRetentionConfig } = require('../services/retentionConfig');
    const recordRetention = require('../services/recordRetention');
    const { getStorageConfig, updateStorageConfig } = require('../services/storageConfig');
    const storageCleanup = require('../services/storageCleanup');
    const { getSystemStatus, buildSystemHealth } = require('../utils/systemMetrics');

    router.use(requireAuth);
    router.use(checkMenuAccess('settings'));
    const fs = require('fs').promises;
    const path = require('path');
    const { getForwarderLogs, reloadConfig } = require('../services/dataForwarder');

    // Get settings
    router.get('/', asyncHandler(async (req, res) => {
        const settings = {
            // Add your default settings here
            parser: {
                maxPacketSize: 1024,
                validateChecksum: true
            },
            tcp: {
                port: 5000,
                timeout: 30000
            },
            database: {
                backupInterval: 3600, // 1 hour
                maxBackups: 10
            }
        };
        res.json(settings);
    }));

    // Update settings
    router.put('/', asyncHandler(async (req, res) => {
        const newSettings = req.body;
        // Add your settings update logic here
        res.json({ message: 'Settings updated successfully' });
    }));

    // Get backups
    router.get('/backups', asyncHandler(async (req, res) => {
        try {
            const backupsDir = path.join(__dirname, '../../backups');
            
            // Check if directory exists, create it if it doesn't
            try {
                await fs.access(backupsDir);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    await fs.mkdir(backupsDir, { recursive: true });
                } else {
                    throw error;
                }
            }
            
            const files = await fs.readdir(backupsDir);
            const backupFiles = files.filter(file => file.endsWith('.json'));
            
            const backups = await Promise.all(backupFiles.map(async (file) => {
                const filePath = path.join(backupsDir, file);
                const stats = await fs.stat(filePath);
                return {
                    id: file,
                    name: file.replace('.json', ''),
                    size: stats.size,
                    createdAt: stats.birthtime,
                    modifiedAt: stats.mtime
                };
            }));
            
            res.json(backups.sort((a, b) => b.modifiedAt - a.modifiedAt));
        } catch (error) {
            console.error('Error reading backups:', error);
            res.json([]);
        }
    }));

    // Create backup
    router.post('/backups', asyncHandler(async (req, res) => {
        const { name } = req.body;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = name || `backup_${timestamp}`;
        const backupsDir = path.join(__dirname, '../../backups');
        const backupPath = path.join(backupsDir, `${backupName}.json`);
        
        // Ensure backups directory exists
        try {
            await fs.access(backupsDir);
        } catch (error) {
            if (error.code === 'ENOENT') {
                await fs.mkdir(backupsDir, { recursive: true });
            } else {
                throw error;
            }
        }
        
        // Create backup data
        const backupData = {
            timestamp: new Date().toISOString(),
            settings: {
                parser: {
                    maxPacketSize: 1024,
                    validateChecksum: true
                },
                tcp: {
                    port: 5000,
                    timeout: 30000
                }
            }
        };
        
        await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2));
        res.json({ message: 'Backup created successfully', backupName });
    }));

    // Restore backup
    router.post('/backups/:backupId/restore', asyncHandler(async (req, res) => {
        const { backupId } = req.params;
        const backupPath = path.join(__dirname, '../../backups', backupId);
        
        try {
            const backupData = await fs.readFile(backupPath, 'utf8');
            const parsedData = JSON.parse(backupData);
            // Add restore logic here
            res.json({ message: 'Backup restored successfully' });
        } catch (error) {
            res.status(404).json({ error: 'Backup not found' });
        }
    }));

    // Delete backup
    router.delete('/backups/:backupId', asyncHandler(async (req, res) => {
        const { backupId } = req.params;
        const backupPath = path.join(__dirname, '../../backups', backupId);
        
        try {
            await fs.unlink(backupPath);
            res.json({ message: 'Backup deleted successfully' });
        } catch (error) {
            res.status(404).json({ error: 'Backup not found' });
        }
    }));

    // Get system status
    router.get('/status', asyncHandler(async (req, res) => {
        let getBufferStats = null;
        try {
            const appModule = require('../app');
            getBufferStats = appModule.getBufferStats;
        } catch (error) {
            getBufferStats = null;
        }

        const status = await getSystemStatus(getBufferStats);
        res.json(status);
    }));

    // Get system health
    router.get('/health', asyncHandler(async (req, res) => {
        let getBufferStats = null;
        try {
            const appModule = require('../app');
            getBufferStats = appModule.getBufferStats;
        } catch (error) {
            getBufferStats = null;
        }

        const metrics = await getSystemStatus(getBufferStats);
        res.json(buildSystemHealth(metrics));
    }));

    // Export settings
    router.get('/export', asyncHandler(async (req, res) => {
        const settings = {
            parser: {
                maxPacketSize: 1024,
                validateChecksum: true
            },
            tcp: {
                port: 5000,
                timeout: 30000
            }
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=settings.json');
        res.json(settings);
    }));

    // Import settings
    router.post('/import', asyncHandler(async (req, res) => {
        // This would need multer middleware for file upload
        // For now, just return success
        res.json({ message: 'Settings imported successfully' });
    }));

    // Data Forwarder Config Endpoints
    const dataForwarderConfigPath = path.join(__dirname, '../config/dataForwarder.json');

    // Get data forwarder config
    router.get('/data-forwarder', asyncHandler(async (req, res) => {
        let config = { enabled: false, targetUrl: 'http://accessmyship.com:8008/GpsGate/', autoForwardEnabled: false, autoForwardIntervalMinutes: 5, forwardDeviceImeis: [] };
        try {
            const raw = await fs.readFile(dataForwarderConfigPath, 'utf8');
            config = { ...config, ...JSON.parse(raw) };
        } catch (e) {}
        res.json(config);
    }));

    // Update data forwarder config
    router.put('/data-forwarder', asyncHandler(async (req, res) => {
        const newConfig = req.body;
        let config = { enabled: false, targetUrl: 'http://accessmyship.com:8008/GpsGate/', autoForwardEnabled: false, autoForwardIntervalMinutes: 5, forwardDeviceImeis: [] };
        try {
            const raw = await fs.readFile(dataForwarderConfigPath, 'utf8');
            config = { ...config, ...JSON.parse(raw) };
        } catch (e) {}
        config = { ...config, ...newConfig };
        await fs.writeFile(dataForwarderConfigPath, JSON.stringify(config, null, 2));
        reloadConfig();
        res.json({ message: 'Data forwarder config updated', config });
    }));

    // Get data forwarder logs
    router.get('/data-forwarder/logs', asyncHandler(async (req, res) => {
        const logs = getForwarderLogs(50);
        res.json({ logs });
    }));

    router.get('/retention', requireAdmin, asyncHandler(async (req, res) => {
        res.json(getRetentionConfig());
    }));

    router.put('/retention', requireAdmin, asyncHandler(async (req, res) => {
        const { enabled, retentionDays } = req.body;
        const config = updateRetentionConfig({ enabled, retentionDays });
        res.json({ message: 'Retention settings updated', config });
    }));

    router.post('/retention/purge', requireAdmin, asyncHandler(async (req, res) => {
        const result = await recordRetention.purgeOldRecords();
        res.json({ message: 'Retention purge completed', result });
    }));

    router.get('/storage', requireAdmin, asyncHandler(async (req, res) => {
        res.json(getStorageConfig());
    }));

    router.put('/storage', requireAdmin, asyncHandler(async (req, res) => {
        const { logs, exports, backups } = req.body;
        const config = updateStorageConfig({ logs, exports, backups });
        res.json({ message: 'Storage settings updated', config });
    }));

    router.post('/storage/cleanup', requireAdmin, asyncHandler(async (req, res) => {
        const result = await storageCleanup.runAllCleanup();
        res.json({ message: 'Storage cleanup completed', result, config: getStorageConfig() });
    }));

    router.post('/storage/cleanup/:section', requireAdmin, asyncHandler(async (req, res) => {
        const { section } = req.params;
        let result;
        if (section === 'logs') {
            result = storageCleanup.cleanupLogs();
        } else if (section === 'exports') {
            result = storageCleanup.cleanupExports();
        } else if (section === 'backups') {
            result = storageCleanup.cleanupBackups();
        } else {
            return res.status(400).json({ error: 'Invalid cleanup section' });
        }
        res.json({ message: `${section} cleanup completed`, result, config: getStorageConfig() });
    }));

    const recordManagementService = require('../services/recordManagementService');
    const ingestAuditService = require('../services/ingestAuditService');

    router.post('/records/preview-delete', requireAdmin, asyncHandler(async (req, res) => {
        const { imeis, startDate, endDate } = req.body;
        const preview = await recordManagementService.countMatchingRecords({ imeis, startDate, endDate });
        res.json(preview);
    }));

    router.post('/records/delete', requireAdmin, asyncHandler(async (req, res) => {
        const { imeis, startDate, endDate, confirm, expectedCount } = req.body;
        if (!confirm) {
            return res.status(400).json({ error: 'confirm: true is required to delete records' });
        }

        const preview = await recordManagementService.countMatchingRecords({ imeis, startDate, endDate });
        if (expectedCount !== undefined && Number(expectedCount) !== preview.total) {
            return res.status(409).json({
                error: 'Record count changed since preview. Please preview again.',
                preview
            });
        }

        const result = await recordManagementService.deleteMatchingRecords({ imeis, startDate, endDate });
        res.json({
            message: 'Records deleted',
            deleted: result.deleted,
            ...preview
        });
    }));

    router.post('/records/gap-analysis', requireAdmin, asyncHandler(async (req, res) => {
        const { imeis, startDate, endDate } = req.body;
        const report = await recordManagementService.analyzeRecordGaps({ imeis, startDate, endDate });
        res.json(report);
    }));

    router.get('/records/integrity-export', requireAdmin, asyncHandler(async (req, res) => {
        const { startDate, endDate, imeis } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'startDate and endDate query parameters are required' });
        }

        const parsedImeis = typeof imeis === 'string' && imeis.trim()
            ? imeis.split(',').map((value) => value.trim()).filter(Boolean)
            : [];

        const report = await recordManagementService.analyzeRecordGaps({
            imeis: parsedImeis,
            startDate,
            endDate
        });

        let ingestSummary = null;
        try {
            ingestSummary = await ingestAuditService.getSummary({
                imeis: parsedImeis,
                startDate,
                endDate
            });
        } catch (error) {
            console.warn('Ingest audit summary unavailable for integrity export:', error.message);
        }

        const csv = recordManagementService.buildIntegrityCsv(report, ingestSummary);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="integrity-report-${Date.now()}.csv"`);
        res.send(csv);
    }));

    router.get('/ingest-audit/status', requireAdmin, asyncHandler(async (req, res) => {
        res.json(ingestAuditService.getStatus());
    }));

    router.get('/ingest-audit/summary', requireAdmin, asyncHandler(async (req, res) => {
        const { startDate, endDate, imeis } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'startDate and endDate query parameters are required' });
        }

        const parsedImeis = typeof imeis === 'string' && imeis.trim()
            ? imeis.split(',').map((value) => value.trim()).filter(Boolean)
            : [];

        const summary = await ingestAuditService.getSummary({
            imeis: parsedImeis,
            startDate,
            endDate
        });
        res.json(summary);
    }));

    const deviceCleanupService = require('../services/deviceCleanupService');

    router.post('/devices/preview-cleanup', requireAdmin, asyncHandler(async (req, res) => {
        try {
            const { imeis } = req.body;
            const preview = await deviceCleanupService.previewDeviceCleanup({ imeis });
            res.json(preview);
        } catch (error) {
            return res.status(400).json({ error: error.message || 'Preview failed' });
        }
    }));

    router.post('/devices/cleanup', requireAdmin, asyncHandler(async (req, res) => {
        try {
            const result = await deviceCleanupService.cleanupDevices(req.body || {});
            res.json(result);
        } catch (error) {
            return res.status(400).json({ error: error.message || 'Device cleanup failed' });
        }
    }));

    module.exports = router;
