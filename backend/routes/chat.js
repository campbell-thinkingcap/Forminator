const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
const { buildFieldPlan, isNonEmpty } = require('../lib/fieldPlan');
const router = express.Router();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Chip payload for the next unfilled field, or null when that field has no
// interactive options. All inclusion/ordering/conditional logic lives in
// buildFieldPlan (docs/SCHEMA-AUTHORING-STANDARD.md §5) — this just reads the plan.
function getPendingChoiceField(schema, mergedData, answeredSet) {
  const next = buildFieldPlan(schema, mergedData, answeredSet).find(f => !f.filled);
  if (!next || !next.enumOptions) return null;
  return { field: next.key, enumOptions: next.enumOptions, multiSelect: next.multiSelect, widget: next.widget };
}

function buildSystemPrompt(schema, currentFormData, answeredSet) {
  // The ask-plan implements the standard's precedence rules: x-source/auto-assigned
  // fields are already excluded, x-order is honored, conditionals are evaluated
  // against the data collected so far.
  const plan = buildFieldPlan(schema, currentFormData, answeredSet);

  const fieldSummary = plan.map(f => {
    const bits = [f.type];
    if (f.required) bits.push('REQUIRED');
    let line = `- ${f.key} [${bits.join(', ')}]`;
    if (f.prompt) line += ` ASK: "${f.prompt}"`;
    if (f.enumOptions) line += ` Options: shown to the user as ${f.multiSelect ? 'checkboxes' : f.widget === 'yesno' ? 'Yes/No buttons' : 'clickable chips'} — do NOT list them in your message`;
    if (f.hint) line += ` Hint: ${f.hint}`;
    return line;
  }).join('\n');

  const filled = plan.filter(f => f.filled).map(f => f.key);

  return `You are a guided form assistant. You collect one field at a time by asking a single, simple question. You are NOT a general chat assistant.

FORM: "${schema.title ?? 'Form'}"
${schema.description ? `Description: ${schema.description.split('.')[0]}.` : ''}

FIELDS TO COLLECT (in this order):
${fieldSummary}

ALREADY FILLED (do not ask about these):
${filled.length ? filled.join(', ') : 'none'}

ABSOLUTE RULE — ONE FIELD PER MESSAGE:
Each of your messages may ask about ONE field only. One question, one field, full stop.
WRONG: "What is the user's full name and email address?"
WRONG: "Please provide the first name, last name, and role."
WRONG: "1. Email – what's their email? 2. Name – what's their name? 3. Role – what role?"
WRONG: Any numbered list, bullet list, or enumeration of fields.
RIGHT: "What is the user's first name?"
RIGHT: "What is their email address?"
Never combine fields. Never list multiple questions. Never preview upcoming fields. Ask one thing, wait for the answer, then ask the next.

RULES:
1. Start immediately with the first field in FIELDS TO COLLECT that is not ALREADY FILLED. No preamble. No "What would you like to do?". NEVER ask "would you like me to walk you through…" — just ask the first field directly.
2. Ask for exactly one field per message. After the user answers, ask the next field. One at a time, every time.
3. When a field shows ASK: "…", ask that question verbatim. Otherwise name the field you are asking about so the user knows exactly what is needed.
4. Fields not listed above (auto-assigned, pre-existing, or conditionally skipped) are never asked about.
5. Only accept one of a choice field's valid options — if the user's answer does not match, tell them and ask again. The options are rendered as chips/buttons, so never re-list them in prose.
6. For nested objects, ask about each sub-field in its own separate message — one sub-field at a time.
7. Do not repeat questions for already-filled fields.
8. For free-text fields (no enum, not boolean): use the user's answer exactly as given. Do NOT interpret, infer, rephrase, or guess. If the answer is ambiguous or empty, ask the question again clearly — never substitute a value.
9. After recording a value, immediately ask the next unfilled field. NO filler commentary between fields. NEVER say things like "Got it!", "Great!", "Thanks!", "Perfect!", "Let's continue…", or repeat the value back to the user. Record it silently and ask the next question.
10. When every field in FIELDS TO COLLECT is ALREADY FILLED, say "All done — the form is complete." and stop.
11. NEVER assume or invent a value for any field. If you do not have a clear, explicit answer from the user, ask again.
12. If a field has a Hint, include it naturally in your question to give the user useful context.

CRITICAL: Respond with valid JSON only, no text outside it:
{"message": "Your question or response here", "fieldUpdates": {}}

"fieldUpdates" contains only the field(s) the user just answered (empty {} if none yet).
For nested fields: {"defaultLocation": {"room": "Conference A"}}`;
}

router.post('/', async (req, res) => {
  const { schema, messages = [], currentFormData = {}, answered = [], choiceAnswer } = req.body;

  if (!schema) {
    return res.status(400).json({ error: 'Schema is required' });
  }

  // Answered-set (§5.6): keys the user explicitly confirmed (chip clicks), sent by
  // the client. A chip click also carries choiceAnswer {field, value} so the value
  // is recorded deterministically instead of relying on the model to parse it.
  const answeredSet = new Set(Array.isArray(answered) ? answered.filter(k => typeof k === 'string') : []);
  let forcedUpdates = {};
  const props = schema.properties ?? {};
  if (
    choiceAnswer && typeof choiceAnswer === 'object' && !Array.isArray(choiceAnswer) &&
    typeof choiceAnswer.field === 'string' &&
    Object.hasOwn(props, choiceAnswer.field) && props[choiceAnswer.field]
  ) {
    // Only values the chip UI could actually produce — anything else is a
    // hand-crafted request trying to steer conditional fields.
    const prop = props[choiceAnswer.field];
    const v = choiceAnswer.value;
    const validValue =
      (Array.isArray(prop.enum) && prop.enum.includes(v)) ||
      (prop.type === 'boolean' && typeof v === 'boolean') ||
      (prop.type === 'array' && Array.isArray(prop.items?.enum) &&
        Array.isArray(v) && v.every(x => prop.items.enum.includes(x)));
    if (!validValue) {
      return res.status(400).json({ error: `choiceAnswer.value is not valid for field "${choiceAnswer.field}"` });
    }
    answeredSet.add(choiceAnswer.field);
    forcedUpdates = { [choiceAnswer.field]: v };
  }

  // Anthropic requires conversation to start with a user message.
  // We prepend a hidden "Start" message that is never shown in the UI.
  // Strip any UI-only metadata (field, enumOptions, multiSelect, widget) — Anthropic only accepts role + content.
  const apiMessages = [
    { role: 'user', content: 'Ask me the first field.' },
    ...messages.map(({ role, content }) => ({ role, content }))
  ];

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: buildSystemPrompt(schema, currentFormData, answeredSet),
      messages: apiMessages
    });

    // Content may lead with non-text blocks (e.g. thinking) — take the text block.
    const rawText = (response.content.find(b => b.type === 'text')?.text ?? '').trim();

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

    // choiceAnswer wins over the model's own fieldUpdates for the same key.
    const fieldUpdates = { ...(parsed?.fieldUpdates ?? {}), ...forcedUpdates };
    for (const k of Object.keys(fieldUpdates)) {
      if (isNonEmpty(fieldUpdates[k]) || typeof fieldUpdates[k] === 'boolean') answeredSet.add(k);
    }
    const mergedData = { ...currentFormData, ...fieldUpdates };
    const choiceField = getPendingChoiceField(schema, mergedData, answeredSet);
    res.json({
      message: parsed?.message ?? rawText,
      fieldUpdates,
      ...(choiceField ?? {})
    });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Failed to get AI response', details: err.message });
  }
});

module.exports = router;
