const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const dataRouter = require('./routes/data');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/data', dataRouter);

const SCHEMAS_DIR = path.join(__dirname, '../schemas');

// Endpoint to list all schemas
app.get('/api/schemas', (req, res) => {
  fs.readdir(SCHEMAS_DIR, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read schemas directory' });
    }
    const schemas = files
      .filter(file => file.endsWith('.json'))
      .map(file => ({
        name: file.replace('.json', ''),
        filename: file
      }));
    res.json(schemas);
  });
});

// Endpoint to get a specific schema
app.get('/api/schemas/:name', (req, res) => {
  const schemaName = req.params.name;
  const filePath = path.join(SCHEMAS_DIR, `${schemaName}.json`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Schema not found' });
  }

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read schema file' });
    }
    try {
      const schema = JSON.parse(data);
      res.json(schema);
    } catch (parseErr) {
      res.status(500).json({ error: 'Failed to parse schema JSON' });
    }
  });
});

// Proxy to TCOV schema registry — forwards Authorization header from client
app.get('/api/tcov/schemas', (req, res) => {
  const tcovBase = process.env.TCOV_API_BASE || 'https://tcov.thinkingcap.com/api';
  const reqOptions = { headers: {} };
  if (req.headers['authorization']) {
    reqOptions.headers['Authorization'] = req.headers['authorization'];
  }

  https.get(`${tcovBase}/schemas`, reqOptions, (tcovRes) => {
    res.status(tcovRes.statusCode);
    res.setHeader('Content-Type', 'application/json');
    tcovRes.pipe(res);
  }).on('error', (err) => {
    res.status(502).json({ error: `Upstream error: ${err.message}` });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Schemas directory: ${SCHEMAS_DIR}`);
});
