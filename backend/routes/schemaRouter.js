const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SCHEMAS_DIR = path.join(__dirname, '../../schemas');

// Build catalog from schema files — title + description from each JSON Schema
function buildCatalog() {
  const files = fs.readdirSync(SCHEMAS_DIR).filter(f => f.endsWith('.json'));
  return files.map(file => {
    try {
      const schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, file), 'utf8'));
      return {
        schema: file.replace('.json', ''),
        title:       schema.title       ?? file.replace('.json', ''),
        description: schema.description ?? '',
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
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
  if (catalog.length === 0) {
    return res.json({ schemas: [], reasoning: 'No schemas found.' });
  }

  const catalogText = catalog.map((s, i) =>
    `${i + 1}. schema="${s.schema}" | title="${s.title}" | description="${s.description.split('.')[0]}"`
  ).join('\n');

  const prompt = `You are a schema routing agent. Given a user request, identify which schema(s) from the catalog below are needed to fulfil it. There may be one or more.

CATALOG:
${catalogText}

USER REQUEST:
${request}

Respond with valid JSON only:
{
  "schemas": ["schema_name_1", "schema_name_2"],
  "reasoning": "brief explanation of why these schemas were selected"
}

Rules:
- Only return schema names exactly as listed in the catalog (the schema= value).
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
    const validSchemas = catalog.map(s => s.schema);
    const schemas = parsed.schemas.filter(s => validSchemas.includes(s));

    res.json({ schemas, reasoning: parsed.reasoning ?? '' });
  } catch (err) {
    console.error('Schema router error:', err.message);
    res.status(500).json({ error: 'Failed to route schema', details: err.message });
  }
});

module.exports = router;
