const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Load the AI schema design guide once at startup
const SCHEMA_GUIDE = fs.readFileSync(
  path.join(__dirname, '../../schema_ai_concept.md'),
  'utf8'
);

function buildHintSystemPrompt(schema) {
  return `You are a JSON Schema quality reviewer. Examine the schema below and identify concrete improvements based on the guide.

You have deep knowledge of the following schema design guide:

---
${SCHEMA_GUIDE}
---

CURRENT SCHEMA:
${JSON.stringify(schema, null, 2)}

Focus your review on:
- Fields missing \`description\` (the most impactful property for AI prompting)
- Fields missing \`x-prompt\` (removes ambiguity for the chat assistant)
- Fields missing \`x-order\` (controls conversational flow)
- Fields missing \`examples\` or \`default\` values where they would help
- Fields that have a small fixed set of values but don't use \`enum\`
- Fields that are clearly conditional but don't use \`if/then/else\` or \`x-depends-on\`
- Required fields missing from the \`required\` array
- Fields with \`format: uuid\` or \`const\` that should be marked \`readOnly\`
- Any \`x-hint\` opportunities (extra guidance alongside a question)

Return a numbered list of specific, actionable suggestions. For each, name the field and say exactly what to add or change. Keep suggestions concise — one to two sentences each.

If the schema is already well-formed and follows the guide closely, say so briefly.

RESPONSE FORMAT (strict):
{"message": "1. ...\n2. ...", "schema": null}

No text outside the JSON object. No markdown fences.`;
}

function buildEditSystemPrompt(schema) {
  return `You are a JSON Schema editing assistant that helps developers design schemas optimised for AI-assisted user prompting.

You have deep knowledge of the following schema design guide, which defines the properties and patterns you should apply and ask about:

---
${SCHEMA_GUIDE}
---

CURRENT SCHEMA:
${JSON.stringify(schema, null, 2)}

BEHAVIOUR:
- When a developer asks to add or modify a field, ask targeted clarifying questions to gather the information needed to apply the guide's concepts well — for example: the intended description, an x-prompt, examples, a default value, or whether the field should be conditional.
- Ask only the most important questions — do not overwhelm. One to three focused questions at a time.
- Once you have enough information, apply the change and return the complete modified schema.
- Proactively suggest relevant properties from the guide (x-prompt, x-order, x-hint, if/then/else, etc.) if the developer hasn't mentioned them and they would clearly improve the schema.
- If the request is straightforward and fully specified, apply it immediately without asking questions.

RESPONSE RULES:
1. Always respond with valid JSON in exactly this format:
   {"message": "Your question or explanation", "schema": { ...complete modified schema... }}
2. If you are asking clarifying questions (not yet ready to apply a change), respond with:
   {"message": "Your questions here", "schema": null}
3. If the user's request requires no schema change (e.g. a question about the schema), respond with:
   {"message": "Your answer here", "schema": null}
4. Always return the COMPLETE schema when making a change — never a partial diff or fragment.
5. Preserve all existing fields, types, and constraints unless the user explicitly asks to change them.
6. When adding a new required field, add it to both "properties" and the "required" array.
7. Maintain valid JSON Schema draft-07 structure.
8. Do not add comments inside the schema JSON itself.

No text outside the JSON object. No markdown fences.`;
}

router.post('/', async (req, res) => {
  const { schema, messages = [], mode } = req.body;

  if (!schema) {
    return res.status(400).json({ error: 'Schema is required' });
  }

  const isHint = mode === 'hint';
  const systemPrompt = isHint ? buildHintSystemPrompt(schema) : buildEditSystemPrompt(schema);

  // Hint mode is always a fresh one-shot analysis — no conversation history needed
  const apiMessages = isHint
    ? [{ role: 'user', content: 'Analyse this schema and give me improvement hints.' }]
    : [
        { role: 'user', content: 'Start' },
        ...messages.map(({ role, content }) => ({ role, content }))
      ];

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: systemPrompt,
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
