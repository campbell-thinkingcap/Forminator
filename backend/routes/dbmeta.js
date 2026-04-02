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
// FK fetchers — only called when ≥2 tables match; non-fatal on error
// ---------------------------------------------------------------------------

async function getPostgresFKs(tableKeys) {
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
    SELECT
      kcu.table_schema  AS fk_schema,
      kcu.table_name    AS fk_table,
      kcu.column_name   AS fk_column,
      kcu2.table_schema AS pk_schema,
      kcu2.table_name   AS pk_table,
      kcu2.column_name  AS pk_column
    FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name   = rc.constraint_name
     AND kcu.constraint_schema = rc.constraint_schema
    JOIN information_schema.key_column_usage kcu2
      ON kcu2.constraint_name   = rc.unique_constraint_name
     AND kcu2.constraint_schema = rc.unique_constraint_schema
    WHERE (kcu.table_schema  || '.' || kcu.table_name)  = ANY($1)
       OR (kcu2.table_schema || '.' || kcu2.table_name) = ANY($1)
  `, [tableKeys]);
  await pool.end();
  return rows.map(r => ({
    fkTable:  `${r.fk_schema}.${r.fk_table}`,
    fkColumn: r.fk_column,
    pkTable:  `${r.pk_schema}.${r.pk_table}`,
    pkColumn: r.pk_column,
  }));
}

async function getMssqlFKs(tableKeys) {
  const sql = require('mssql');
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

  // Build an IN list from the tableKeys array (e.g. ['dbo.Foo', 'dbo.Bar'])
  const inList = tableKeys.map(k => `'${k.replace(/'/g, "''")}'`).join(',');

  const result = await pool.request().query(`
    SELECT
      SCHEMA_NAME(ft.schema_id) + '.' + ft.name AS fk_table,
      fc.name                                    AS fk_column,
      SCHEMA_NAME(pt.schema_id) + '.' + pt.name AS pk_table,
      pc.name                                    AS pk_column
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN sys.tables  ft ON ft.object_id = fk.parent_object_id
    JOIN sys.columns fc ON fc.object_id = fk.parent_object_id  AND fc.column_id = fkc.parent_column_id
    JOIN sys.tables  pt ON pt.object_id = fk.referenced_object_id
    JOIN sys.columns pc ON pc.object_id = fk.referenced_object_id AND pc.column_id = fkc.referenced_column_id
    WHERE SCHEMA_NAME(ft.schema_id) + '.' + ft.name IN (${inList})
       OR SCHEMA_NAME(pt.schema_id) + '.' + pt.name IN (${inList})
  `);
  await pool.close();
  return result.recordset.map(r => ({
    fkTable:  r.fk_table,
    fkColumn: r.fk_column,
    pkTable:  r.pk_table,
    pkColumn: r.pk_column,
  }));
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

// Minimum number of assigned properties for a secondary table to be included
const MIN_TABLE_PROPS = 2;

// ---------------------------------------------------------------------------
// extractSchemaProps — recursively flattens JSON Schema properties to a list
// of dot-notation leaf names, skipping const/uuid fields at every level.
// ---------------------------------------------------------------------------

