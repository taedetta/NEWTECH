'use strict';

const { Pool } = require('pg');

function parseDbUrl(url) {
  const normalized = url.replace(/^postgres(ql)?:\/\//, 'http://');
  const u = new URL(normalized);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, '') || 'postgres',
  };
}

function makePool(url, label) {
  if (!url) throw new Error(`${label} database URL required`);
  const isLocal = /localhost|127\.0\.0\.1/i.test(url);
  const isRailway = /\.rlwy\.net|railway\.internal/i.test(url);
  const cfg = parseDbUrl(url);
  return new Pool({
    ...cfg,
    ssl: isLocal || isRailway ? false : { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 60000,
  });
}

async function resetTargetSchema(client) {
  console.log('[clone-db] Resetting target schema...');
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('GRANT ALL ON SCHEMA public TO postgres');
  await client.query('GRANT ALL ON SCHEMA public TO public');
}

async function cloneEnums(sourceClient, targetClient) {
  const enums = await sourceClient.query(`
    SELECT t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname
  `);
  for (const row of enums.rows) {
    const labels = row.labels.map((l) => `'${String(l).replace(/'/g, "''")}'`).join(', ');
    await targetClient.query(`CREATE TYPE "${row.name}" AS ENUM (${labels})`);
    console.log(`[clone-db] enum ${row.name}`);
  }
}

async function ensureSequence(sourceClient, targetClient, seqName) {
  if (!seqName) return;
  const exists = await targetClient.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'S' AND c.relname = $1`, [seqName]);
  if (exists.rows.length) return;
  await targetClient.query(`CREATE SEQUENCE "${seqName}"`);
}

async function createTableFromSource(sourceClient, targetClient, table) {
  const ddl = await sourceClient.query(`
    SELECT
      'CREATE TABLE IF NOT EXISTS ' || quote_ident(c.relname) || ' (' ||
      string_agg(
        quote_ident(a.attname) || ' ' ||
        pg_catalog.format_type(a.atttypid, a.atttypmod) ||
        CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END ||
        CASE WHEN pg_get_expr(ad.adbin, ad.adrelid) IS NOT NULL
          THEN ' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid) ELSE '' END,
        ', ' ORDER BY a.attnum
      ) || ')' AS ddl
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relname = $1
      AND a.attnum > 0 AND NOT a.attisdropped
    GROUP BY c.relname
  `, [table]);
  const createSql = ddl.rows[0]?.ddl;
  if (!createSql) throw new Error(`Could not build DDL for ${table}`);
  await targetClient.query(createSql);
}

async function cloneSequences(sourceClient, targetClient) {
  const seqs = await sourceClient.query(`
    SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'
  `);
  for (const row of seqs.rows) {
    await targetClient.query(`CREATE SEQUENCE IF NOT EXISTS "${row.sequencename}"`);
  }
  console.log(`[clone-db] ${seqs.rows.length} sequences`);
}

async function cloneSchemaFromSource(sourceClient, targetClient) {
  await resetTargetSchema(targetClient);
  await cloneEnums(sourceClient, targetClient);
  await cloneSequences(sourceClient, targetClient);
  const tables = await listTables(sourceClient);
  for (const table of tables) {
    try {
      await createTableFromSource(sourceClient, targetClient, table);
      console.log(`[clone-db] schema ${table}`);
    } catch (err) {
      throw new Error(`schema ${table}: ${err.message}`);
    }
  }
  return tables;
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

  const colTypes = await sourceClient.query(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
  `, [table]);
  const jsonCols = new Set(
    colTypes.rows
      .filter((c) => ['json', 'jsonb'].includes(c.data_type) || ['json', 'jsonb'].includes(c.udt_name))
      .map((c) => c.column_name)
  );

  const targetCols = await targetClient.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
  `, [table]);
  const targetSet = new Set(targetCols.rows.map((c) => c.column_name));
  const colNames = cols.rows.map((c) => c.column_name).filter((c) => targetSet.has(c));
  const skipped = cols.rows.map((c) => c.column_name).filter((c) => !targetSet.has(c));
  if (skipped.length) {
    console.log(`[clone-db] ${table}: skipping columns missing on target: ${skipped.join(', ')}`);
  }
  if (colNames.length === 0) return 0;
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
    const values = batch.flatMap((row) => colNames.map((c) => {
      const val = row[c];
      if (val != null && jsonCols.has(c) && typeof val === 'object') return JSON.stringify(val);
      return val;
    }));
    await targetClient.query(`INSERT INTO "${table}" (${colList}) VALUES ${placeholders}`, values);
    copied += batch.length;
  }

  if (targetSet.has('id')) {
    const seq = await targetClient.query(`SELECT pg_get_serial_sequence($1, 'id') AS seq`, [`public.${table}`]);
    if (seq.rows[0]?.seq) {
      await targetClient.query(
        `SELECT setval($1, COALESCE((SELECT MAX(id) FROM "${table}"), 1), true)`,
        [seq.rows[0].seq]
      );
    }
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
    const tables = await cloneSchemaFromSource(sourceClient, targetClient);

    await targetClient.query('BEGIN');
    await targetClient.query('SET session_replication_role = replica');
    console.log(`[clone-db] Copying ${tables.length} tables...`);
    let total = 0;
    for (const table of tables) {
      try {
        total += await copyTable(sourceClient, targetClient, table);
      } catch (err) {
        throw new Error(`copy ${table}: ${err.message}`);
      }
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
