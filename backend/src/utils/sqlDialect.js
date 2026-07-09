'use strict';

/**
 * Dialect helpers for raw SQL / Sequelize fn differences between SQLite and Postgres.
 */
function dateGroupExpression(sequelize, columnName = 'createdAt') {
  const column = sequelize.col(columnName);
  const dialect = sequelize.getDialect();

  if (dialect === 'postgres') {
    return sequelize.fn('to_char', column, 'YYYY-MM-DD');
  }

  return sequelize.fn('strftime', '%Y-%m-%d', column);
}

module.exports = {
  dateGroupExpression
};
