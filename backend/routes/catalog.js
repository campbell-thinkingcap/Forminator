const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
const router = express.Router();

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

  // 6. Save to Azure
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
});

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

  // Compact index — only routing-relevant fields
  const index = catalog.map(s => ({
    blobDir: s.blobDir,
    title: s.title,
    entity: s.entity,
    actions: s.actions,
    keywords: s.keywords,
    intentExamples: s.intentExamples,
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
    res.json({ query, matches: parsed.matches ?? [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
