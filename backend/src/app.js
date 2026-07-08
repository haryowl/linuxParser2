// backend/src/app.js

// Validate environment variables on startup
const { validateEnvironment } = require('./utils/envValidator');
const logger = require('./utils/logger');
try {
    validateEnvironment();
} catch (error) {
    logger.error('Environment validation failed:', error.message);
    process.exit(1);
}

const express = require('express');
const app = express();
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const http = require('http');
const websocketHandler = require('./services/websocketHandler');
const archiveStatStore = require('./services/archiveStatStore');
const archiveStatScheduler = require('./services/archiveStatScheduler');
const GalileoskyParser = require('./services/parser');
const cache = require('./utils/cache');
const net = require('net');
const { attachTcpDataHandler } = require('./services/tcpConnectionProcessor');
const { Device, Record, DeviceCommand, sequelize } = require('./models');
const { Op, QueryTypes } = require('sequelize');

const recordsRouter = require('./routes/records');
const alertsRouter = require('./routes/alerts');
const autoExportRouter = require('./routes/autoExport');
const deviceCommandsRouter = require('./routes/deviceCommands');
const commandQueue = require('./services/commandQueue');
const connectionRegistry = require('./services/connectionRegistry');

// Configure server with larger header limits
const server = http.createServer({
    maxHeaderSize: 32768, // 32KB header limit (default is 8KB)
    maxHttpHeaderSize: 32768
}, app);

// Create parser instance
const parser = new GalileoskyParser();


// No-data-loss backpressure configuration
const BACKPRESSURE_CONFIG = {
    maxMemoryBuffer: 100 * 1024 * 1024, // 100MB memory buffer
    maxDiskBuffer: 500 * 1024 * 1024,   // 500MB disk buffer
    batchFlushInterval: 1000,            // 1 second batch flush
    maxPacketSize: 1000,                 // 1000 bytes per packet
    maxConcurrentDevices: 40,            // Support up to 40 devices
    connectionTimeout: 30000,            // 30 seconds timeout
    retryDelay: 5000,                    // 5 seconds retry delay
    diskBufferPath: './data/buffer'      // Disk buffer location
};

// Global connection and buffer tracking
let activeConnections = 0;
let totalConnections = 0;
let memoryBufferSize = 0;
let diskBufferSize = 0;
let isOverloaded = false;
let bufferStats = {
    totalPackets: 0,
    processedPackets: 0,
    queuedPackets: 0,
    droppedPackets: 0
};

// Ensure buffer directory exists
if (!fs.existsSync(BACKPRESSURE_CONFIG.diskBufferPath)) {
    fs.mkdirSync(BACKPRESSURE_CONFIG.diskBufferPath, { recursive: true });
}

// Buffer management functions
function addToBuffer(packet, connectionAddress) {
    const packetSize = packet.length;
    
    // Check if we can fit in memory buffer
    if (memoryBufferSize + packetSize <= BACKPRESSURE_CONFIG.maxMemoryBuffer) {
        // Add to memory buffer
        memoryBufferSize += packetSize;
        bufferStats.totalPackets++;
        bufferStats.queuedPackets++;
        
        // Store packet in memory (you'll need to implement this)
        // For now, we'll process immediately to avoid data loss
        return { success: true, location: 'memory' };
    } else {
        // Check if we can fit in disk buffer
        if (diskBufferSize + packetSize <= BACKPRESSURE_CONFIG.maxDiskBuffer) {
            // Add to disk buffer
            diskBufferSize += packetSize;
            bufferStats.totalPackets++;
            bufferStats.queuedPackets++;
            
            // Store packet to disk (you'll need to implement this)
            // For now, we'll process immediately to avoid data loss
            return { success: true, location: 'disk' };
        } else {
            // Buffer is full - this should never happen with proper configuration
            logger.error('Buffer overflow - this should not happen with no-data-loss policy');
            bufferStats.droppedPackets++;
            return { success: false, error: 'Buffer overflow' };
        }
    }
}

function removeFromBuffer(packetSize, location) {
    if (location === 'memory') {
        memoryBufferSize -= packetSize;
    } else if (location === 'disk') {
        diskBufferSize -= packetSize;
    }
    bufferStats.queuedPackets--;
    bufferStats.processedPackets++;
}

