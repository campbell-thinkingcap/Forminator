const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
const express = require('express');
const router = express.Router();

const SCHEMAS_CONTAINER = 'schemas';

function getContainerClient() {
  const cred = new StorageSharedKeyCredential(
    process.env.AZURE_ACCOUNT_NAME,
    process.env.AZURE_ACCOUNT_KEY
  );
  const serviceClient = new BlobServiceClient(
    `https://${process.env.AZURE_ACCOUNT_NAME}.blob.core.windows.net`,
    cred
  );
  return serviceClient.getContainerClient(SCHEMAS_CONTAINER);
}

// List all .json files in the schemas container
router.get('/schemas', async (req, res) => {
  console.log('[azure] GET /schemas — connecting to Azure...');
  console.log('[azure] Account:', process.env.AZURE_ACCOUNT_NAME);
  console.log('[azure] Key present:', !!process.env.AZURE_ACCOUNT_KEY);
  try {
    const container = getContainerClient();
    console.log('[azure] Container client created, listing blobs...');
    const files = [];

    for await (const blob of container.listBlobsFlat()) {
      console.log('[azure] blob:', blob.name);
      if (blob.name.endsWith('.json')) {
        files.push(blob.name);
      }
    }

    console.log(`[azure] Done. ${files.length} JSON files found.`);
    files.sort();
    res.json({ files, total: files.length });
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

module.exports = router;
