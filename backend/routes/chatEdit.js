const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
const router = express.Router();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildEditSystemPrompt(schema) {
  return `You are a JSON Schema editing assistant. The developer will describe changes they want to make to a JSON Schema, and you will return the complete modified schema.

CURRENT SCHEMA:
${JSON.stringify(schema, null, 2)}

RULES:
1. Always respond with valid JSON in exactly this format:
   {"message": "Explanation of what you changed", "schema": { ...complete modified schema... }}
2. If the user's request requires no schema change (e.g. a question about the schema), respond with:
   {"message": "Your answer here", "schema": null}
3. Always return the COMPLETE schema — never a partial diff or fragment.
4. Preserve all existing fields, types, and constraints unless the user explicitly asks to change them.
5. When adding a new required field, add it to both "properties" and the "required" array.
6. Maintain valid JSON Schema draft-07 structure.
7. Do not add comments or explanations inside the schema JSON itself.
8. If the user's request is ambiguous, make a sensible interpretation and explain your choice in "message".

No text outside the JSON object. No markdown fences.`;
}

router.post('/', async (req, res) => {
  const { schema, messages = [] } = req.body;

  if (!schema) {
    return res.status(400).json({ error: 'Schema is required' });
  }

  // Strip any UI-only metadata — Anthropic only accepts role + content
  const apiMessages = [
    { role: 'user', content: 'Start' },
    ...messages.map(({ role, content }) => ({ role, content }))
  ];

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: buildEditSystemPrompt(schema),
      messages: apiMessages
    });

    const rawText = response.content[0].text.trim();

    let parsed;
    try {
      const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      parsed = JSON.parse(fenceMatch ? fenceMatch[1].trim() : rawText);
    } catch {
      const objMatch = rawText.match(/\{[\s\S]*\}/);
      try {
        parsed = objMatch ? JSON.parse(objMatch[0]) : null;
      } catch {
        parsed = null;
      }
    }

    // Validate returned schema has expected structure before passing it back
    const returnedSchema = parsed?.schema ?? null;
    const validSchema = returnedSchema && typeof returnedSchema === 'object' && returnedSchema.properties
      ? returnedSchema
      : null;

    res.json({
      message: parsed?.message ?? rawText,
      schema: validSchema
    });
  } catch (err) {
    console.error('Chat edit error:', err.message);
    res.status(500).json({ error: 'Failed to get AI response', details: err.message });
  }
});

module.exports = router;