function getBufferStats() {
    return {
        ...bufferStats,
        memoryBufferSize,
        diskBufferSize,
        memoryBufferPercent: (memoryBufferSize / BACKPRESSURE_CONFIG.maxMemoryBuffer) * 100,
        diskBufferPercent: (diskBufferSize / BACKPRESSURE_CONFIG.maxDiskBuffer) * 100,
        activeConnections,
        totalConnections
    };
}

// Log buffer stats every 30 seconds
setInterval(() => {
    const stats = getBufferStats();
    logger.debug('Buffer Statistics:', stats);
}, 30000);
// Global data references for mobile application (in-memory arrays)
global.parsedData = [];
global.devices = new Map();
global.lastIMEI = null;

app.use(cors(config.http.cors)); // Apply CORS middleware
app.use(cookieParser()); // Parse cookies
app.use(express.json({ limit: '10mb' })); // Increase JSON body limit
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Increase URL-encoded body limit

// Add request size limits
app.use((req, res, next) => {
    // Log request headers for debugging (only in development)
    if (process.env.NODE_ENV === 'development') {
        const headerSize = JSON.stringify(req.headers).length;
        if (headerSize > 8000) { // Log if headers are large
            logger.warn('Large request headers detected', {
                size: headerSize,
                url: req.url,
                method: req.method,
                userAgent: req.headers['user-agent']
            });
        }
    }
    next();
});

// Resolve session before rate limiting so authenticated users are not throttled
const { optionalAuth } = require('./middleware/optionalAuth');
const { rateLimit } = require('./middleware/rateLimiter');
const { requireAuth } = require('./routes/auth');
const { resolveAccessibleDeviceImeis } = require('./utils/accessibleDevices');
const { getDeviceTableColumns } = require('./utils/ensureDeviceLocationColumns');
const apiRateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== 'false';
const apiRateLimitMaxRequests = Number.parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100;
const apiRateLimitWindowMs = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000;
const apiRateLimit = rateLimit(apiRateLimitMaxRequests, apiRateLimitWindowMs);
app.use('/api', optionalAuth);
app.use('/api', (req, res, next) => {
    if (!apiRateLimitEnabled) {
        return next();
    }
    if (req.path.startsWith('/auth/')) {
        return next();
    }
    return apiRateLimit(req, res, next);
});

// Mount routes directly
app.use('/api/auth', require('./routes/auth').router);
app.use('/api/devices', require('./routes/devices').router);
app.use('/api/data', require('./routes/data'));
app.use('/api/alerts', alertsRouter);
app.use('/api/settings', require('./routes/settings'));
app.use('/api/mapping', require('./routes/mapping'));
app.use('/api/records', recordsRouter);
app.use('/api/peer', require('./routes/peer'));
app.use('/api/users', require('./routes/users'));
app.use('/api/device-groups', require('./routes/deviceGroups'));
app.use('/api/auto-export', autoExportRouter);
app.use('/api/user-device-group-access', require('./routes/userDeviceGroupAccess'));
app.use('/api/roles', require('./routes/roles')); // New role management route
app.use('/api/device-commands', deviceCommandsRouter);

// Serve static files if frontend build exists (moved to end to not interfere with API routes)
const frontendBuildPath = path.join(__dirname, '..', '..', 'frontend', 'build');
if (fs.existsSync(frontendBuildPath)) {
    app.use(express.static(frontendBuildPath, {
        maxAge: '1y',
        immutable: true,
        setHeaders(res, filePath) {
            if (filePath.endsWith(`${path.sep}index.html`) || filePath.endsWith('/index.html')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            }
        }
    }));
}

// Initialize WebSocket
websocketHandler.initialize(server);

