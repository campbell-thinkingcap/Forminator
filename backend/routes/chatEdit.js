const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const { lintTrio } = require('../lib/schemaLint');

// Load the AI schema design guide + the normative authoring standard once at startup.
// The standard (docs/SCHEMA-AUTHORING-STANDARD.md) is canonical; the concept doc is the intro.
const SCHEMA_GUIDE = fs.readFileSync(
  path.join(__dirname, '../../schema_ai_concept.md'),
  'utf8'
);
const AUTHORING_STANDARD = fs.readFileSync(
  path.join(__dirname, '../../docs/SCHEMA-AUTHORING-STANDARD.md'),
  'utf8'
);

function buildHintSystemPrompt(schema) {
  return `You are a JSON Schema quality reviewer. Examine the schema below and identify concrete improvements based on the guide and the normative authoring standard.

You have deep knowledge of the following schema design guide:

---
${SCHEMA_GUIDE}
---

And the normative authoring standard (canonical — where they differ, the standard wins):

---
${AUTHORING_STANDARD}
---

CURRENT SCHEMA:
${JSON.stringify(schema, null, 2)}

Focus your review on:
- Fields missing \`description\` (the most impactful property for AI prompting)
- Fields missing \`x-prompt\` (removes ambiguity for the chat assistant)
- Fields missing \`x-order\` (controls conversational flow; remember: all-or-nothing per sibling level)
- Fields missing \`examples\` or \`default\` values where they would help
- Fields that have a small fixed set of values but don't use \`enum\`
- Enum / array / boolean fields that would benefit from an explicit \`x-widget\` (radio | dropdown | checkbox | yesno)
- Auto-assigned fields (\`const\`, \`format: uuid\`, \`readOnly\`) missing \`x-source\`
- Fields that are clearly conditional but don't use \`if/then/else\` or \`x-depends-on\`
- Required fields missing from the \`required\` array
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

And the normative authoring standard (canonical — where they differ, the standard wins). Apply its x- vocabulary (including x-widget), runtime precedence rules, and lint checklist:

---
${AUTHORING_STANDARD}
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
7. Maintain valid JSON Schema 2020-12 structure — declare "$schema": "https://json-schema.org/draft/2020-12/schema" when creating or rewriting a schema.
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

    const rawText = (response.content.find(b => b.type === 'text')?.text ?? '').trim() /* content may lead with non-text blocks (e.g. thinking) — take the text block */;

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

// ─── POST /api/schema/lint (mounted in server.js) ────────────────────────────
// Deterministic checks from the authoring standard §6 — no LLM by default.
// Body: {schema, sample?, descriptionMd?, narrative?} → {score, counts, findings[], narrative?}

async function lintHandler(req, res) {
  const { schema, sample, descriptionMd, narrative = false } = req.body ?? {};

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return res.status(400).json({ error: 'schema (JSON object) is required' });
  }

  let result;
  try {
    result = lintTrio({ schema, sample, descriptionMd });
  } catch (err) {
    // Belt-and-braces: a lint crash must never take down the backend (Express 4
    // does not catch async handler rejections).
    console.error('Lint error:', err.message);
    return res.status(500).json({ error: 'Lint failed', details: err.message });
  }

  if (narrative) {
    result.narrative = await lintNarrative(schema, result);
  }

  res.json(result);
}

// Optional Haiku prose pass over the deterministic findings. Never blocks the
// lint result — on failure the field is simply absent.
async function lintNarrative(schema, { score, counts, findings }) {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: 'You summarize deterministic schema-lint findings for the schema author. Be concrete and brief (under 150 words): what is most worth fixing first and why. Plain prose, no markdown.',
      messages: [{
        role: 'user',
        content: `Schema: ${schema.title ?? '(untitled)'}\nScore: ${score} (${counts.errors} errors, ${counts.warnings} warnings, ${counts.infos} infos)\nFindings:\n${JSON.stringify(findings, null, 2)}`
      }]
    });
    return (response.content.find(b => b.type === 'text')?.text ?? '').trim() /* content may lead with non-text blocks (e.g. thinking) — take the text block */;
  } catch (err) {
    console.error('Lint narrative error:', err.message);
    return undefined;
  }
}

module.exports = router;
module.exports.lintHandler = lintHandler;
