const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
const router = express.Router();
const capgpt = require('../services/capgpt');
const { fetchRelatedSkills } = require('../services/tapestry');

const SCHEMAS_CONTAINER = 'schemas';
const CATALOG_BLOB = 'schema-catalog.json';
const BATCH_SIZE = 15;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory cache with 10-minute TTL
let catalogCache = null;
let catalogCacheTime = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

function getContainerClient() {
  const cred = new StorageSharedKeyCredential(
    process.env.AZURE_ACCOUNT_NAME?.trim(),
    process.env.AZURE_ACCOUNT_KEY?.trim()
  );
  const serviceClient = new BlobServiceClient(
    `https://${process.env.AZURE_ACCOUNT_NAME}.blob.core.windows.net`,
    cred
  );
  return serviceClient.getContainerClient(SCHEMAS_CONTAINER);
}

async function loadCatalog(force = false) {
  const now = Date.now();
  if (!force && catalogCache && now - catalogCacheTime < CACHE_TTL_MS) {
    return catalogCache;
  }
  const container = getContainerClient();
  const buffer = await container.getBlobClient(CATALOG_BLOB).downloadToBuffer();
  catalogCache = JSON.parse(buffer.toString('utf8'));
  catalogCacheTime = now;
  return catalogCache;
}

