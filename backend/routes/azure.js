const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
const express = require('express');
const router = express.Router();

const SCHEMAS_CONTAINER = 'schemas';

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

// List all schema.json files in the schemas container, returned as { blobDir, label } objects
router.get('/schemas', async (req, res) => {
  console.log('[azure] GET /schemas — connecting to Azure...');
  console.log('[azure] Account:', process.env.AZURE_ACCOUNT_NAME);
  console.log('[azure] Key present:', !!process.env.AZURE_ACCOUNT_KEY);
  try {
    const container = getContainerClient();
    console.log('[azure] Container client created, listing blobs...');
    const schemas = [];

    for await (const blob of container.listBlobsFlat()) {
      if (blob.name.endsWith('/schema.json')) {
        const blobDir = blob.name.slice(0, -'/schema.json'.length);
        schemas.push({ blobDir });
      }
    }

    schemas.sort((a, b) => a.blobDir.localeCompare(b.blobDir));
    console.log(`[azure] Done. ${schemas.length} schemas found.`);
    res.json({ schemas, total: schemas.length });
  } catch (err) {
    console.error('[azure] ERROR:', err.message);
    console.error('[azure] Stack:', err.stack);
    res.status(500).json({ error: err.message });
  }
});

// Get a specific schema by its blobDir path (e.g. settings/metadata-fields)
router.get('/schemas/*', async (req, res) => {
  try {
    const blobDir = req.params[0];
    const blobPath = `${blobDir}/schema.json`;
    const container = getContainerClient();
    const blobClient = container.getBlobClient(blobPath);

    const buffer = await blobClient.downloadToBuffer();
    const content = buffer.toString('utf8');
    res.setHeader('Content-Type', 'application/json');
    res.send(content);
  } catch (err) {
    const status = err.statusCode === 404 ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// List archived versions for a schema
router.get('/history/*', async (req, res) => {
  const blobDir = req.params[0];
  const container = getContainerClient();
  const prefix = `${blobDir}/archive/`;
  const archives = [];

  for await (const blob of container.listBlobsFlat({ prefix })) {
    if (blob.name.endsWith('.json')) {
      archives.push({
        path: blob.name,
        name: blob.name.split('/').pop(),
        lastModified: blob.properties.lastModified,
      });
    }
  }

  archives.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
  res.json({ archives, blobDir });
});

// Save an edited schema to Azure — archives the current version first
router.put('/schemas/*', express.json(), async (req, res) => {
  const blobDir = req.params[0];
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON schema object' });
  }

  const container = getContainerClient();
  const currentPath = `${blobDir}/schema.json`;

  // 1. Archive the current schema before overwriting
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = `${blobDir}/archive/schema-${timestamp}.json`;
  const currentBlob = container.getBlobClient(currentPath);
  const archiveBlob = container.getBlockBlobClient(archivePath);
  const buffer = await currentBlob.downloadToBuffer();
  await archiveBlob.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: 'application/json' }
  });

  // 2. Overwrite schema.json with the new content
  const newContent = Buffer.from(JSON.stringify(req.body, null, 2), 'utf8');
  const schemaBlob = container.getBlockBlobClient(currentPath);
  await schemaBlob.upload(newContent, newContent.length, {
    overwrite: true,
    blobHTTPHeaders: { blobContentType: 'application/json' }
  });

  res.json({ archived: archivePath, saved: currentPath });
});

module.exports = router;
