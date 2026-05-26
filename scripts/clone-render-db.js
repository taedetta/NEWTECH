'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function makePool(url, label) {
  if (!url) throw new Error(`${label} database URL required`);
  const isLocal = /localhost|127\.0\.0\.1/i.test(url);
  return new Pool({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 30000,
  });
}

async function applySchema(client) {
  const root = path.join(__dirname, '..');
  for (const file of ['bootstrap-schema.sql', 'schema-patches.sql']) {
    const fp = path.join(root, 'scripts', file);
    if (!fs.existsSync(fp)) continue;
    console.log(`[clone-db] Applying ${file}...`);
    await client.query(fs.readFileSync(fp, 'utf8'));
  }
}

async function listTables(client) {
  const r = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return r.rows.map((row) => row.table_name);
}

async function copyTable(sourceClient, targetClient, table) {
  const cols = await sourceClient.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [table]);
  if (cols.rows.length === 0) return 0;

  const colNames = cols.rows.map((c) => c.column_name);
  const colList = colNames.map((c) => `"${c}"`).join(', ');
  const rows = await sourceClient.query(`SELECT ${colList} FROM "${table}"`);
  if (rows.rows.length === 0) {
    console.log(`[clone-db] ${table}: 0 rows`);
    return 0;
  }

  await targetClient.query(`DELETE FROM "${table}"`);
  const batchSize = 150;
  let copied = 0;
  for (let i = 0; i < rows.rows.length; i += batchSize) {
    const batch = rows.rows.slice(i, i + batchSize);
    const placeholders = batch.map((_, bi) => {
      const offset = bi * colNames.length;
      return `(${colNames.map((__, ci) => `$${offset + ci + 1}`).join(', ')})`;
    }).join(', ');
    const values = batch.flatMap((row) => colNames.map((c) => row[c]));
    await targetClient.query(`INSERT INTO "${table}" (${colList}) VALUES ${placeholders}`, values);
    copied += batch.length;
  }

  const seq = await targetClient.query(`SELECT pg_get_serial_sequence($1, 'id') AS seq`, [`public.${table}`]);
  if (seq.rows[0]?.seq) {
    await targetClient.query(
      `SELECT setval($1, COALESCE((SELECT MAX(id) FROM "${table}"), 1), true)`,
      [seq.rows[0].seq]
    );
  }
  console.log(`[clone-db] ${table}: ${copied} rows`);
  return copied;
}

async function cloneDatabase(sourceUrl, targetUrl) {
  const sourcePool = makePool(sourceUrl, 'Source');
  const targetPool = makePool(targetUrl, 'Target');
  const sourceClient = await sourcePool.connect();
  const targetClient = await targetPool.connect();
  try {
    await targetClient.query('BEGIN');
    await targetClient.query('SET session_replication_role = replica');
    await applySchema(targetClient);

    const tables = await listTables(sourceClient);
    console.log(`[clone-db] Copying ${tables.length} tables...`);
    let total = 0;
    for (const table of tables) {
      total += await copyTable(sourceClient, targetClient, table);
    }
    await targetClient.query('SET session_replication_role = DEFAULT');
    await targetClient.query('COMMIT');
    console.log(`[clone-db] Done — ${total} rows`);
    return { tables: tables.length, rows: total };
  } catch (err) {
    await targetClient.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    sourceClient.release();
    targetClient.release();
    await sourcePool.end();
    await targetPool.end();
  }
}

module.exports = { cloneDatabase };

if (require.main === module) {
  cloneDatabase(process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL, process.env.TARGET_DATABASE_URL)
    .then((r) => { console.log(JSON.stringify(r)); process.exit(0); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