// Enrich a batch of schemas in a single Claude call
async function enrichBatch(batch) {
  const input = batch.map(s => ({
    blobDir: s.blobDir,
    title: s.title,
    description: (s.description ?? '').substring(0, 300),
    fields: s.topLevelProps,
  }));

  const prompt = `Analyze these JSON Schemas. Return a JSON array with exactly ${batch.length} elements (same order as input).

For each schema produce:
- "entity": primary domain entity (e.g. "User", "Activity", "SSO Provider", "Badge")
- "actions": array from [create, read, update, delete, configure, enroll, import, export]
- "keywords": 5-8 short phrases a user might say to find this schema
- "intentExamples": 3 natural-language sentences that should route to this schema

Input:
${JSON.stringify(input)}

Return ONLY a JSON array with ${batch.length} objects. No explanation.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].text.trim();
  const match = raw.match(/\[[\s\S]*\]/);
  return JSON.parse(match ? match[0] : raw);
}

// Enrich a single catalog entry with CapGPT KB context and glossary terms
async function capgptEnrich(entry) {
  const query = [entry.title, entry.entity].filter(Boolean).join(' ');
  const [kbRaw, glossaryRaw] = await Promise.all([
    capgpt.callTool('kb_search', { query, limit: 3 }).catch(() => null),
    capgpt.callTool('glossary_search', { query: entry.entity || entry.title, limit: 5 }).catch(() => null),
  ]);

  // kb_search returns { docs: [{ name, summary, ... }], ... }
  const kbContext = (kbRaw?.docs ?? [])
    .map(d => d.name ? `${d.name}: ${(d.summary ?? '').substring(0, 100)}` : null)
    .filter(Boolean);

  // glossary_search returns { terms: [{ canonicalTerm, synonyms, ... }], ... }
  const glossaryTerms = (glossaryRaw?.terms ?? [])
    .flatMap(t => [t.canonicalTerm, ...(t.synonyms ?? [])].filter(Boolean));

  return { kbContext, glossaryTerms };
}

// GET /api/catalog/status — returns whether the catalog exists and when it was last generated
router.get('/status', async (req, res) => {
  try {
    const container = getContainerClient();
    const props = await container.getBlobClient(CATALOG_BLOB).getProperties();
    res.json({ exists: true, lastGenerated: props.lastModified ?? null });
  } catch (err) {
    if (err.statusCode === 404) return res.json({ exists: false, lastGenerated: null });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/catalog — returns current catalog from Azure (cached)
router.get('/', async (req, res) => {
  try {
    const catalog = await loadCatalog();
    res.json(catalog);
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: 'Catalog not generated yet — POST /api/catalog/generate to create it.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/catalog/generate — builds the enriched catalog and saves to Azure
// Takes ~30-60 seconds for 164 schemas (processed in batches of 15)
router.post('/generate', async (req, res) => {
  try {
  const container = getContainerClient();

  // 1. List all schemas
  const blobDirs = [];
  for await (const blob of container.listBlobsFlat()) {
    if (blob.name.endsWith('/schema.json')) {
      blobDirs.push(blob.name.slice(0, -'/schema.json'.length));
    }
  }
  blobDirs.sort();
  console.log(`[catalog] Found ${blobDirs.length} schemas. Fetching content...`);

  // 2. Fetch schema content for all schemas
  const schemaInputs = [];
  const fetchErrors = [];
  for (const blobDir of blobDirs) {
    try {
      const buffer = await container.getBlobClient(`${blobDir}/schema.json`).downloadToBuffer();
      const schema = JSON.parse(buffer.toString('utf8'));
      schemaInputs.push({
        blobDir,
        title: schema.title ?? blobDir,
        description: schema.description ?? '',
        documentType: schema.documentType ?? null,
        scope: schema.scope ?? null,
        topLevelProps: Object.keys(schema.properties ?? {}).slice(0, 20).join(', '),
      });
    } catch (err) {
      fetchErrors.push({ blobDir, error: err.message });
    }
  }
  console.log(`[catalog] Fetched ${schemaInputs.length} schemas. Enriching in batches of ${BATCH_SIZE}...`);

  // 3. Enrich in batches via Claude
  const enriched = [];
  const enrichErrors = [];
  for (let i = 0; i < schemaInputs.length; i += BATCH_SIZE) {
    const batch = schemaInputs.slice(i, i + BATCH_SIZE);
    console.log(`[catalog] Enriching batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(schemaInputs.length / BATCH_SIZE)}...`);
    try {
      const results = await enrichBatch(batch);
      for (let j = 0; j < batch.length; j++) {
        enriched.push({ input: batch[j], enrichment: results[j] ?? {} });
      }
    } catch (err) {
      enrichErrors.push({ batch: batch.map(s => s.blobDir), error: err.message });
      // Fall back: push entries with empty enrichment so we don't lose the schema
      for (const s of batch) {
        enriched.push({ input: s, enrichment: {} });
      }
    }
  }

  // 4. Build catalog entries
  const catalog = enriched.map(({ input, enrichment }) => ({
    blobDir: input.blobDir,
    title: input.title,
    description: input.description,
    documentType: input.documentType,
    scope: input.scope,
    parentDir: input.blobDir.includes('/') ? input.blobDir.split('/').slice(0, -1).join('/') : null,
    entity: enrichment.entity ?? null,
    actions: enrichment.actions ?? [],
    keywords: enrichment.keywords ?? [],
    intentExamples: enrichment.intentExamples ?? [],
    relatedDirs: [],
  }));

  // 5. Populate relatedDirs by entity overlap and path proximity
  for (const entry of catalog) {
    entry.relatedDirs = catalog
      .filter(other =>
        other.blobDir !== entry.blobDir &&
        (
          (entry.entity && other.entity === entry.entity) ||
          (entry.parentDir && other.parentDir === entry.parentDir)
        )
      )
      .map(other => other.blobDir)
      .slice(0, 6);
  }

  // 5b. Initialise empty CapGPT fields — enrichment runs in the background after response
  for (const entry of catalog) {
    entry.kbContext = [];
    entry.glossaryTerms = [];
  }

  // 6. Save to Azure and respond — CapGPT enrichment runs after this
  const content = Buffer.from(JSON.stringify(catalog, null, 2), 'utf8');
  await container.getBlockBlobClient(CATALOG_BLOB).upload(content, content.length, {
    overwrite: true,
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });

  // Refresh cache
  catalogCache = catalog;
  catalogCacheTime = Date.now();

  const errors = [...fetchErrors, ...enrichErrors];
  console.log(`[catalog] Done. ${catalog.length} entries. ${errors.length} errors.`);
  res.json({ generated: catalog.length, errors });

  } catch (err) {
    console.error('[catalog] Generate failed:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }

  // 5b. CapGPT enrichment — runs detached after response so it doesn't block the HTTP request
  if (process.env.CAPGPT_URL && process.env.CAPGPT_API_KEY && catalogCache) {
    const CAPGPT_BATCH = 5;
    let capgptEnriched = 0;
    let capgptFailed = 0;
    console.log(`[capgpt] Starting background enrichment for ${catalogCache.length} schemas...`);
    // Test connectivity with a single call before running the full loop
    capgpt.callTool('kb_search', { query: 'test', limit: 1 })
      .then(probe => {
        console.log(`[capgpt] Connectivity probe OK. Sample response type: ${typeof probe}, keys: ${probe && typeof probe === 'object' ? Object.keys(probe).join(',') : 'n/a'}`);
      })
      .catch(err => {
        console.error(`[capgpt] Connectivity probe FAILED: ${err.message} — background enrichment will likely fail too`);
      });
    (async () => {
      try {
        for (let i = 0; i < catalogCache.length; i += CAPGPT_BATCH) {
          const batch = catalogCache.slice(i, i + CAPGPT_BATCH);
          const results = await Promise.all(batch.map(entry =>
            capgptEnrich(entry).catch(err => {
              console.error(`[capgpt] enrich failed for "${entry.blobDir}": ${err.message}`);
              return null;
            })
          ));
          for (let j = 0; j < batch.length; j++) {
            batch[j].kbContext = results[j]?.kbContext ?? [];
            batch[j].glossaryTerms = results[j]?.glossaryTerms ?? [];
            if (results[j]) capgptEnriched++; else capgptFailed++;
          }
          if (i === 0) {
            // Log first batch result so we know parsing is working
            console.log(`[capgpt] First batch sample — kbContext: ${JSON.stringify(batch[0].kbContext)}, glossaryTerms: ${JSON.stringify(batch[0].glossaryTerms)}`);
          }
        }
        console.log(`[capgpt] Enrichment complete: ${capgptEnriched} ok, ${capgptFailed} failed. Saving to Azure...`);
        const enrichedContent = Buffer.from(JSON.stringify(catalogCache, null, 2), 'utf8');
        const container = getContainerClient();
        await container.getBlockBlobClient(CATALOG_BLOB).upload(enrichedContent, enrichedContent.length, {
          overwrite: true,
          blobHTTPHeaders: { blobContentType: 'application/json' },
        });
        catalogCacheTime = Date.now();
        console.log('[capgpt] Enriched catalog saved to Azure.');
      } catch (err) {
        console.error('[capgpt] Background enrichment crashed:', err.message);
      }
    })();
  } else {
    console.warn(`[capgpt] Skipping enrichment — CAPGPT_URL set: ${!!process.env.CAPGPT_URL}, CAPGPT_API_KEY set: ${!!process.env.CAPGPT_API_KEY}, catalogCache set: ${!!catalogCache}`);
  }
});

// Score and rank skills by how well their name matches the schema's keywords.
// Name matches score higher than category-only matches.
// Skills with no name matches are filtered out.
function scoreAndRankSkills(skills, keywords) {
  if (skills.length === 0 || keywords.length === 0) return [];

  const scored = skills.map(skill => {
    const name = (skill.name ?? '').toLowerCase();
    const category = (skill.category ?? '').toLowerCase();
    let nameMatches = 0;
    let categoryMatches = 0;

    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (name.includes(kwLower)) nameMatches++;
      else if (category.includes(kwLower)) categoryMatches++;
    }

    // Name hits weighted 2x over category-only hits
    const score = (nameMatches * 2 + categoryMatches) / (keywords.length * 2);
    const confidence = nameMatches >= 2 ? 'high' : nameMatches >= 1 ? 'medium' : 'low';
    return { name: skill.name, category: skill.category, score, confidence };
  });

  return scored
    .filter(s => s.score > 0)            // drop category-only matches
    .sort((a, b) => b.score - a.score);  // best matches first
}

// POST /api/catalog/intent — route a natural-language query to schemas
router.post('/intent', async (req, res) => {
  const { query } = req.body ?? {};
  if (!query) return res.status(400).json({ error: 'query is required' });

  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: 'Catalog not generated yet — POST /api/catalog/generate first.' });
    }
    return res.status(500).json({ error: err.message });
  }

  console.log(`[skill-map] query="${query}" catalog=${catalog.length} entries`);

  // Compact index — only routing-relevant fields
  const index = catalog.map(s => ({
    blobDir: s.blobDir,
    title: s.title,
    entity: s.entity,
    actions: s.actions,
    keywords: s.keywords,
    intentExamples: s.intentExamples,
    kbContext: s.kbContext ?? [],
    glossaryTerms: s.glossaryTerms ?? [],
  }));

  const prompt = `You are a schema router. Given a user's natural-language query, return the most relevant schemas from the catalog.

