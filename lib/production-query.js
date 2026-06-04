'use strict';

/** Nightly backup and records export always use live production data only. */
const PRODUCTION_SOURCE = 'production';

function prod(alias) {
  return `${alias}.source = '${PRODUCTION_SOURCE}'`;
}

function assertProductionExport() {
  const { isStaging } = require('./app-env');
  if (isStaging()) {
    throw new Error('Backup and records export only run on production (APP_ENV=production)');
  }
}

module.exports = { PRODUCTION_SOURCE, prod, assertProductionExport };
