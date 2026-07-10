'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'env.production') });

const { getSystemStatus, buildSystemHealth } = require('../src/utils/systemMetrics');

(async () => {
  const status = await getSystemStatus(null);
  const health = buildSystemHealth(status);
  console.log(JSON.stringify({
    database: status.storage.database,
    total: status.storage.total,
    healthDatabase: health.checks.database
  }, null, 2));
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