User query: "${query}"

Catalog (${index.length} schemas):
${JSON.stringify(index)}

Return a JSON object: { "matches": [...] }
Each match: { "blobDir": "...", "title": "...", "confidence": "high"|"medium"|"low", "reason": "one sentence" }
Return up to 5 matches, most relevant first. Return ONLY valid JSON.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    let matches = parsed.matches ?? [];
    console.log(`[skill-map] matches=${matches.length}${matches.length ? ': ' + matches.map(m => `"${m.title}" (${m.confidence})`).join(', ') : ''}`);

    // Fallback: if all matches are low confidence and CapGPT is configured, search KB
    // and surface any catalog entries whose kbContext overlaps with the returned doc titles
    const allLow = matches.length === 0 || matches.every(m => m.confidence === 'low');
    if (allLow && process.env.CAPGPT_URL && process.env.CAPGPT_API_KEY) {
      try {
        const kbRaw = await capgpt.callTool('kb_search', { query, limit: 5 });
        if (kbRaw) {
          const kbDocs = JSON.parse(kbRaw);
          const kbTitles = (Array.isArray(kbDocs) ? kbDocs : kbDocs.results ?? [])
            .map(d => (d.title ?? '').toLowerCase());
          const fallback = catalog
            .filter(s =>
              (s.kbContext ?? []).some(ctx =>
                kbTitles.some(t => ctx.toLowerCase().includes(t) || t.includes(ctx.toLowerCase().split(':')[0]))
              )
            )
            .slice(0, 3)
            .map(s => ({ blobDir: s.blobDir, title: s.title, confidence: 'low', reason: 'Matched via CapGPT KB search fallback' }));
          if (fallback.length > 0) matches = [...matches, ...fallback];
        }
      } catch { /* fallback is best-effort */ }
    }

    const matchesWithSkills = await Promise.all(
      matches.map(async (match) => {
        const entry = catalog.find(e => e.blobDir === match.blobDir);
        const keywords = entry?.keywords ?? [];
        const rawSkills = keywords.length > 0 ? await fetchRelatedSkills(keywords) : [];
        const skills = scoreAndRankSkills(rawSkills, keywords);
        return { ...match, skills };
      })
    );

    res.json({ query, matches: matchesWithSkills });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/catalog/chat — conversational assistant that routes to schemas and responds naturally