// Listen for record storage events from parser and broadcast to WebSocket clients
parser.on('recordStored', (record) => {
    logger.debug('Broadcasting record to WebSocket clients', {
        imei: record.imei,
        timestamp: record.timestamp
    });
    
    // Extract GPS data if available
    let latitude = null, longitude = null, speed = null, direction = null;
    if (record.tags) {
        // Try to extract from tags (Galileosky format)
        if (record.tags['0x30'] && record.tags['0x30'].value) {
            latitude = record.tags['0x30'].value.latitude;
            longitude = record.tags['0x30'].value.longitude;
        }
        if (record.tags['0x33'] && record.tags['0x33'].value) {
            speed = record.tags['0x33'].value.speed;
            direction = record.tags['0x33'].value.direction;
        }
    }
    // Fallback for other formats (e.g., type 33 handler)
    if (record.latitude && record.longitude) {
        latitude = record.latitude;
        longitude = record.longitude;
    }
    if (record.speed) speed = record.speed;
    if (record.direction || record.course) direction = record.direction || record.course;

    websocketHandler.broadcast('new_record', {
        imei: record.imei,
        deviceImei: record.imei,
        timestamp: record.timestamp,
        latitude,
        longitude,
        speed,
        direction,
        data: record.tags,
        recordNumber: record.recordNumber
    });
});

// Listen for device update events from parser and broadcast to WebSocket clients
parser.on('deviceUpdated', (deviceInfo) => {
    logger.debug('Broadcasting device update to WebSocket clients', {
        imei: deviceInfo.imei,
        isNew: deviceInfo.isNew,
        isActive: deviceInfo.isActive
    });
    
    websocketHandler.broadcast('device_updated', {
        imei: deviceInfo.imei,
        isNew: deviceInfo.isNew,
        lastSeen: deviceInfo.lastSeen,
        isActive: deviceInfo.isActive
    });
});

