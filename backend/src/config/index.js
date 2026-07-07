// backend/src/config/index.js
const path = require('path');
require('dotenv').config();

// Helper function to get CORS origins
function getCorsOrigins() {
    const corsOrigin = process.env.CORS_ORIGIN;
    if (corsOrigin) {
        return corsOrigin.split(',').map(origin => origin.trim());
    }
    
    // Default origins for development and production
    const { FRONTEND_PORT } = require('./ports');
    const defaultOrigins = [
        `http://localhost:${FRONTEND_PORT}`,
        'http://localhost:3002',
        'http://localhost:3004',
        `http://127.0.0.1:${FRONTEND_PORT}`,
        'http://127.0.0.1:3002',
        'http://127.0.0.1:3004'
    ];
    
    // Add server IP if provided
    const serverIP = process.env.SERVER_IP;
    if (serverIP) {
        defaultOrigins.push(
            `http://${serverIP}:${FRONTEND_PORT}`,
            `http://${serverIP}:3002`,
            `http://${serverIP}:3004`
        );
    }
    
    return defaultOrigins;
}

const config = {
    env: process.env.NODE_ENV || 'development',
    
    http: {
        port: require('./ports').HTTP_PORT,
        cors: {
            origin: getCorsOrigins(),
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
        }
    },

    tcp: {
        port: parseInt(process.env.TCP_PORT) || 3003,
        timeout: parseInt(process.env.TCP_TIMEOUT) || 30000
    },

    parser: {
        maxPacketSize: parseInt(process.env.MAX_PACKET_SIZE) || 1024, // Default to 1024
        validateChecksum: true,
        xteaKey: process.env.GALILEOSKY_XTEA_KEY || null,
        ackAfterSave: process.env.ACK_AFTER_SAVE === 'true',
    },

    database: {
        development: {
            dialect: 'sqlite',
            storage: path.join(__dirname, '..', '..', 'data', 'dev.sqlite'),
            logging: console.log
        },
        test: {
            dialect: 'sqlite',
            storage: ':memory:',
            logging: false
        },
        production: {
            dialect: 'sqlite',
            storage: path.join(__dirname, '..', '..', 'data', 'prod.sqlite'),
            logging: false
        },
        url: process.env.DATABASE_URL || 'mongodb://localhost:27017/galileosky'
    },

    logging: {
        level: process.env.LOG_LEVEL || 'info',
        directory: path.join(__dirname, '..', '..', 'logs')
    },

    websocket: {
        heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 30000 // Default to 30000ms
    },

    parallel: {
        maxConcurrency: parseInt(process.env.MAX_CONCURRENCY) || Math.max(1, require('os').cpus().length - 1),
        batchSize: parseInt(process.env.BATCH_SIZE) || 100,
        enableWorkerThreads: process.env.ENABLE_WORKER_THREADS === 'true' || false
    },

    jwt: {
        secret: (() => {
            const secret = process.env.JWT_SECRET;
            if (!secret || secret === 'your-secret-key' || secret === 'default-jwt-secret') {
                if (process.env.NODE_ENV === 'production') {
                    throw new Error('JWT_SECRET must be set in production environment and cannot use default values');
                }
                // Allow default only in development
                return 'your-secret-key';
            }
            // Validate secret strength in production
            if (process.env.NODE_ENV === 'production' && secret.length < 32) {
                throw new Error('JWT_SECRET must be at least 32 characters long in production');
            }
            return secret;
        })(),
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
    },
    
    session: {
        secret: (() => {
            const secret = process.env.SESSION_SECRET;
            if (!secret || secret === 'your-session-secret' || secret === 'default-session-secret') {
                if (process.env.NODE_ENV === 'production') {
                    throw new Error('SESSION_SECRET must be set in production environment and cannot use default values');
                }
                // Allow default only in development
                return 'your-session-secret';
            }
            // Validate secret strength in production
            if (process.env.NODE_ENV === 'production' && secret.length < 32) {
                throw new Error('SESSION_SECRET must be at least 32 characters long in production');
            }
            return secret;
        })()
    }
};

// Validate required environment variables
function validateEnvironment() {
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (isProduction) {
        const requiredVars = [
            { name: 'JWT_SECRET', minLength: 32 },
            { name: 'SESSION_SECRET', minLength: 32 }
        ];
        
        const errors = [];
        
        for (const { name, minLength } of requiredVars) {
            const value = process.env[name];
            
            if (!value) {
                errors.push(`${name} is required in production`);
            } else if (value.includes('default') || value.includes('your-') || value.includes('change-this')) {
                errors.push(`${name} cannot use default/placeholder values in production`);
            } else if (value.length < minLength) {
                errors.push(`${name} must be at least ${minLength} characters long in production`);
            }
        }
        
        if (errors.length > 0) {
            throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
        }
    }
}

// Run validation
validateEnvironment();

module.exports = config;
