// Load environment variables from env.production (relative to this file)
const path = require('path');
const envProductionPath = path.join(__dirname, 'env.production');

let envLoaded = false;
try {
    require('dotenv').config({ path: envProductionPath });
    envLoaded = true;
} catch (error) {
    try {
        const fs = require('fs');
        if (fs.existsSync(envProductionPath)) {
            const envContent = fs.readFileSync(envProductionPath, 'utf8');
            envContent.split('\n').forEach(line => {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('#')) {
                    const [key, ...valueParts] = trimmedLine.split('=');
                    if (key && valueParts.length > 0) {
                        const value = valueParts.join('=').replace(/^["']|["']$/g, '');
                        process.env[key.trim()] = value.trim();
                    }
                }
            });
            envLoaded = true;
        }
    } catch (manualError) {
        console.warn(`Warning: Could not load ${envProductionPath}. Set environment variables manually.`);
    }
}

module.exports = {
  apps: [{
    name: 'gali-parse',
    cwd: __dirname,
    script: path.join(__dirname, 'backend/src/server.js'),
    instances: process.env.PM2_INSTANCES || 1,
    exec_mode: process.env.PM2_EXEC_MODE || 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || '1G',
    min_uptime: process.env.PM2_MIN_UPTIME || '10s',
    max_restarts: process.env.PM2_MAX_RESTARTS || 10,
    restart_delay: process.env.PM2_RESTART_DELAY || 4000,
    
    // Environment variables
    env: {
      NODE_ENV: 'production',
      HTTP_PORT: process.env.HTTP_PORT || 8081,
      FRONTEND_PORT: process.env.FRONTEND_PORT || 8080,
      TCP_PORT: process.env.TCP_PORT || 3003,
      SERVER_IP: process.env.SERVER_IP || 'localhost',
      SERVER_DOMAIN: process.env.SERVER_DOMAIN || 'localhost',
      CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:8080',
      // Secrets - MUST be provided, will fail if missing or using defaults
      JWT_SECRET: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? undefined : 'dev-secret-key'),
      SESSION_SECRET: process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? undefined : 'dev-session-secret'),
      LOG_LEVEL: process.env.LOG_LEVEL || 'info',
      DB_STORAGE: process.env.DB_STORAGE || 'backend/data/prod.sqlite',
      AUTO_EXPORT_ENABLED: process.env.AUTO_EXPORT_ENABLED || 'true',
      EXPORT_DIR: process.env.EXPORT_DIR || 'backend/exports',
      BACKUP_ENABLED: process.env.BACKUP_ENABLED || 'true',
      BACKUP_DIR: process.env.BACKUP_DIR || 'backups',
      HEALTH_CHECK_ENABLED: process.env.HEALTH_CHECK_ENABLED || 'true',
      METRICS_ENABLED: process.env.METRICS_ENABLED || 'true',
      RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED || 'true',
      RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS || '900000',
      RATE_LIMIT_MAX_REQUESTS: process.env.RATE_LIMIT_MAX_REQUESTS || '100',
      RATE_LIMIT_LOGIN_WINDOW_MS: process.env.RATE_LIMIT_LOGIN_WINDOW_MS || '60000',
      RATE_LIMIT_LOGIN_MAX_REQUESTS: process.env.RATE_LIMIT_LOGIN_MAX_REQUESTS || '30',
      RECORD_RETENTION_ENABLED: process.env.RECORD_RETENTION_ENABLED || 'false',
      RECORD_RETENTION_DAYS: process.env.RECORD_RETENTION_DAYS || '365',
      TRACKING_MAX_POINTS: process.env.TRACKING_MAX_POINTS || '15000',
      DB_DIALECT: process.env.DB_DIALECT || 'sqlite',
      DATABASE_URL: process.env.DATABASE_URL || '',
      COOKIE_SECURE: process.env.COOKIE_SECURE || 'false'
    },
    
    // Logging configuration
    error_file: process.env.PM2_ERROR_FILE || 'logs/err.log',
    out_file: process.env.PM2_OUT_FILE || 'logs/out.log',
    log_file: process.env.PM2_LOG_FILE || 'logs/combined.log',
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Advanced PM2 options
    kill_timeout: 5000,
    listen_timeout: 10000,
    wait_ready: false,

    // Monitoring
    pmx: true,

    // Source map support
    source_map_support: true,

    // Node.js options
    node_args: [
      '--max-old-space-size=2048'
    ]
  }]
};
