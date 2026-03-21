const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Schemas directory: ${SCHEMAS_DIR}`);
});
