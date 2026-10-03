/**
 * db/source-wrapper.js — Source-tag helpers for staging/production data isolation.
 */

const pool = require('./index');
const { getAppEnv } = require('../lib/app-env');

function buildSourceParam() {
  return { source: getAppEnv() };
}

function addSourceFilter(sql, params = []) {
  const nextParams = [...params, getAppEnv()];
  const placeholder = `$${nextParams.length}`;
  const suffixMatch = sql.match(/\s+(ORDER\s+BY|GROUP\s+BY|LIMIT|RETURNING)\b/i);
  const insertAt = suffixMatch ? suffixMatch.index : sql.length;
  const head = sql.slice(0, insertAt);
  const tail = sql.slice(insertAt);
  const hasWhere = /\bWHERE\b/i.test(head);
  const sourceClause = `${hasWhere ? ' AND' : ' WHERE'} source = ${placeholder}`;
  return { sql: `${head}${sourceClause}${tail}`, params: nextParams };
}

async function queryWithSourceFilter(sql, params = []) {
  const filtered = addSourceFilter(sql, params);
  return pool.query(filtered.sql, filtered.params);
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
