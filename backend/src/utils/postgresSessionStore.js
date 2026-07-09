'use strict';

const logger = require('./logger');

class PostgresSessionStore {
    constructor() {
        this.sequelize = null;
        this.ready = this.init();
        setInterval(() => {
            this.cleanupExpiredSessions().catch((error) => {
                logger.error('Error cleaning up expired Postgres sessions:', error);
            });
        }, 60 * 60 * 1000);
    }

    async init() {
        const { sequelize } = require('../models');
        this.sequelize = sequelize;

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                token VARCHAR(255) PRIMARY KEY,
                "userId" INTEGER NOT NULL,
                username VARCHAR(255) NOT NULL,
                role VARCHAR(64) NOT NULL,
                "roleId" INTEGER,
                permissions TEXT,
                "mustChangePassword" BOOLEAN DEFAULT FALSE,
                "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                "lastAccessed" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `);

        logger.info('Postgres sessions table created/verified successfully');
        await this.cleanupExpiredSessions();
    }

    async set(token, session) {
        await this.ready;

        await this.sequelize.query(
            `INSERT INTO sessions (
                token, "userId", username, role, "roleId", permissions, "mustChangePassword", "lastAccessed"
            ) VALUES (
                :token, :userId, :username, :role, :roleId, :permissions, :mustChangePassword, CURRENT_TIMESTAMP
            )
            ON CONFLICT (token) DO UPDATE SET
                "userId" = EXCLUDED."userId",
                username = EXCLUDED.username,
                role = EXCLUDED.role,
                "roleId" = EXCLUDED."roleId",
                permissions = EXCLUDED.permissions,
                "mustChangePassword" = EXCLUDED."mustChangePassword",
                "lastAccessed" = CURRENT_TIMESTAMP`,
            {
                replacements: {
                    token,
                    userId: session.userId,
                    username: session.username,
                    role: session.role,
                    roleId: session.roleId || null,
                    permissions: JSON.stringify(session.permissions || {}),
                    mustChangePassword: Boolean(session.mustChangePassword)
                }
            }
        );

        logger.info('Session stored successfully', {
            token: token.substring(0, 8) + '...',
            userId: session.userId,
            username: session.username
        });
    }

    async get(token) {
        await this.ready;

        const [rows] = await this.sequelize.query(
            `SELECT * FROM sessions
             WHERE token = :token
               AND "lastAccessed" > (CURRENT_TIMESTAMP - INTERVAL '24 hours')
             LIMIT 1`,
            { replacements: { token } }
        );

        const row = rows?.[0];
        if (!row) {
            return null;
        }

        await this.updateLastAccessed(token);

        const session = {
            userId: row.userId,
            username: row.username,
            role: row.role,
            roleId: row.roleId || null,
            permissions: row.permissions ? JSON.parse(row.permissions) : {},
            mustChangePassword: Boolean(row.mustChangePassword),
            createdAt: row.createdAt ? new Date(row.createdAt) : new Date()
        };

        logger.info('Session retrieved successfully', {
            token: token.substring(0, 8) + '...',
            userId: session.userId,
            username: session.username
        });

        return session;
    }

    async delete(token) {
        await this.ready;
        await this.sequelize.query(
            'DELETE FROM sessions WHERE token = :token',
            { replacements: { token } }
        );
        logger.info('Session deleted successfully', { token: token.substring(0, 8) + '...' });
    }

    async deleteByUserId(userId) {
        await this.ready;
        const [, metadata] = await this.sequelize.query(
            'DELETE FROM sessions WHERE "userId" = :userId',
            { replacements: { userId } }
        );
        logger.info('Sessions deleted for user', { userId, changes: metadata?.rowCount || 0 });
    }

    async updateLastAccessed(token) {
        await this.ready;
        await this.sequelize.query(
            'UPDATE sessions SET "lastAccessed" = CURRENT_TIMESTAMP WHERE token = :token',
            { replacements: { token } }
        );
    }

    async cleanupExpiredSessions() {
        await this.ready;
        const [, metadata] = await this.sequelize.query(
            `DELETE FROM sessions WHERE "lastAccessed" < (CURRENT_TIMESTAMP - INTERVAL '24 hours')`
        );
        const count = metadata?.rowCount || 0;
        if (count > 0) {
            logger.info('Cleaned up expired sessions', { count });
        }
    }

    async getSessionCount() {
        await this.ready;
        const [rows] = await this.sequelize.query('SELECT COUNT(*)::int AS count FROM sessions');
        return rows?.[0]?.count || 0;
    }

    close() {
        // Main Sequelize pool is closed in server shutdown.
    }
}

module.exports = new PostgresSessionStore();