function extractSchemaProps(schema, prefix = '') {
  if (!schema.properties) return [];
  const results = [];
  for (const [key, prop] of Object.entries(schema.properties)) {
    if ('const' in prop || prop.format === 'uuid') continue;
    const qualifiedName = prefix ? `${prefix}.${key}` : key;
    if (prop.type === 'object' && prop.properties) {
      results.push(...extractSchemaProps(prop, qualifiedName));
    } else {
      results.push(qualifiedName);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// bestColumnMatch — for a single leaf name, find the best matching column
// across all tables. Returns { tableKey, dbColumn, matchType, score } or null.
// ---------------------------------------------------------------------------

function bestColumnMatch(leafProp, tableMap) {
  const leafLower = leafProp.toLowerCase();
  const leafNorm  = normalize(leafProp);
  let best = null;

  for (const [tableKey, info] of tableMap) {
    for (const col of info.columns) {
      let score = 0;
      let matchType = null;
      if (col === leafProp) {
        score = 3; matchType = 'exact';
      } else if (col.toLowerCase() === leafLower) {
        score = 2; matchType = 'case-insensitive';
      } else if (normalize(col) === leafNorm) {
        score = 1; matchType = 'normalized';
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { tableKey, dbColumn: col, matchType, score };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Table scoring — returns 0–1 ratio of how well a table matches a full schema
// (kept for per-table score output; semantics: coverage of the whole schema)
// ---------------------------------------------------------------------------

function scoreTable(columnNames, schemaProps) {
  const colSet   = new Set(columnNames);
  const colLower = new Set(columnNames.map(c => c.toLowerCase()));
  const colNorm  = new Set(columnNames.map(normalize));
  let points = 0;
  for (const prop of schemaProps) {
    const leaf = prop.includes('.') ? prop.split('.').pop() : prop;
    if      (colSet.has(leaf))                  points += 3;
    else if (colLower.has(leaf.toLowerCase()))  points += 2;
    else if (colNorm.has(normalize(leaf)))      points += 1;
  }
  return points / (schemaProps.length * 3);
}

// ---------------------------------------------------------------------------
// SELECT query builders
// ---------------------------------------------------------------------------

// Single-table (unchanged behaviour)
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

// Multi-table JOIN query
function buildMultiSelectQuery(tableResults, fkEdges, db) {
  const q  = db === 'postgres' ? '"' : '[';
  const qc = db === 'postgres' ? '"' : ']';
  const quoted = name => `${q}${name}${qc}`;

  // Assign a short alias to each table: t1, t2, ...
  const aliases = new Map(); // tableName → alias
  tableResults.forEach((t, i) => aliases.set(t.tableName, `t${i + 1}`));

  // SELECT lines
  const selectLines = [];
  for (const t of tableResults) {
    const alias = aliases.get(t.tableName);
    for (const row of t.mapping) {
      const col = `${alias}.${quoted(row.dbColumn)}`;
      const leaf = row.schemaProp.includes('.') ? row.schemaProp.split('.').pop() : row.schemaProp;
      const aliasClause = row.dbColumn !== leaf ? ` AS ${quoted(row.schemaProp)}` : '';
      selectLines.push(`  ${col}${aliasClause}`);
    }
  }

  // FROM + JOINs
  const [primarySchema, primaryTable] = tableResults[0].tableName.split('.');
  const fromClause = db === 'postgres'
    ? `${quoted(primarySchema)}.${quoted(primaryTable)} AS t1`
    : `${quoted(primarySchema)}.${quoted(primaryTable)} AS t1`;

  const joinClauses = tableResults.slice(1).map((t, i) => {
    const alias = `t${i + 2}`;
    const [tSchema, tTable] = t.tableName.split('.');
    const tableRef = db === 'postgres'
      ? `${quoted(tSchema)}.${quoted(tTable)}`
      : `${quoted(tSchema)}.${quoted(tTable)}`;

    // Find an FK edge between this table and any already-joined table
    const joinedTables = [tableResults[0].tableName, ...tableResults.slice(1, i + 1).map(x => x.tableName)];
    const edge = fkEdges.find(e =>
      (e.fkTable === t.tableName && joinedTables.includes(e.pkTable)) ||
      (e.pkTable === t.tableName && joinedTables.includes(e.fkTable))
    );

    let onClause;
    if (edge) {
      if (edge.fkTable === t.tableName) {
        const pkAlias = aliases.get(edge.pkTable);
        onClause = `${alias}.${quoted(edge.fkColumn)} = ${pkAlias}.${quoted(edge.pkColumn)}`;
      } else {
        const fkAlias = aliases.get(edge.fkTable);
        onClause = `${alias}.${quoted(edge.pkColumn)} = ${fkAlias}.${quoted(edge.fkColumn)}`;
      }
    } else {
      onClause = '/* join condition needed */';
    }

    return `JOIN ${tableRef} AS ${alias} ON ${onClause}`;
  });

  return `SELECT\n${selectLines.join(',\n')}\nFROM ${fromClause}\n${joinClauses.join('\n')};`;
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

  const schemaProps = extractSchemaProps(schema);

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

  // --- Per-property assignment ---
  const propAssignments = new Map(); // tableKey → [{ schemaProp, dbColumn, matchType }]
  const unmatchedProps  = [];

  for (const schemaName of schemaProps) {
    const leaf = schemaName.includes('.') ? schemaName.split('.').pop() : schemaName;
    const hit  = bestColumnMatch(leaf, tableMap);
    if (hit) {
      if (!propAssignments.has(hit.tableKey)) propAssignments.set(hit.tableKey, []);
      propAssignments.get(hit.tableKey).push({
        schemaProp: schemaName,
        dbColumn:   hit.dbColumn,
        matchType:  hit.matchType,
      });
    } else {
      unmatchedProps.push(schemaName);
    }
  }

  // Threshold filter: keep tables with ≥ MIN_TABLE_PROPS assigned properties
  const qualifiedEntries = [...propAssignments.entries()]
    .filter(([, assignments]) => assignments.length >= MIN_TABLE_PROPS);

  // --- All-unmatched edge case ---
  if (qualifiedEntries.length === 0) {
    return res.json({ tables: [], unmatchedProps, selectQuery: null, joinPossible: false });
  }

  // Compute per-table score (fraction of the full schema this table covers)
  const tableResults = qualifiedEntries
    .map(([tableKey, mapping]) => {
      const info  = tableMap.get(tableKey);
      const score = Math.round(scoreTable(info.columns, schemaProps) * 100);
      return { tableName: tableKey, score, mapping };
    })
    .sort((a, b) => b.score - a.score);

  // --- Single-table fast path (legacy-compatible response) ---
  if (tableResults.length === 1) {
    const winner   = tableMap.get(tableResults[0].tableName);
    // Merge unmatched props into the mapping for display
    const fullMapping = [
      ...tableResults[0].mapping,
      ...unmatchedProps.map(p => ({ schemaProp: p, dbColumn: null, matchType: 'unmatched' })),
    ];
    const selectQuery = buildSelectQuery(fullMapping, winner.schema, winner.table, db);
    return res.json({
      tableName:   tableResults[0].tableName,
      score:       tableResults[0].score,
      mapping:     fullMapping,
      selectQuery,
    });
  }

  // --- Multi-table path ---
  let fkEdges = [];
  let joinPossible = false;
  try {
    const tableKeys = tableResults.map(t => t.tableName);
    fkEdges = db === 'postgres'
      ? await getPostgresFKs(tableKeys)
      : await getMssqlFKs(tableKeys);
    // Only count edges where both ends are in our qualified set
    const tableSet = new Set(tableKeys);
    fkEdges = fkEdges.filter(e => tableSet.has(e.fkTable) && tableSet.has(e.pkTable));
    joinPossible = fkEdges.length > 0;
  } catch (err) {
    console.error('[dbmeta] FK lookup error (non-fatal):', err.message);
  }

  const selectQuery = buildMultiSelectQuery(tableResults, fkEdges, db);

  return res.json({ tables: tableResults, unmatchedProps, selectQuery, joinPossible });
});

module.exports = router;
