// Deterministic lint for the Schema Authoring Standard (docs/SCHEMA-AUTHORING-STANDARD.md §6).
// No LLM — same trio in, same {score, findings} out. The optional narrative pass
// lives in routes/chatEdit.js, layered on top of this result.

const Ajv = require('ajv');
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats');

const VALID_SOURCES = new Set(['user', 'app', 'db', 'system']);
const NON_USER_SOURCES = new Set(['app', 'db', 'system']);
const VALID_WIDGETS = new Set(['radio', 'dropdown', 'checkbox', 'yesno']);
const VALID_OPTIONS_SOURCES = new Set(['static', 'db', 'app']);
// Keys too generic to phrase a question from — see standard §6 check 8.
const GENERIC_KEYS = new Set([
  'type', 'name', 'value', 'data', 'mode', 'kind', 'status',
  'settings', 'options', 'config', 'text', 'other'
]);

const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

function makeAjv(schemaUri) {
  const ajv = schemaUri && schemaUri.includes('2020-12')
    ? new Ajv2020({ allErrors: true, strict: false })
    : new Ajv({ allErrors: true, strict: false }); // Ajv 8 default mode = draft-07
  addFormats(ajv);
  return ajv;
}

// "tripType=round-trip" | "hasPet" | {field, equals|in|truthy} → {field, op, value} | null
function parseDependsOn(raw) {
  if (raw && typeof raw === 'object' && typeof raw.field === 'string') {
    if ('equals' in raw) return { field: raw.field, op: 'equals', value: raw.equals, form: 'object' };
    if ('in' in raw) return { field: raw.field, op: 'in', value: raw.in, form: 'object' };
    if ('truthy' in raw) return { field: raw.field, op: 'truthy', value: raw.truthy, form: 'object' };
    return null;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const eq = raw.indexOf('=');
    if (eq === -1) return { field: raw.trim(), op: 'truthy', value: true, form: 'string' };
    return { field: raw.slice(0, eq).trim(), op: 'equals', value: raw.slice(eq + 1).trim(), form: 'string' };
  }
  return null;
}

function lintTrio({ schema, sample, descriptionMd } = {}) {
  const findings = [];
  const add = (rule, severity, path, message) =>
    findings.push({ rule, severity, path, message });

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    add('schema-shape', 'error', '(root)', 'schema must be a JSON object');
    return finalize(findings);
  }

  // ── root-level checks ──────────────────────────────────────────────────────

  // Check 14 — single declared draft, 2020-12 mandated
  const declared = schema.$schema;
  if (!declared) {
    add('draft', 'warning', '(root)', `No $schema declared — declare "${DRAFT_2020_12}"`);
  } else if (typeof declared === 'string' && declared.includes('2020-12')) {
    // ok
  } else if (typeof declared === 'string' && declared.includes('draft-07')) {
    add('draft', 'warning', '(root)', 'Declares draft-07 — tolerated at runtime via fallback, but redeclare 2020-12 when touching this file');
  } else {
    add('draft', 'warning', '(root)', `Unrecognized $schema "${declared}" — expected "${DRAFT_2020_12}"`);
  }

  // Check 3 — root description states what is collected
  if (!schema.description || typeof schema.description !== 'string') {
    add('root-description', 'warning', '(root)', 'Root description missing — its first sentence must state what this document collects');
  } else if (schema.description.trim().length < 60) {
    add('root-description', 'warning', '(root)', 'Root description too thin — its first sentence must state what this document collects');
  }

  // ── per-level property checks (recursive, depth-capped) ────────────────────

  walkLevel(schema, '(root)', add);

  // ── trio checks ────────────────────────────────────────────────────────────

  // Check 12 — trio completeness
  if (typeof sample === 'undefined') {
    add('trio', 'info', '(root)', 'sample.json not provided — trio incomplete or unverified');
  }
  if (typeof descriptionMd === 'undefined') {
    add('trio', 'info', '(root)', 'description.md not provided — trio incomplete or unverified');
  } else if (typeof descriptionMd === 'string' && descriptionMd.trim().length < 100) {
    add('trio', 'warning', '(root)', 'description.md too thin — it should explain what is collected, where it is administered, and where it is stored');
  }

  // Check 13 — sample validates
  // Note: schema-supplied regexes (pattern/patternProperties) run raw under Ajv —
  // a catastrophic-backtracking pattern could stall the event loop. Accepted risk
  // for a local dev tool; revisit if this endpoint is ever exposed beyond it.
  // documentType: "collection" has two sample shapes in the corpus: a bare
  // array of documents (metadata-fields — validate element-wise, findings carry
  // the element index) and a wrapper object holding the array (branch-reports —
  // whole-sample validation descends into the array on its own).
  if (typeof sample !== 'undefined') {
    try {
      const ajv = makeAjv(declared);
      const { $id, $schema, ...schemaCopy } = schema; // avoid caching collisions / meta refs
      const validate = ajv.compile(schemaCopy);
      const elementWise = schema.documentType === 'collection' && Array.isArray(sample);
      const docs = elementWise ? sample : [sample];
      const errors = [];
      let total = 0;
      for (let i = 0; i < docs.length; i++) {
        if (!validate(docs[i])) {
          // validate.errors is per-call mutable — copy out immediately
          for (const e of validate.errors || []) {
            total++;
            if (errors.length < 3) { // count everything, keep little
              errors.push(`${elementWise ? `/${i}` : ''}${e.instancePath || '/'} ${e.message}`);
            }
          }
        }
      }
      if (total) {
        add('sample-validates', 'error', '(root)',
          `sample.json fails validation (${total} error(s)): ${errors.join('; ')}`);
      }
    } catch (err) {
      add('sample-validates', 'error', '(root)', `schema fails to compile: ${err.message}`);
    }
  }

  return finalize(findings);
}

