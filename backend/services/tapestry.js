const { Pool } = require('pg');

// ThinkingCap LMS Legacy loom — Fabric conversation ID
const TC_CONVERSATION_ID = 'c2c29ce1-2464-4c99-b56c-1312b16e792f';

let pool = null;
function getPool() {
  if (pool) return pool;
  if (!process.env.TAPESTRY_PG_HOST || !process.env.TAPESTRY_PG_PASSWORD) return null;
  pool = new Pool({
    host:     process.env.TAPESTRY_PG_HOST,
    port:     parseInt(process.env.TAPESTRY_PG_PORT || '5432', 10),
    database: process.env.TAPESTRY_PG_DATABASE || 'tapestry',
    user:     process.env.TAPESTRY_PG_USER     || 'tapestry',
    password: process.env.TAPESTRY_PG_PASSWORD,
    ssl:      { rejectUnauthorized: false },
  });
  return pool;
}

// Search ThinkingCap loom skills in Tapestry DB using keyword phrases.
// phrases: string[] — each is matched as a full phrase against skill name/category.
// Returns [{ name, category }] or [] if DB unavailable or no matches.
async function fetchRelatedSkills(phrases) {
  const db = getPool();
  if (!db) {
    console.log('[tapestry] DB not configured — skipping skill lookup');
    return [];
  }

  const cleaned = (Array.isArray(phrases) ? phrases : [phrases])
    .map(p => p.trim().toLowerCase())
    .filter(p => p.length > 1);

  if (cleaned.length === 0) return [];
  console.log(`[tapestry] skill lookup phrases: [${cleaned.join(', ')}]`);

  try {
    const conditions = cleaned.map((_, i) =>
      `(content::jsonb->>'name' ILIKE $${i + 2} OR content::jsonb->>'category' ILIKE $${i + 2})`
    ).join(' OR ');

    const params = [TC_CONVERSATION_ID, ...cleaned.map(p => `%${p}%`)];

    const { rows } = await db.query(`
      SELECT DISTINCT ON (
        COALESCE(
          (regexp_match(content, '"pairId"\\s*:\\s*"([^"]+)"'))[1],
          id::text
        )
      )
        content::jsonb->>'name'     AS name,
        content::jsonb->>'category' AS category
      FROM conversation_messages
      WHERE conversation_id = $1
        AND metadata->>'fabric_type' = 'rsd'
        AND (${conditions})
      ORDER BY
        COALESCE(
          (regexp_match(content, '"pairId"\\s*:\\s*"([^"]+)"'))[1],
          id::text
        ),
        turn_index DESC
      LIMIT 8
    `, params);

    const results = rows.filter(r => r.name);
    console.log(`[tapestry] skill query returned ${results.length} match(es)${results.length ? ': ' + results.map(r => `"${r.name}"`).join(', ') : ''}`);
    return results;
  } catch (err) {
    console.warn('[tapestry] skill DB query failed, proceeding without skills:', err.message);
    return [];
  }
}

module.exports = { fetchRelatedSkills };
