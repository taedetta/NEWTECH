/**
 * db/source-wrapper.js — Source-tag isolation helper.
 * Provides helper functions for source-aware queries.
 * Owns: source injection helpers, APP_ENV detection.
 * Does NOT own: route logic, business rules, individual table schemas.
 *
 * PATTERN: Each db/<entity>.js module manually wraps its queries.
 * Example: INSERT query should call insertWithSource() and manually add source to column list.
 * SELECT queries should call addSourceFilter() to append WHERE/AND source = $N.
 * UPDATE/DELETE queries should call addSourceFilter() similarly.
 */

const pool = require('./index');

/**
 * Get the current app environment source tag.
 * Falls back to 'production' if APP_ENV is not set.
 * @returns {string} 'production' or 'staging'
 */
function getAppEnv() {
  const env = process.env.APP_ENV || 'production';
  if (!['production', 'staging'].includes(env)) {
    console.warn(`[source-wrapper] Invalid APP_ENV="${env}", defaulting to production`);
    return 'production';
  }
  return env;
}

/**
 * Build source parameter for INSERT queries.
 * Returns the source string and incremented param index.
 * Usage: INSERT ... VALUES ($1, $2, $3) -> manually add source to column list
 * @returns {Object} { source, nextParamIndex }
 */
function buildSourceParam() {
  return {
    source: getAppEnv(),
  };
}

/**
 * Add source filtering to a query WHERE clause.
 * If query has WHERE, returns "... AND source = $N"
 * If no WHERE, returns "... WHERE source = $N"
 * @param {string} sql - SQL query (SELECT/UPDATE/DELETE)
 * @param {Array} params - Query parameters
 * @returns {Object} { sql, params } with source filter appended
 */
function addSourceFilter(sql, params = []) {
  const source = getAppEnv();
  const newParams = [...params];
  const newParamIdx = newParams.length + 1;
  newParams.push(source);

  const filterClause = sql.toUpperCase().includes('WHERE')
    ? ` AND source = $${newParamIdx}`
    : ` WHERE source = $${newParamIdx}`;

  // Insert filter before ORDER BY / GROUP BY / LIMIT so SQL stays valid
  const tailMatch = sql.match(/\s(ORDER\s+BY|GROUP\s+BY|LIMIT\s|OFFSET\s|FOR\s+UPDATE)/i);
  let newSql;
  if (tailMatch && tailMatch.index != null) {
    newSql = sql.slice(0, tailMatch.index) + filterClause + sql.slice(tailMatch.index);
  } else {
    newSql = sql + filterClause;
  }

  return { sql: newSql, params: newParams };
}

/**
 * Helper: Execute a query with source filtering appended.
 * Convenience wrapper around pool.query + addSourceFilter.
 * @param {string} sql - SQL query string
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} pool.query result
 */
async function queryWithSourceFilter(sql, params = []) {
  const { sql: filteredSql, params: filteredParams } = addSourceFilter(sql, params);
  return pool.query(filteredSql, filteredParams);
}

/**
 * Execute a raw query without source filtering.
 * Use ONLY for system/admin operations that need to see all records across environments.
 * @param {string} sql - SQL query string
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} pool.query result
 */
async function queryRaw(sql, params = []) {
  return pool.query(sql, params);
}

module.exports = {
  getAppEnv,
  buildSourceParam,
  addSourceFilter,
  queryWithSourceFilter,
  queryRaw,
  pool // Export raw pool for backwards compatibility
};
