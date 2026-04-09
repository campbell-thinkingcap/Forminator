const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
const { Pool } = require('pg');
const router = express.Router();
const skillSchemaMap = require('../data/skill-schema-map.json');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ThinkingCap LMS Legacy loom — conversation_id is the Fabric ID
const TC_CONVERSATION_ID = 'c2c29ce1-2464-4c99-b56c-1312b16e792f';

// Lazy-initialised pool — only created if Tapestry DB credentials are present
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

// Fetch latest revision of each skill from Tapestry DB.
// Returns [{ name, intent, keywords }] or null if DB not available.
async function fetchSkillsFromDb() {
  const db = getPool();
  if (!db) return null;

  const { rows } = await db.query(`
    SELECT DISTINCT ON (
      COALESCE(
        (regexp_match(content, '"pairId"\\s*:\\s*"([^"]+)"'))[1],
        id::text
      )
    )
    content::text AS content
    FROM conversation_messages
    WHERE conversation_id = $1
      AND metadata->>'fabric_type' = 'rsd'
    ORDER BY
      COALESCE(
        (regexp_match(content, '"pairId"\\s*:\\s*"([^"]+)"'))[1],
        id::text
      ),
      turn_index DESC
  `, [TC_CONVERSATION_ID]);

  return rows.map(row => {
    try {
      const rsd = JSON.parse(row.content);
      return {
        name:     rsd.name     ?? '',
        intent:   rsd.intent   ?? rsd.description ?? '',
        keywords: Array.isArray(rsd.keywords) ? rsd.keywords : [],
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

// Static fallback catalog derived from skill-schema-map keys
function staticCatalog() {
  return Object.keys(skillSchemaMap).map(name => ({ name, intent: '', keywords: [] }));
}

function buildCatalog(skills) {
  return skills.map((s, i) => {
    const parts = [`${i + 1}. name="${s.name}"`];
    if (s.intent)            parts.push(`intent="${s.intent}"`);
    if (s.keywords?.length)  parts.push(`keywords=[${s.keywords.join(', ')}]`);
    return parts.join(' | ');
  }).join('\n');
}

// POST /api/schema-router
// Body: { request: string }
// Returns: { schemas: string[], reasoning: string }
router.post('/', async (req, res) => {
  const { request } = req.body;
  if (!request?.trim()) {
    return res.status(400).json({ error: 'request is required' });
  }

  let skills;
  let source = 'db';
  try {
    skills = await fetchSkillsFromDb();
  } catch (err) {
    console.warn('Schema router: DB fetch failed, falling back to static map:', err.message);
    skills = null;
  }

  if (!skills) {
    skills = staticCatalog();
    source = 'static';
  }

  if (skills.length === 0) {
    return res.json({ schemas: [], reasoning: 'No skills found in catalog.', source });
  }

  const prompt = `You are a schema routing agent. Given a user request, identify which schema(s) from the catalog below are needed to fulfil it. There may be one or more.

CATALOG:
${buildCatalog(skills)}

USER REQUEST:
${request}

Respond with valid JSON only:
{
  "skillNames": ["Exact Skill Name 1", "Exact Skill Name 2"],
  "reasoning": "brief explanation of why these skills were selected"
}

Rules:
- Only return skill names that appear exactly as listed in the catalog.
- Return an empty array if no skill is relevant.
- Do not invent skill names.`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    });

    const rawText = response.content[0].text.trim();

    let parsed;
    try {
      const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      parsed = JSON.parse(fenceMatch ? fenceMatch[1].trim() : rawText);
    } catch {
      const objMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = objMatch ? JSON.parse(objMatch[0]) : null;
    }

    if (!parsed || !Array.isArray(parsed.skillNames)) {
      return res.status(500).json({ error: 'Unexpected response from model', raw: rawText });
    }

    // Translate skill names → schema names via lookup table
    const schemas = parsed.skillNames
      .map(name => skillSchemaMap[name])
      .filter(Boolean);

    res.json({ schemas, reasoning: parsed.reasoning ?? '', source });
  } catch (err) {
    console.error('Schema router error:', err.message);
    res.status(500).json({ error: 'Failed to route schema', details: err.message });
  }
});

module.exports = router;
