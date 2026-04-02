const express = require('express');
const router = express.Router();

// ---------------------------------------------------------------------------
// DB column fetchers — each opens a fresh connection per request.
// This is a developer tool used infrequently; idle pool overhead isn't worth it.
// ---------------------------------------------------------------------------

async function getPostgresColumns() {
  const { Pool } = require('pg');
  const pool = new Pool({
    host:     process.env.PG_HOST,
    port:     parseInt(process.env.PG_PORT ?? '5432', 10),
    database: process.env.PG_DATABASE,
    user:     process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    connectionTimeoutMillis: 5000,
    ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  const { rows } = await pool.query(`
    SELECT table_schema, table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog','information_schema')
    ORDER BY table_schema, table_name, ordinal_position
  `);
  await pool.end();
  return rows; // [{ table_schema, table_name, column_name, data_type }]
}

async function getMssqlColumns() {
  const sql = require('mssql');
  // Use instance-based pool to avoid mssql global state issues on concurrent requests
  const pool = new sql.ConnectionPool({
    server:   process.env.MSSQL_HOST,
    port:     parseInt(process.env.MSSQL_PORT ?? '1433', 10),
    database: process.env.MSSQL_DATABASE,
    user:     process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    options:  { trustServerCertificate: true },
    connectionTimeout: 5000,
  });
  await pool.connect();
  const result = await pool.request().query(`
    SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
  `);
  await pool.close();
  return result.recordset; // [{ TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE }]
}

// ---------------------------------------------------------------------------
// Normalisation — makes "branchId", "BRANCH_ID", "branch_id" all equal
// ---------------------------------------------------------------------------

function normalize(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase → snake_case
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');           // strip separators
}

// ---------------------------------------------------------------------------
// Table scoring — returns 0–1 ratio of how well a table matches a schema
// ---------------------------------------------------------------------------

function scoreTable(columnNames, schemaProps) {
  const colSet   = new Set(columnNames);
  const colLower = new Set(columnNames.map(c => c.toLowerCase()));
  const colNorm  = new Set(columnNames.map(normalize));
  let points = 0;
  for (const prop of schemaProps) {
    if      (colSet.has(prop))                  points += 3; // exact
    else if (colLower.has(prop.toLowerCase()))  points += 2; // case-insensitive
    else if (colNorm.has(normalize(prop)))      points += 1; // normalised name
  }
  return points / (schemaProps.length * 3);
}

// ---------------------------------------------------------------------------
// Field mapping — pairs each schema property with its best DB column match
// ---------------------------------------------------------------------------

function buildMapping(columnNames, schemaProps) {
  const colSet     = new Set(columnNames);
  const colByLower = new Map(columnNames.map(c => [c.toLowerCase(), c]));
  const colByNorm  = new Map(columnNames.map(c => [normalize(c), c]));
  const rank = { exact: 0, 'case-insensitive': 1, normalized: 2, unmatched: 3 };

  return schemaProps.map(prop => {
    if (colSet.has(prop))
      return { schemaProp: prop, dbColumn: prop, matchType: 'exact' };
    const ci = colByLower.get(prop.toLowerCase());
    if (ci) return { schemaProp: prop, dbColumn: ci, matchType: 'case-insensitive' };
    const nm = colByNorm.get(normalize(prop));
    if (nm) return { schemaProp: prop, dbColumn: nm, matchType: 'normalized' };
    return { schemaProp: prop, dbColumn: null, matchType: 'unmatched' };
  }).sort((a, b) => rank[a.matchType] - rank[b.matchType]);
}

// ---------------------------------------------------------------------------
// SELECT query builder — quoted identifiers, AS aliases where names differ,
// unmatched fields become comments so gaps are visible
// ---------------------------------------------------------------------------

function buildSelectQuery(mapping, tableSchema, tableName, db) {
  const [q, qc] = db === 'postgres' ? ['"', '"'] : ['[', ']'];
  const from = db === 'postgres'
    ? `"${tableSchema}"."${tableName}"`
    : `[${tableSchema}].[${tableName}]`;
  const lines = mapping.map(row => {
    if (row.matchType === 'unmatched') {
      return `  -- ${row.schemaProp} (no matching column found)`;
    }
    const col   = `${q}${row.dbColumn}${qc}`;
    const alias = row.dbColumn !== row.schemaProp ? ` AS ${q}${row.schemaProp}${qc}` : '';
    return `  ${col}${alias}`;
  });
  return `SELECT\n${lines.join(',\n')}\nFROM ${from};`;
}

// ---------------------------------------------------------------------------
// Route: POST /api/dbmeta/analyze
// Body: { schema: JSONSchema, db: 'postgres'|'sqlserver' }
// ---------------------------------------------------------------------------

router.post('/analyze', async (req, res) => {
  const { schema, db } = req.body;

  if (!schema || !schema.properties) {
    return res.status(400).json({ error: 'schema with properties is required' });
  }
  if (db !== 'postgres' && db !== 'sqlserver') {
    return res.status(400).json({ error: 'db must be "postgres" or "sqlserver"' });
  }

  // Exclude uuid/const fields — they appear in almost every table and pollute the score
  const schemaProps = Object.keys(schema.properties).filter(k => {
    const prop = schema.properties[k];
    return !('const' in prop) && prop.format !== 'uuid';
  });

  if (schemaProps.length === 0) {
    return res.status(400).json({ error: 'Schema has no matchable properties' });
  }

  let rawColumns;
  try {
    rawColumns = db === 'postgres' ? await getPostgresColumns() : await getMssqlColumns();
  } catch (err) {
    console.error('[dbmeta] connection error:', err.message);
    return res.status(502).json({ error: 'Database connection failed', details: err.message });
  }

  if (!rawColumns || rawColumns.length === 0) {
    return res.status(404).json({ error: 'No columns found in database' });
  }

  // Group columns by table
  const tableMap = new Map(); // "schema.table" → { schema, table, columns[] }
  for (const row of rawColumns) {
    const tSchema = row.table_schema ?? row.TABLE_SCHEMA;
    const tName   = row.table_name   ?? row.TABLE_NAME;
    const colName = row.column_name  ?? row.COLUMN_NAME;
    const key = `${tSchema}.${tName}`;
    if (!tableMap.has(key)) tableMap.set(key, { schema: tSchema, table: tName, columns: [] });
    tableMap.get(key).columns.push(colName);
  }

  // Score every table and pick the winner
  let bestKey = null, bestScore = -1;
  for (const [key, info] of tableMap) {
    const s = scoreTable(info.columns, schemaProps);
    if (s > bestScore) { bestScore = s; bestKey = key; }
  }

  const winner = tableMap.get(bestKey);
  const mapping = buildMapping(winner.columns, schemaProps);
  const selectQuery = buildSelectQuery(mapping, winner.schema, winner.table, db);

  res.json({
    tableName: `${winner.schema}.${winner.table}`,
    score: Math.round(bestScore * 100), // 0–100
    mapping,
    selectQuery,
  });
});

module.exports = router;
