// backend/config/production.js

module.exports = {
    env: 'production',
    http: {
        port: require('./ports').HTTP_PORT,
        cors: {
            origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()) : false,
            credentials: true
        }
    },
    tcp: {
        port: parseInt(process.env.TCP_PORT) || 3003,
        timeout: parseInt(process.env.TCP_TIMEOUT) || 30000,
        maxConnections: parseInt(process.env.TCP_MAX_CONNECTIONS) || 100,
        keepAlive: process.env.TCP_KEEP_ALIVE === 'true' || true,
        keepAliveInterval: parseInt(process.env.TCP_KEEP_ALIVE_INTERVAL) || 60000
    },
    websocket: {
        heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 30000,
        maxConnections: parseInt(process.env.WS_MAX_CONNECTIONS) || 50
    },
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: process.env.LOG_FORMAT || 'combined',
        file: process.env.LOG_FILE || 'logs/app.log',
        maxSize: process.env.LOG_MAX_SIZE || '10m',
        maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
        datePattern: process.env.LOG_DATE_PATTERN || 'YYYY-MM-DD'
    },
    parser: {
        validateChecksum: process.env.VALIDATE_CHECKSUM !== 'false',
        maxPacketSize: parseInt(process.env.MAX_PACKET_SIZE) || 32767,
        timeout: parseInt(process.env.PARSER_TIMEOUT) || 5000,
        retryAttempts: parseInt(process.env.PARSER_RETRY_ATTEMPTS) || 3
    },
    performance: {
        maxConcurrency: parseInt(process.env.MAX_CONCURRENCY) || Math.max(1, require('os').cpus().length - 1),
        batchSize: parseInt(process.env.BATCH_SIZE) || 100,
        enableWorkerThreads: process.env.ENABLE_WORKER_THREADS === 'true' || false,
        maxMemoryBuffer: parseInt(process.env.MAX_MEMORY_BUFFER) || 104857600, // 100MB
        maxDiskBuffer: parseInt(process.env.MAX_DISK_BUFFER) || 524288000, // 500MB
        batchFlushInterval: parseInt(process.env.BATCH_FLUSH_INTERVAL) || 1000
    },
    security: {
        jwtSecret: process.env.JWT_SECRET || 'your-super-secure-jwt-secret-key-change-this-in-production',
        sessionSecret: process.env.SESSION_SECRET || 'your-super-secure-session-secret-key-change-this-in-production',
        bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12
    },
    export: {
        enabled: process.env.AUTO_EXPORT_ENABLED === 'true' || true,
        directory: process.env.EXPORT_DIR || 'backend/exports',
        format: process.env.EXPORT_FORMAT || 'pfsl',
        batchSize: parseInt(process.env.EXPORT_BATCH_SIZE) || 1000,
        retentionDays: parseInt(process.env.EXPORT_RETENTION_DAYS) || 30
    },
    backup: {
        enabled: process.env.BACKUP_ENABLED === 'true' || true,
        directory: process.env.BACKUP_DIR || 'backups',
        schedule: process.env.BACKUP_SCHEDULE || '0 2 * * *',
        retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS) || 7,
        compression: process.env.BACKUP_COMPRESSION === 'true' || true
    },
    monitoring: {
        healthCheckEnabled: process.env.HEALTH_CHECK_ENABLED === 'true' || true,
        healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000,
        metricsEnabled: process.env.METRICS_ENABLED === 'true' || true,
        metricsPort: parseInt(process.env.METRICS_PORT) || 9090
    },
    rateLimit: {
        enabled: process.env.RATE_LIMIT_ENABLED === 'true' || true,
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
        skipSuccessfulRequests: process.env.RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS === 'true' || false
    }
};