// Listen for command reply events and update command status
parser.on('commandReply', async (reply) => {
    try {
        const { imei, commandNumber, replyText, replyDataHex } = reply || {};
        if (!imei) {
            return;
        }

        let command = null;
        if (typeof commandNumber === 'number') {
            command = await DeviceCommand.findOne({
                where: {
                    imei,
                    status: 'sent',
                    commandNumber
                },
                order: [['sentAt', 'DESC']]
            });
        } else {
            logger.warn('Received command reply without commandNumber; skipping command status update', {
                imei
            });
        }

        if (command) {
            await command.update({
                status: 'replied',
                replyText: replyText || null,
                replyDataHex: replyDataHex || null,
                repliedAt: new Date()
            });
        }

        const trimmedReply = typeof replyText === 'string' ? replyText.trim() : '';
        const numericParts = trimmedReply ? trimmedReply.match(/\d+/g) : null;
        const isArchiveStatReply = numericParts && numericParts.length >= 4;
        if (isArchiveStatReply) {
            const parts = numericParts.map(value => Number(value));
            const total = parts[1];
            const serv1Transmitted = parts[2];
            const serv2Transmitted = parts[3];
            const serv1Queue = Math.max(total - serv1Transmitted, 0);
            const serv2Queue = Math.max(total - serv2Transmitted, 0);
            const device = await Device.findOne({ where: { imei } });

            const stats = {
                deviceId: device?.id || null,
                deviceName: device?.name || imei,
                total,
                serv1Transmitted,
                serv1Queue,
                serv2Transmitted,
                serv2Queue,
                rawReply: replyText
            };
            archiveStatStore.updateStats(imei, stats);
            const archivedStats = archiveStatStore.getStats(imei) || { ...stats, imei };

            websocketHandler.broadcast('archivestat_update', archivedStats);

            if ((serv1Queue < 20 || serv2Queue < 20) && archiveStatStore.shouldSendOut(imei, 300000)) {
                const commandNumberOut = Math.floor(Math.random() * 0xFFFFFFFF);
                if (device) {
                    await DeviceCommand.create({
                        deviceId: device.id,
                        imei: device.imei,
                        commandText: 'OUT 3,0',
                        commandNumber: commandNumberOut,
                        status: 'queued',
                        priority: 10,
                        maxRetries: 3,
                        createdBy: null
                    });
                    archiveStatStore.markOutSent(imei);
                    await commandQueue.processQueue();
                    logger.info('OUT 3,0 queued due to low queue', {
                        imei,
                        serv1Queue,
                        serv2Queue
                    });
                }
            }
        }

        websocketHandler.broadcast('command_reply', {
            imei,
            commandNumber,
            replyText,
            replyDataHex,
            receivedAt: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Failed to handle command reply:', error);
    }
});

// Start command queue processing loop
commandQueue.start();
archiveStatScheduler.start();

// Dashboard stats route - authenticated and scoped per user
app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
    try {
        const requestStart = Date.now();
        const user = req.user;
        const cacheKey = `dashboard_stats_${user.userId}_${user.role}`;
        const cachedStats = cache.get(cacheKey);

        if (cachedStats) {
            return res.json(cachedStats);
        }

        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const accessibleImeis = await resolveAccessibleDeviceImeis(user);

        let totalDevices = 0;
        let totalRecords = 0;
        let recentRecords = 0;
        let activeDevices = 0;

        // Avoid full-table COUNT on huge SQLite DBs during login — blocks locations/map.
        // Use live table columns (not Sequelize model attrs) to avoid selecting missing fields.
        const deviceColumns = await getDeviceTableColumns(sequelize);
        const hasLastGpsColumns = deviceColumns.has('lastLatitude') && deviceColumns.has('lastLongitude');

        if (accessibleImeis === null) {
            totalDevices = await Device.count();
            if (hasLastGpsColumns) {
                activeDevices = await Device.count({
                    where: {
                        lastLatitude: { [Op.ne]: null },
                        lastLongitude: { [Op.ne]: null },
                        lastSeen: { [Op.gte]: oneDayAgo }
                    }
                });
            } else {
                activeDevices = await Device.count({
                    where: {
                        status: 'active',
                        lastSeen: { [Op.gte]: oneDayAgo }
                    }
                });
            }
            const [estimateRow] = await sequelize.query(
                'SELECT MAX(id) AS total FROM "Records"',
                { type: QueryTypes.SELECT }
            );
            totalRecords = Number(estimateRow?.total) || 0;
            // Approximate recent activity from devices that reported recently
            recentRecords = activeDevices;
        } else if (accessibleImeis.length > 0) {
            const deviceWhere = { imei: { [Op.in]: accessibleImeis } };
            totalDevices = await Device.count({ where: deviceWhere });
            if (hasLastGpsColumns) {
                activeDevices = await Device.count({
                    where: {
                        ...deviceWhere,
                        lastLatitude: { [Op.ne]: null },
                        lastLongitude: { [Op.ne]: null },
                        lastSeen: { [Op.gte]: oneDayAgo }
                    }
                });
            } else {
                activeDevices = await Device.count({
                    where: {
                        ...deviceWhere,
                        status: 'active',
                        lastSeen: { [Op.gte]: oneDayAgo }
                    }
                });
            }
            // Skip expensive Records COUNT — use device count as lightweight placeholder
            totalRecords = 0;
            recentRecords = activeDevices;
        }

        const stats = {
            totalDevices,
            activeDevices,
            totalRecords,
            recentRecords,
            lastUpdate: now.toISOString()
        };

        cache.set(cacheKey, stats, 120000);
        logger.debug(`Dashboard stats completed in ${Date.now() - requestStart}ms`, {
            userId: user.userId,
            role: user.role
        });
        res.json(stats);
    } catch (error) {
        logger.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});

// Connection statistics route
app.get('/api/connections/stats', requireAuth, (req, res) => {
    try {
        const stats = parser.getConnectionStats();
        res.json(stats);
    } catch (error) {
        logger.error('Error fetching connection stats:', error);
        res.status(500).json({ error: 'Failed to fetch connection stats' });
    }
});

// TCP Server for device connections
const tcpServer = net.createServer((socket) => {
    const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;
    connectionRegistry.registerConnection(clientAddress, socket);
    
    // Track connection
    activeConnections++;
    totalConnections++;
    
    logger.info('New device connected:', { 
        address: clientAddress,
        activeConnections,
        totalConnections,
        bufferStats: getBufferStats()
    });

    // Reset session and adopt any IP-held pending telemetry from a prior disconnect
    parser.resetConnectionSession(clientAddress);

    // Set socket options to prevent hanging connections
    socket.setKeepAlive(true, 60000); // 60 seconds
    socket.setTimeout(30000); // 30 seconds timeout

    attachTcpDataHandler(socket, {
        parser,
        connectionRegistry,
        clientAddress,
        getBufferStats,
        isOverloaded
    });

    socket.on('error', (error) => {
        logger.error('Socket error:', {
            error: error.message,
            address: clientAddress,
            timestamp: new Date().toISOString()
        });
        // Force close the socket on error
        socket.destroy();
        parser.teardownConnection(clientAddress);
        connectionRegistry.removeConnection(clientAddress);
    });

    socket.on('timeout', () => {
        logger.warn('Socket timeout, closing connection:', {
            address: clientAddress,
            timestamp: new Date().toISOString()
        });
        socket.destroy();
    });

    socket.on('close', (hadError) => {
        // Track disconnection
        activeConnections--;
        
        logger.info('Device disconnected:', {
            address: clientAddress,
            hadError,
            activeConnections,
            totalConnections,
            bufferStats: getBufferStats(),
            timestamp: new Date().toISOString()
        });
        
        // Clear per-connection parser state on disconnect
        parser.teardownConnection(clientAddress);
        connectionRegistry.removeConnection(clientAddress);
    });

    socket.on('end', () => {
        logger.info('Device ended connection:', {
            address: clientAddress,
            timestamp: new Date().toISOString()
        });
        socket.destroy();
        parser.teardownConnection(clientAddress);
        connectionRegistry.removeConnection(clientAddress);
    });
});


// Graceful shutdown manager - single handler for all shutdown signals
let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        logger.warn('Shutdown already in progress, forcing exit');
        process.exit(1);
    }
    
    isShuttingDown = true;
    logger.info(`Received ${signal}, starting graceful shutdown...`);

    commandQueue.stop();
    archiveStatScheduler.stop();
    
    const shutdownTimeout = setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
    
    try {
        // Flush any remaining data in parser buffer
        if (parser && typeof parser.flushBuffer === 'function') {
            try {
                await parser.flushBuffer();
                logger.info('Parser buffer flushed successfully');
            } catch (error) {
                logger.error('Error flushing parser buffer:', error);
            }
        }
        
        // Stop accepting new TCP connections
        tcpServer.close(() => {
            logger.info('TCP server stopped accepting new connections');
        });
        
        // Close HTTP server
        server.close(() => {
            logger.info('HTTP server closed');
            clearTimeout(shutdownTimeout);
            process.exit(0);
        });
        
    } catch (error) {
        logger.error('Error during graceful shutdown:', error);
        clearTimeout(shutdownTimeout);
        process.exit(1);
    }
}

