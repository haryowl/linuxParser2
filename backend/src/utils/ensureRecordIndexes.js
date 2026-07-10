'use strict';

const logger = require('./logger');
const { RECORD_INDEXES, RECORD_DEDUP_INDEX } = require('./recordIndexDefinitions');

async function ensureRecordIndexes(sequelize) {
  const queryInterface = sequelize.getQueryInterface();

  for (const index of RECORD_INDEXES) {
    try {
      await queryInterface.addIndex('Records', index.fields, { name: index.name });
      logger.info(`Created index ${index.name} on Records`);
    } catch (error) {
      const message = error?.message || '';
      if (message.includes('already exists') || message.includes('duplicate')) {
        logger.debug(`Index ${index.name} already exists`);
      } else {
        logger.warn(`Could not create index ${index.name}: ${message}`);
      }
    }
  }

  await ensureRecordDedupIndex(sequelize);
}

async function ensureRecordDedupIndex(sequelize) {
  const dialect = sequelize.getDialect();
  const sql = RECORD_DEDUP_INDEX.createSql[dialect];
  if (!sql) {
    return;
  }

  try {
    await sequelize.query(sql);
    logger.info(`Ensured dedup index ${RECORD_DEDUP_INDEX.name} on Records`);
  } catch (error) {
    const message = error?.message || '';
    if (message.includes('already exists') || message.includes('duplicate')) {
      logger.debug(`Dedup index ${RECORD_DEDUP_INDEX.name} already exists`);
      return;
    }
    logger.warn(`Could not create dedup index ${RECORD_DEDUP_INDEX.name}: ${message}`);
  }
}

module.exports = { ensureRecordIndexes, ensureRecordDedupIndex, RECORD_INDEXES, RECORD_DEDUP_INDEX };
