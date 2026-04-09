const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
const router = express.Router();
const skillSchemaMap = require('../data/skill-schema-map.json');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Build a compact catalog string for the Claude prompt
function buildCatalog() {
  return skillSchemaMap.map((entry, i) =>
    `${i + 1}. schema="${entry.schema}" | name="${entry.skillName}" | intent="${entry.intent}" | keywords=[${entry.keywords.join(', ')}]`
  ).join('\n');
}

// POST /api/schema-router
// Body: { request: string }
// Returns: { schemas: string[], reasoning: string }
router.post('/', async (req, res) => {
  const { request } = req.body;

  if (!request?.trim()) {
    return res.status(400).json({ error: 'request is required' });
  }

  const catalog = buildCatalog();

  const prompt = `You are a schema routing agent. Given a user request, identify which schema(s) from the catalog below are needed to fulfil it. There may be one or more.

CATALOG:
${catalog}

USER REQUEST:
${request}

Respond with valid JSON only:
{
  "schemas": ["schema_name_1", "schema_name_2"],
  "reasoning": "brief explanation of why these schemas were selected"
}

Rules:
- Only return schema names that exist in the catalog above.
- Return an empty array if no schema is relevant.
- Do not invent schema names.`;

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

    if (!parsed || !Array.isArray(parsed.schemas)) {
      return res.status(500).json({ error: 'Unexpected response from model', raw: rawText });
    }

    // Filter to only valid schema names from the catalog
    const validSchemas = skillSchemaMap.map(e => e.schema);
    const schemas = parsed.schemas.filter(s => validSchemas.includes(s));

    res.json({ schemas, reasoning: parsed.reasoning ?? '' });
  } catch (err) {
    console.error('Schema router error:', err.message);
    res.status(500).json({ error: 'Failed to route schema', details: err.message });
  }
});

module.exports = router;
