const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const router = express.Router();

const SCHEMAS_DIR = path.join(__dirname, '../../schemas');
const DATA_DIR = path.join(__dirname, '../data');

// AJV instance — unknown keywords are silently ignored (schemas have custom
// extensions like documentType/scope that aren't part of JSON Schema)
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// ─── helpers ─────────────────────────────────────────────────────────────────

function schemaPath(name) {
  return path.join(SCHEMAS_DIR, `${name}.json`);
}

function dataPath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function schemaExists(name) {
  return fs.existsSync(schemaPath(name));
}

function loadSchema(name) {
  const raw = fs.readFileSync(schemaPath(name), 'utf8');
  return JSON.parse(raw);
}

function readRecords(name) {
  const file = dataPath(name);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeRecords(name, records) {
  fs.writeFileSync(dataPath(name), JSON.stringify(records, null, 2));
}

function getValidator(schema) {
  // Strip $id and $schema — avoids AJV caching collisions and meta-schema ref errors
  const { $id, $schema, ...schemaCopy } = schema;
  return ajv.compile(schemaCopy);
}

function validate(schema, data) {
  const validator = getValidator(schema);
  const valid = validator(data);
  return { valid, errors: validator.errors || [] };
}

// ─── middleware — check schema exists ────────────────────────────────────────

router.param('schema', (req, res, next, name) => {
  // Prevent directory traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid schema name' });
  }
  if (!schemaExists(name)) {
    return res.status(404).json({ error: `Schema '${name}' not found` });
  }
  req.schemaName = name;
  next();
});

// ─── routes ──────────────────────────────────────────────────────────────────

// GET /api/data — list all schemas with record counts
router.get('/', (req, res) => {
  const files = fs.readdirSync(SCHEMAS_DIR).filter(f => f.endsWith('.json'));
  const result = files.map(file => {
    const name = file.replace('.json', '');
    const records = readRecords(name);
    const schema = loadSchema(name);
    return {
      schema: name,
      title: schema.title || name,
      count: records.length,
    };
  });
  res.json(result);
});

// GET /api/data/:schema — list all records
router.get('/:schema', (req, res) => {
  const records = readRecords(req.schemaName);
  res.json(records);
});

// POST /api/data/:schema — create a record
router.post('/:schema', (req, res) => {
  const schema = loadSchema(req.schemaName);
  const body = req.body;

  const { valid, errors } = validate(schema, body);
  if (!valid) {
    return res.status(422).json({ error: 'Validation failed', details: errors });
  }

  const record = { _id: crypto.randomUUID(), ...body };
  const records = readRecords(req.schemaName);
  records.push(record);
  writeRecords(req.schemaName, records);

  res.status(201).json(record);
});

// GET /api/data/:schema/:id — get one record
router.get('/:schema/:id', (req, res) => {
  const records = readRecords(req.schemaName);
  const record = records.find(r => r._id === req.params.id);
  if (!record) return res.status(404).json({ error: 'Record not found' });
  res.json(record);
});

// PUT /api/data/:schema/:id — full replace
router.put('/:schema/:id', (req, res) => {
  const schema = loadSchema(req.schemaName);
  const body = req.body;

  const { valid, errors } = validate(schema, body);
  if (!valid) {
    return res.status(422).json({ error: 'Validation failed', details: errors });
  }

  const records = readRecords(req.schemaName);
  const idx = records.findIndex(r => r._id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Record not found' });

  const updated = { _id: req.params.id, ...body };
  records[idx] = updated;
  writeRecords(req.schemaName, records);

  res.json(updated);
});

// PATCH /api/data/:schema/:id — partial update (no schema validation — partial docs aren't valid)
router.patch('/:schema/:id', (req, res) => {
  const records = readRecords(req.schemaName);
  const idx = records.findIndex(r => r._id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Record not found' });

  const updated = { ...records[idx], ...req.body, _id: req.params.id };
  records[idx] = updated;
  writeRecords(req.schemaName, records);

  res.json(updated);
});

// DELETE /api/data/:schema/:id — delete a record
router.delete('/:schema/:id', (req, res) => {
  const records = readRecords(req.schemaName);
  const idx = records.findIndex(r => r._id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Record not found' });

  records.splice(idx, 1);
  writeRecords(req.schemaName, records);

  res.status(204).send();
});

module.exports = router;
