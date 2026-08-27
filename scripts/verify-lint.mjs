#!/usr/bin/env node
// verify-lint.mjs — run the deterministic schema lint against trio directories.
// Usage: node scripts/verify-lint.mjs <trio-dir> [trio-dir...]
// Each dir should hold schema.json (+ optional sample.json, description.md).
// Prints score + findings per trio; exit 1 if any trio has lint errors.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { lintTrio } = require('../backend/lib/schemaLint.js');

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('usage: node scripts/verify-lint.mjs <trio-dir> [trio-dir...]');
  process.exit(2);
}

const ICON = { error: '✗', warning: '⚠', info: 'ℹ' };
let anyErrors = false;

for (const dir of dirs) {
  const schemaPath = join(dir, 'schema.json');
  if (!existsSync(schemaPath)) {
    console.log(`\n${dir}: no schema.json — skipped`);
    continue;
  }
  const read = (f, parse) => {
    const p = join(dir, f);
    if (!existsSync(p)) return undefined;
    const raw = readFileSync(p, 'utf8');
    return parse ? JSON.parse(raw) : raw;
  };

  const { score, counts, findings } = lintTrio({
    schema: read('schema.json', true),
    sample: read('sample.json', true),
    descriptionMd: read('description.md', false)
  });

  if (counts.errors) anyErrors = true;
  console.log(`\n${dir}\n  score ${score}  (${counts.errors}E ${counts.warnings}W ${counts.infos}I)`);
  for (const f of findings) {
    console.log(`  ${ICON[f.severity]} [${f.rule}] ${f.path}: ${f.message}`);
  }
}

process.exit(anyErrors ? 1 : 0);