// Body: { messages: [{role, content}] }
// Returns: { message, schemas }
router.post('/chat', async (req, res) => {
  const { messages = [], lockedSchemas } = req.body ?? {};

  // Turn 0: no messages yet — return the opening greeting with no LLM call
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) {
    return res.json({ message: 'What would you like to do today?', schemas: [] });
  }

  // Load catalog
  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: 'Catalog not generated yet — POST /api/catalog/generate first.' });
    }
    return res.status(500).json({ error: err.message });
  }

  // --- Step 1: Route the last user message to matching schemas (skipped if schemas already locked) ---
  if (lockedSchemas) {
    // Schemas already identified — skip routing, use provided set
    console.log(`[skill-chat] schemas locked (${lockedSchemas.length}), skipping routing`);
  }

  const query = lastUser.content;
  const index = catalog.map(s => ({
    blobDir: s.blobDir,
    title: s.title,
    entity: s.entity,
    actions: s.actions,
    keywords: s.keywords,
    intentExamples: s.intentExamples,
    kbContext: s.kbContext ?? [],
    glossaryTerms: s.glossaryTerms ?? [],
  }));

  const routingPrompt = `You are a schema router. Given a user's natural-language query, return the most relevant schemas from the catalog.

User query: "${query}"

Catalog (${index.length} schemas):
${JSON.stringify(index)}

Return a JSON object: { "matches": [...] }
Each match: { "blobDir": "...", "title": "...", "confidence": "high"|"medium"|"low", "reason": "one sentence" }
Return up to 5 matches, most relevant first. Return ONLY valid JSON.`;

  let matchesWithSkills = lockedSchemas ?? [];
  if (!lockedSchemas) {
    try {
      const routingRes = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: routingPrompt }],
      });
      const raw = routingRes.content[0].text.trim();
      const objMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(objMatch ? objMatch[0] : raw);
      const matches = parsed.matches ?? [];

      matchesWithSkills = await Promise.all(
        matches.map(async (m) => {
          const entry = catalog.find(e => e.blobDir === m.blobDir);
          const keywords = entry?.keywords ?? [];
          const rawSkills = keywords.length > 0 ? await fetchRelatedSkills(keywords) : [];
          const skills = scoreAndRankSkills(rawSkills, keywords);
          return { ...m, skills };
        })
      );
      console.log(`[skill-chat] query="${query}" → ${matchesWithSkills.length} schema(s)`);
    } catch (err) {
      console.warn('[skill-chat] routing failed, continuing with empty schemas:', err.message);
    }
  }

  // --- Step 2: Generate a conversational reply using history + schema results ---
  const schemasContext = matchesWithSkills.length > 0
    ? `\nSchemas matched for the user's latest message:\n` +
      matchesWithSkills.map(m => `- "${m.title}" (${m.confidence}): ${m.reason}`).join('\n')
    : '\nNo schemas were matched for the user\'s latest message.';

  const systemPrompt = `You are an assistant helping users find the right ThinkingCap LMS configuration schema.
Schemas matching the user's intent have already been identified for you.

Your job: in one plain sentence, name the matched schema and confirm it fits what the user wants. If multiple schemas matched, ask one short clarifying question to identify the best fit.

NEVER say any of these things:
- Exclamations or affirmations: "Perfect!", "Great!", "Excellent!", "Got it!", "Sure!"
- Transition phrases: "Let's get started", "I'll walk you through", "Let's continue", "Step by step"
- Anything about what will happen next or how the process works
- Bullet or numbered lists of any kind
- What fields or information will be collected

WRONG: "Perfect! I have the right schema. Let's get started — I'll walk you through it step by step."
RIGHT: "The Add Single User schema looks like the right fit — click it in the panel to begin."

If no schemas matched, ask a clarifying question to better understand what the user needs.
Never mention technical paths, blobDir values, or raw schema IDs.`;

  // Build conversation history for Claude (strip any UI-only fields, keep role+content)
  const history = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.content }));

  // Append schema context as a system-style note on the last user turn
  const historyWithContext = [
    ...history.slice(0, -1),
    { role: 'user', content: `${lastUser.content}\n\n[System context — not shown to user:${schemasContext}]` },
  ];

  try {
    const chatRes = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages: historyWithContext,
    });
    const message = chatRes.content[0].text.trim();
    res.json({ message, schemas: matchesWithSkills });
  } catch (err) {
    console.error('[skill-chat] conversation generation failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/catalog/schema?blobDir=... — fetch full JSON schema from Azure by blobDir
router.get('/schema', async (req, res) => {
  const { blobDir } = req.query;
  if (!blobDir) return res.status(400).json({ error: 'blobDir is required' });
  try {
    const container = getContainerClient();
    const buffer = await container.getBlobClient(`${blobDir}/schema.json`).downloadToBuffer();
    res.json(JSON.parse(buffer.toString('utf8')));
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: 'Schema not found' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/catalog/skill-detail — fetch KB article(s) for a skill name via CapGPT
router.post('/skill-detail', async (req, res) => {
  const { name } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const raw = await capgpt.callTool('kb_search', { query: name, limit: 2 });
    const docs = (raw?.docs ?? [])
      .map(d => ({ title: d.name ?? null, summary: d.summary ?? null }))
      .filter(d => d.title);
    res.json({ docs });
  } catch (err) {
    console.error('[skill-detail] kb_search failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
