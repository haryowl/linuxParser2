// backend/config/development.js
const { HTTP_PORT, FRONTEND_PORT } = require('./ports');

module.exports = {
    env: 'development',
    http: {
        port: HTTP_PORT,
        cors: {
            origin: `http://localhost:${FRONTEND_PORT}`,
            credentials: true
        }
    },
    tcp: {
        port: parseInt(process.env.TCP_PORT) || 5001,
        timeout: 30000,
        maxConnections: 100
    },
    websocket: {
        heartbeatInterval: 30000
    },
    logging: {
        level: 'debug',
        format: 'dev'
    },
    parser: {
        maxPacketSize: parseInt(process.env.MAX_PACKET_SIZE) || 32767,
        validateChecksum: true
    }
};