// Hard ceiling on nesting depth — a pathologically deep schema must not overflow
// the call stack (dev tool; real trios nest a handful of levels).
const MAX_DEPTH = 64;

function walkLevel(node, path, add, depth = 0) {
  if (depth > MAX_DEPTH) {
    add('depth', 'warning', path, `Nesting deeper than ${MAX_DEPTH} levels — lint stops descending here`);
    return;
  }
  const properties = node.properties;
  if (!properties || typeof properties !== 'object') return;
  const keys = Object.keys(properties);
  const levelRequired = Array.isArray(node.required) ? node.required : [];

  // Check 7 — x-order all-or-nothing per sibling level
  const withOrder = keys.filter(k => 'x-order' in (properties[k] ?? {}));
  if (withOrder.length > 0 && withOrder.length < keys.length) {
    const missing = keys.filter(k => !withOrder.includes(k));
    add('x-order', 'warning', path,
      `x-order is all-or-nothing per level — ${withOrder.length}/${keys.length} fields have it; missing: ${missing.join(', ')}`);
  }

  // Check 9 — x-depends-on targets exist + acyclic (graph for this level)
  const deps = {};
  for (const key of keys) {
    const prop = properties[key] ?? {};
    if (!('x-depends-on' in prop)) continue;
    const dep = parseDependsOn(prop['x-depends-on']);
    if (!dep) {
      add('x-depends-on', 'error', join(path, key),
        'x-depends-on must be {field, equals|in|truthy} or the string shorthand "field=value"');
      continue;
    }
    if (dep.form === 'string') {
      add('x-depends-on', 'info', join(path, key),
        'String shorthand is accepted — migrate to the object form {field, equals|in|truthy}');
    }
    if (!keys.includes(dep.field)) {
      add('x-depends-on', 'error', join(path, key),
        `x-depends-on target "${dep.field}" does not exist among sibling fields`);
    } else {
      deps[key] = dep.field;
    }
  }
  for (const cycle of findCycles(deps)) {
    add('x-depends-on', 'error', path, `x-depends-on cycle: ${cycle.join(' → ')}`);
  }

  for (const key of keys) {
    const prop = properties[key] ?? {};
    const p = join(path, key);

    // Check 1 — description present
    if (!prop.description || typeof prop.description !== 'string') {
      add('description', 'warning', p, 'Field has no description — the most impactful property for AI prompting');
    }

    // Check 2 — string enum values explained in description
    for (const enumValues of [prop.enum, prop.items?.enum]) {
      if (!Array.isArray(enumValues) || enumValues.length === 0 || enumValues.length > 10) continue;
      const strings = enumValues.filter(v => typeof v === 'string');
      if (!strings.length || !prop.description) continue;
      const desc = prop.description.toLowerCase();
      const missing = strings.filter(v => !desc.includes(String(v).toLowerCase()));
      if (missing.length) {
        add('enum-semantics', 'warning', p,
          `Enum value semantics not explained in description: ${missing.join(', ')}`);
      }
    }

    // Check 4 — x-source valid value
    const source = prop['x-source'];
    if (typeof source !== 'undefined' && !VALID_SOURCES.has(source)) {
      add('x-source', 'error', p, `Invalid x-source "${source}" — expected user|app|db|system`);
    }

    // Check 5 — auto-assigned shapes declare x-source
    const autoAssigned = 'const' in prop || prop.format === 'uuid' || prop.readOnly === true;
    if (autoAssigned && typeof source === 'undefined') {
      add('x-source', 'warning', p,
        'Auto-assigned field (const/uuid/readOnly) should declare x-source: app|db|system');
    }

    // Check 6 — required but never asked
    if (levelRequired.includes(key) && NON_USER_SOURCES.has(source)) {
      add('x-source', 'warning', p,
        `Required field has x-source: ${source} — chat never asks it, so user input alone can never validate`);
    }

    // Check 7 — x-order numeric
    if ('x-order' in prop && typeof prop['x-order'] !== 'number') {
      add('x-order', 'error', p, 'x-order must be a number');
    }

    // Check 8 — x-prompt on generic keys
    if (GENERIC_KEYS.has(key) && !prop['x-prompt']) {
      add('x-prompt', 'info', p, `Generic key "${key}" — add an x-prompt so the question is unambiguous`);
    }

    // Check 10 — x-widget sanity
    const widget = prop['x-widget'];
    if (typeof widget !== 'undefined') {
      if (!VALID_WIDGETS.has(widget)) {
        add('x-widget', 'error', p, `Invalid x-widget "${widget}" — expected radio|dropdown|checkbox|yesno`);
      } else if (widget === 'checkbox') {
        if (prop.type !== 'array') {
          add('x-widget', 'error', p, 'x-widget: checkbox requires type "array"');
        } else if (!prop.items?.enum) {
          add('x-widget', 'error', p, 'x-widget: checkbox requires items.enum to pick from');
        }
      } else if (widget === 'yesno') {
        if (prop.type !== 'boolean') {
          add('x-widget', 'error', p, 'x-widget: yesno is only valid on boolean fields');
        }
      } else { // radio | dropdown
        const optionsSource = prop['x-options-source'];
        const hasDynamicOptions = optionsSource === 'db' || optionsSource === 'app';
        if (prop.type === 'array') {
          add('x-widget', 'error', p, `x-widget: ${widget} on an array — use checkbox for multi-select`);
        } else if (!prop.enum && !hasDynamicOptions) {
          add('x-widget', 'error', p, `x-widget: ${widget} needs an enum or x-options-source: db|app`);
        }
        if (widget === 'radio' && Array.isArray(prop.enum) && prop.enum.length > 5) {
          add('x-widget', 'warning', p,
            `radio with ${prop.enum.length} options — default for >5 is dropdown`);
        }
      }
    }

    // Check 11 — x-options-source rules
    const optionsSource = prop['x-options-source'];
    if (typeof optionsSource !== 'undefined') {
      if (!VALID_OPTIONS_SOURCES.has(optionsSource)) {
        add('x-options-source', 'error', p,
          `Invalid x-options-source ${JSON.stringify(optionsSource)} — expected "static"|"db"|"app" (an array of values belongs in x-options-preview)`);
      } else if (optionsSource === 'db' || optionsSource === 'app') {
        if (prop.enum || prop.items?.enum) {
          add('x-options-source', 'error', p,
            `x-options-source: ${optionsSource} must omit enum/items.enum — options arrive at runtime`);
        }
        const preview = prop['x-options-preview'];
        if (typeof preview === 'undefined') {
          add('x-options-source', 'warning', p,
            `x-options-source: ${optionsSource} should carry x-options-preview for dev/test rendering`);
        } else if (!Array.isArray(preview)) {
          add('x-options-source', 'error', p, 'x-options-preview must be an array of values');
        }
      }
    }

    // Recurse into nested object properties (object fields and array item objects)
    if (prop.properties) walkLevel(prop, p, add, depth + 1);
    if (prop.items?.properties) walkLevel(prop.items, `${p}[]`, add, depth + 1);
  }
}

function findCycles(deps) {
  const cycles = [];
  const seen = new Set(); // dedupe by sorted membership
  for (const start of Object.keys(deps)) {
    const chain = [start];
    const visited = new Set([start]);
    let cur = start;
    while (deps[cur]) {
      cur = deps[cur];
      if (visited.has(cur)) {
        if (cur === start) {
          chain.push(cur);
          const sig = [...visited].sort().join('|');
          if (!seen.has(sig)) {
            seen.add(sig);
            cycles.push(chain);
          }
        }
        break;
      }
      visited.add(cur);
      chain.push(cur);
    }
  }
  return cycles;
}

function join(parent, key) {
  return parent === '(root)' ? key : `${parent}.${key}`;
}

function finalize(findings) {
  const counts = {
    errors: findings.filter(f => f.severity === 'error').length,
    warnings: findings.filter(f => f.severity === 'warning').length,
    infos: findings.filter(f => f.severity === 'info').length
  };
  const score = Math.max(0, Math.min(100,
    100 - 15 * counts.errors - 5 * counts.warnings - 1 * counts.infos));
  return { score, counts, findings };
}

module.exports = { lintTrio };
