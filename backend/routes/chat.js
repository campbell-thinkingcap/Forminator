const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
const router = express.Router();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(schema, currentFormData) {
  return `You are a friendly AI assistant helping a user fill out a structured form.

The form is defined by this JSON Schema:
${JSON.stringify(schema, null, 2)}

Current form data (already filled by the user — do not ask about these again):
${JSON.stringify(currentFormData || {}, null, 2)}

Instructions:
- When the conversation starts, greet the user briefly and ask the first unfilled question
- Ask ONE question at a time
- For enum fields, clearly list the valid options (e.g. "Room or Virtual?")
- For boolean fields, ask a simple yes/no question
- For nested objects (like "defaultLocation"), work through their sub-fields in a natural sequence
- Skip fields with format "uuid" — they are auto-assigned
- Skip fields that already have a value in the current form data above
- When the user provides a value, extract it and include it in fieldUpdates
- For nested field updates use the full nested object: {"defaultLocation": {"room": "Conference A"}}
- When all fields are collected, congratulate the user warmly and confirm the form is complete
- Keep your messages concise and conversational

CRITICAL RULE: You MUST respond with valid JSON only, in exactly this format:
{"message": "Your conversational response here", "fieldUpdates": {}}

- "message": your response/question to the user
- "fieldUpdates": only fields the user provided in their most recent message (empty object {} if none)
- Never include any text outside the JSON object`;
}

router.post('/', async (req, res) => {
  const { schema, messages = [], currentFormData = {} } = req.body;

  if (!schema) {
    return res.status(400).json({ error: 'Schema is required' });
  }

  // Anthropic requires conversation to start with a user message.
  // We prepend a hidden "Start" message that is never shown in the UI.
  const apiMessages = [
    { role: 'user', content: 'Start' },
    ...messages
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

    res.json({
      message: parsed?.message ?? rawText,
      fieldUpdates: parsed?.fieldUpdates ?? {}
    });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Failed to get AI response', details: err.message });
  }
});

module.exports = router;
