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

// List all schemas (blobs named schema.json)
router.get('/schemas', async (req, res) => {
  try {
    const container = getContainerClient();
    const schemas = [];

    for await (const blob of container.listBlobsFlat()) {
      if (blob.name.endsWith('/schema.json')) {
        const blobDir = blob.name.slice(0, -'/schema.json'.length);
        schemas.push({ name: blobDir, blobDir, blobPath: blob.name });
      }
    }

    schemas.sort((a, b) => a.blobDir.localeCompare(b.blobDir));
    res.json({ schemas, total: schemas.length });
  } catch (err) {
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

    const download = await blobClient.download();
    const chunks = [];
    for await (const chunk of download.readableStreamBody) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const content = Buffer.concat(chunks).toString('utf8');
    res.setHeader('Content-Type', 'application/json');
    res.send(content);
  } catch (err) {
    const status = err.statusCode === 404 ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