// Register shutdown handlers (only once)
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
// Start TCP server
const tcpPort = process.env.TCP_PORT || config.tcp.port || 3003;
tcpServer.listen(tcpPort, '0.0.0.0', () => {
    logger.info(`TCP server listening on port ${tcpPort} (all interfaces)`);
}).on('error', (error) => {
    logger.error(`TCP server error on port ${tcpPort}:`, error);
    process.exit(1);
});

// Handle server errors
tcpServer.on('error', (error) => {
    logger.error('TCP server error:', error);
});

// Handle server close
tcpServer.on('close', () => {
    logger.info('TCP server closed');
});

// Start HTTP server
server.listen(config.http.port, '0.0.0.0', () => {
    logger.info(`HTTP server listening on port ${config.http.port} (all interfaces)`);
    if (typeof process.send === 'function') {
        process.send('ready');
    }
}).on('error', (error) => {
    logger.error(`HTTP server error on port ${config.http.port}:`, error);
    process.exit(1);
});

// Export shutdown function for use in server.js
module.exports.gracefulShutdown = gracefulShutdown;

// SPA fallback - serve index.html for all non-API routes (must be before error handlers)
app.get('*', (req, res, next) => {
    // Skip API routes and static files
    if (req.path.startsWith('/api/') || req.path.startsWith('/static/')) {
        return next();
    }

    // Skip if it's a file request (has extension)
    if (req.path.includes('.')) {
        return next();
    }

    const frontendBuildPath = path.join(__dirname, '..', '..', 'frontend', 'build');
    const indexPath = path.join(frontendBuildPath, 'index.html');

    if (fs.existsSync(indexPath)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(indexPath);
    } else {
        next(); // Let notFoundHandler handle it
    }
});

// Use standardized error handler (must be last middleware)
const { errorHandler, notFoundHandler } = require('./utils/errorHandler');
app.use(notFoundHandler); // Handle 404s
app.use(errorHandler); // Handle all errors

// Export both the Express app and TCP server, plus shutdown function
module.exports = { 
    app, 
    httpServer: server, 
    tcpServer,
    gracefulShutdown,
    getBufferStats
};





