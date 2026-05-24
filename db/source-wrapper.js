/**
 * db/source-wrapper.js — Legacy source-tag helpers (isolation disabled).
 * Filters are no-ops so all environments share one dataset.
 */

const pool = require('./index');

function getAppEnv() {
  return 'production';
}

function buildSourceParam() {
  return { source: 'production' };
}

/** No-op: returns query unchanged (source isolation removed). */
function addSourceFilter(sql, params = []) {
  return { sql, params: [...params] };
}

async function queryWithSourceFilter(sql, params = []) {
  return pool.query(sql, params);
}

async function queryRaw(sql, params = []) {
  return pool.query(sql, params);
}

module.exports = {
  getAppEnv,
  buildSourceParam,
  addSourceFilter,
  queryWithSourceFilter,
  queryRaw,
  pool,
};
