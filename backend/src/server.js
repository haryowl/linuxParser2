// backend/src/server.js

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const WebSocket = require('ws');
const fs = require('fs');
const { sequelize } = require('./models');
const GalileoskyParser = require('./services/parser');
const deviceManager = require('./services/deviceManager');
const packetProcessor = require('./services/packetProcessor');
const logger = require('./utils/logger');
const config = require('./config');

const { app, tcpServer } = require('./app');
const { ensureRecordIndexes } = require('./utils/ensureRecordIndexes');
const { ensureDeviceLocationColumns } = require('./utils/ensureDeviceLocationColumns');
const { ensureDeviceArchiveStatTable } = require('./utils/ensureDeviceArchiveStatTable');
const archiveStatStore = require('./services/archiveStatStore');
const recordRetention = require('./services/recordRetention');
const { buildSequelizeOptions } = require('./config/database');

// Middleware - CORS is already configured in app.js
app.use(express.json());

// Serve static files if frontend build exists
const frontendBuildPath = path.join(__dirname, '../../frontend/build');
if (fs.existsSync(frontendBuildPath)) {
    app.use(express.static(frontendBuildPath));
}

// Create parser instance
const parser = new GalileoskyParser();

// WebSocket server is already initialized in app.js via websocketHandler
// No need to create another one here

// WebSocket is handled by websocketHandler in app.js
// Use websocketHandler's methods for broadcasting
const websocketHandler = require('./services/websocketHandler');

// Broadcast to WebSocket clients (wrapper for websocketHandler)
function broadcast(topic, data) {
    logger.debug(`Broadcast requested: ${topic}`, { dataSize: JSON.stringify(data).length });
    websocketHandler.broadcast(topic, data);
}

// SPA fallback route is handled in app.js before error handlers
// No need to duplicate it here

// Start the server
async function startServer() {
    try {
        // Sync database
        await sequelize.sync();
        logger.info('Database synced');

        await ensureRecordIndexes(sequelize);
        await ensureDeviceLocationColumns(sequelize);
        await ensureDeviceArchiveStatTable(sequelize);
        await archiveStatStore.loadFromDatabase();

        const dbConfig = buildSequelizeOptions();
        if (!dbConfig.url) {
            await sequelize.query('PRAGMA journal_mode = WAL;');
            await sequelize.query('PRAGMA busy_timeout = 5000;');
        }

        recordRetention.start();
        logger.info('Database indexes and retention scheduler ensured');

        // Get HTTP server from app.js (already started)
        const { httpServer, gracefulShutdown: appShutdown } = require('./app');
        
        // WebSocket server is already initialized in app.js via websocketHandler.initialize(server)
        // No need to attach upgrade handler here - it's already handled
        logger.info('WebSocket server ready (initialized in app.js)');

        // Enhanced graceful shutdown that also closes database
        const originalShutdown = appShutdown;
        const enhancedShutdown = async (signal) => {
            try {
                // Close database connection
                await sequelize.close();
                logger.info('Database connection closed');
            } catch (error) {
                logger.error('Error closing database:', error);
            }
            // Call original shutdown handler
            await originalShutdown(signal);
        };

        // Replace shutdown handler to include database closure
        process.removeAllListeners('SIGINT');
        process.removeAllListeners('SIGTERM');
        process.once('SIGINT', () => enhancedShutdown('SIGINT'));
        process.once('SIGTERM', () => enhancedShutdown('SIGTERM'));

        logger.info('Server initialization complete');

    } catch (error) {
        logger.error('Error starting server:', error);
        process.exit(1);
    }
}

// Start the server
startServer().catch(error => {
    logger.error('Failed to start server:', error);
    process.exit(1);
});

module.exports = {
    app,
    tcpServer,
    broadcast
};
