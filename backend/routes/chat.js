const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
const router = express.Router();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Returns enum metadata for the next unfilled, non-auto-assigned field, or null.
// multiSelect is true when the field type is 'array' (pick many from items.enum).
function getPendingEnumField(schema, currentFormData, fieldUpdates) {
  const required = schema.required ?? [];
  const allKeys = Object.keys(schema.properties ?? {});
  const orderedKeys = [...required, ...allKeys.filter(k => !required.includes(k))];

  const constKeys = orderedKeys.filter(k => 'const' in (schema.properties[k] ?? {}));

  // A value counts as filled only if it is a real, non-empty answer.
  // Boolean false is excluded: it is indistinguishable from an unchecked default,
  // so boolean fields always stay in the prompt queue until the user explicitly
  // picks Yes or No via the radio group.
  const isFilled = (v) => v !== null && v !== undefined && v !== '' && v !== false;

  const effectiveFilled = new Set([
    ...constKeys,
    ...Object.keys(currentFormData || {}).filter(k => isFilled(currentFormData[k])),
    ...Object.keys(fieldUpdates || {}).filter(k => isFilled((fieldUpdates || {})[k]))
  ]);

  for (const key of orderedKeys) {
    const prop = schema.properties[key];
    const isAutoAssigned = prop.format === 'uuid' || 'const' in prop;
    if (isAutoAssigned || effectiveFilled.has(key)) continue;

    if (prop.enum) {
      return { enumOptions: prop.enum, multiSelect: false };
    }
    if (prop.type === 'array' && prop.items?.enum) {
      return { enumOptions: prop.items.enum, multiSelect: true };
    }
    if (prop.type === 'boolean') {
      return { enumOptions: ['Yes', 'No'], multiSelect: false };
    }
    break; // First pending field has no interactive options — stop
  }
  return null;
}

function buildSystemPrompt(schema, currentFormData) {
  // Derive an ordered field list from the schema so the AI has a clear sequence to follow.
  // Required fields come first, then the rest, all skipping uuid/auto-assigned ones.
  const required = schema.required ?? [];
  const allKeys = Object.keys(schema.properties ?? {});
  const orderedKeys = [
    ...required,
    ...allKeys.filter(k => !required.includes(k))
  ];

  const fieldSummary = orderedKeys.map(key => {
    const prop = schema.properties[key];
    const type = Array.isArray(prop.type) ? prop.type.filter(t => t !== 'null').join('|') : prop.type;
    const isRequired = required.includes(key);
    const isUuid = prop.format === 'uuid';
    const isConst = 'const' in prop;
    const enumVals = prop.enum ? `Options: ${prop.enum.join(', ')}` : '';
    const desc = prop.description ? prop.description.split('.')[0] : ''; // first sentence only
    return `- ${key} [${type}${isRequired ? ', REQUIRED' : ''}${isUuid || isConst ? ', AUTO-ASSIGNED' : ''}] ${enumVals} ${desc}`.trim();
  }).join('\n');

  // Const fields are always pre-filled — never ask for them.
  // Boolean false is not counted as filled (indistinguishable from unchecked default).
  const constKeys = orderedKeys.filter(k => 'const' in (schema.properties[k] ?? {}));
  const filled = [
    ...constKeys,
    ...Object.keys(currentFormData || {}).filter(
      k => !constKeys.includes(k) &&
           currentFormData[k] !== null &&
           currentFormData[k] !== undefined &&
           currentFormData[k] !== '' &&
           currentFormData[k] !== false
    )
  ];

  return `You are a guided form assistant. Your job is to collect information from the user by asking precise, specific questions — one at a time — based on the schema below. You are NOT a general chat assistant. Do not ask open-ended questions like "what would you like to do?" or "how can I help?". Every question you ask must target a specific field.

FORM: "${schema.title ?? 'Form'}"
${schema.description ? `Description: ${schema.description.split('.')[0]}.` : ''}

FIELDS TO COLLECT (in this order):
${fieldSummary}

ALREADY FILLED (do not ask about these):
${filled.length ? filled.join(', ') : 'none'}

RULES:
1. Start immediately with the first unfilled, non-AUTO-ASSIGNED field. No preamble. No "What would you like to do?".
2. Name the field you are asking about so the user knows exactly what is needed.
3. For enum fields, always list the valid options explicitly. Only accept one of those options — if the user's answer does not match, tell them and ask again.
4. For boolean fields, present Yes/No explicitly. Only accept Yes or No.
5. For nested objects, introduce the section briefly then ask about each sub-field in turn.
6. Do not repeat questions for already-filled fields.
7. For free-text fields (no enum, not boolean): use the user's answer exactly as given. Do NOT interpret, infer, rephrase, or guess. If the answer is ambiguous or empty, ask the question again clearly — never substitute a value.
8. After recording a value, immediately ask the next unfilled field — no filler commentary.
9. When every non-AUTO-ASSIGNED field has a value, say "All done — the form is complete." and stop.
10. NEVER assume or invent a value for any field. If you do not have a clear, explicit answer from the user, ask again.

CRITICAL: Respond with valid JSON only, no text outside it:
{"message": "Your question or response here", "fieldUpdates": {}}

"fieldUpdates" contains only the field(s) the user just answered (empty {} if none yet).
For nested fields: {"defaultLocation": {"room": "Conference A"}}`;
}

router.post('/', async (req, res) => {
  const { schema, messages = [], currentFormData = {} } = req.body;

  if (!schema) {
    return res.status(400).json({ error: 'Schema is required' });
  }

  // Anthropic requires conversation to start with a user message.
  // We prepend a hidden "Start" message that is never shown in the UI.
  // Strip any UI-only metadata (enumOptions, multiSelect) — Anthropic only accepts role + content.
  const apiMessages = [
    { role: 'user', content: 'Start' },
    ...messages.map(({ role, content }) => ({ role, content }))
  ];

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: buildSystemPrompt(schema, currentFormData),
      messages: apiMessages
    });

    const rawText = response.content[0].text.trim();

    // Parse JSON — handle optional markdown code fences
    let parsed;
    try {
      const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      parsed = JSON.parse(fenceMatch ? fenceMatch[1].trim() : rawText);
    } catch {
      // Last resort: pull out the first {...} block
      const objMatch = rawText.match(/\{[\s\S]*\}/);
      try {
        parsed = objMatch ? JSON.parse(objMatch[0]) : null;
      } catch {
        parsed = null;
      }
    }

    const fieldUpdates = parsed?.fieldUpdates ?? {};
    const enumField = getPendingEnumField(schema, currentFormData, fieldUpdates);
    res.json({
      message: parsed?.message ?? rawText,
      fieldUpdates,
      ...(enumField ?? {})
    });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Failed to get AI response', details: err.message });
  }
});

module.exports = router;
