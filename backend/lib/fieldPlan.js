// Pure implementation of the Schema Authoring Standard's runtime precedence rules
// (docs/SCHEMA-AUTHORING-STANDARD.md §5). One spec, three runtimes: this file
// (Forminator chat), tc-surface-forms `fieldPlan.ts`, and phoenix `computeChoices`
// are independent implementations — divergence from the standard is a verification
// failure, not a design choice.
//
// Pure and dependency-free: same (schema, formData, answeredKeys) in, same plan out.

// ---------- §5.1 inclusion ----------

// Auto-assigned fields are never asked (the form may show them disabled) and are
// always treated as answered (§5.6).
function isAutoAssigned(prop) {
  return 'const' in prop ||
    prop.format === 'uuid' ||
    prop.readOnly === true ||
    prop['x-source'] === 'app' ||
    prop['x-source'] === 'system';
}

// ---------- §5.6 answered state ----------

// Only null / undefined / '' are empty. An explicit `false` IS an answer — boolean
// fields must never be re-asked because their value is false (the old runtime
// excluded false and re-asked forever). Answered-set membership is the other path
// (chip clicks / confirmed updates), handled by callers via `answeredKeys`.
function isNonEmpty(v) {
  return v !== null && v !== undefined && v !== '';
}

// ---------- §5.3 question text ----------

function firstSentence(text) {
  if (!text || typeof text !== 'string') return null;
  const i = text.indexOf('.');
  return (i === -1 ? text : text.slice(0, i + 1)).trim() || null;
}

// ---------- §4 widget derivation ----------

function deriveWidget(prop) {
  const explicit = prop['x-widget'];
  if (explicit) return explicit; // validity vs field shape is a lint concern (§6.10)
  if (prop.type === 'array' && Array.isArray(prop.items?.enum)) return 'checkbox';
  if (prop.type === 'boolean') return 'yesno';
  if (Array.isArray(prop.enum)) return prop.enum.length <= 5 ? 'radio' : 'dropdown';
  // Dynamic options with no explicit override: picker shape, no chips (§5.5).
  if (prop['x-options-source'] === 'db' || prop['x-options-source'] === 'app') return 'dropdown';
  return null; // free text
}

// ---------- §4 x-depends-on (canonical object + legacy string shorthand) ----------
// Same grammar as schemaLint.js's parseDependsOn — the standard is normative;
// keep both parsers aligned with it, not with each other.

function parseDependsOn(raw) {
  if (raw && typeof raw === 'object' && typeof raw.field === 'string') {
    if ('equals' in raw) return { field: raw.field, op: 'equals', value: raw.equals };
    if ('in' in raw) return { field: raw.field, op: 'in', value: raw.in };
    if ('truthy' in raw) return { field: raw.field, op: 'truthy', value: raw.truthy };
    return null;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const eq = raw.indexOf('=');
    if (eq === -1) return { field: raw.trim(), op: 'truthy', value: true };
    return { field: raw.slice(0, eq).trim(), op: 'equals', value: raw.slice(eq + 1).trim() };
  }
  return null;
}

function evalDependsOn(dep, data) {
  const v = data?.[dep.field];
  switch (dep.op) {
    case 'equals': return v === dep.value;
    case 'in': return Array.isArray(v) && v.includes(dep.value);
    case 'truthy': return Boolean(v);
    default: return false;
  }
}

// ---------- §5.4 if/then/else (requiredness only) ----------
// Collection semantics, not full JSON Schema evaluation: a condition is ACTIVE only
// when every constrained key holds a present, matching value — an unanswered
// controlling field never activates `then`. Supported constraint subset: const, enum,
// and required (presence). That covers the authoring patterns lint accepts for
// conditional requiredness; anything richer is treated as inactive.

function matchesIf(ifSchema, data) {
  if (!ifSchema || typeof ifSchema !== 'object') return false;
  const props = ifSchema.properties ?? {};
  const keys = new Set([...(Array.isArray(ifSchema.required) ? ifSchema.required : []), ...Object.keys(props)]);
  if (keys.size === 0) return false;
  for (const key of keys) {
    const v = data?.[key];
    if (!isNonEmpty(v)) return false;
    const c = props[key];
    if (!c) continue; // presence-only requirement
    if ('const' in c && v !== c.const) return false;
    if (Array.isArray(c.enum) && !c.enum.includes(v)) return false;
  }
  return true;
}

// A field made required by the ACTIVE branch is asked; a field required only by the
// inactive branch (and not in base `required`) is skipped this turn.
function conditionalRequiredness(schema, data) {
  const baseRequired = new Set(Array.isArray(schema.required) ? schema.required : []);
  const required = new Set(baseRequired);
  const excluded = new Set();
  if (schema.if && (schema.then || schema.else)) {
    const thenReq = Array.isArray(schema.then?.required) ? schema.then.required : [];
    const elseReq = Array.isArray(schema.else?.required) ? schema.else.required : [];
    if (matchesIf(schema.if, data)) {
      thenReq.forEach(k => required.add(k));
      elseReq.filter(k => !baseRequired.has(k)).forEach(k => excluded.add(k));
    } else {
      elseReq.forEach(k => required.add(k));
      thenReq.filter(k => !baseRequired.has(k)).forEach(k => excluded.add(k));
    }
  }
  return { required, excluded };
}

// ---------- the plan ----------

// buildFieldPlan(schema, formData, answeredKeys) → ordered ask-plan, one entry per
// askable field (§5.1 inclusions, §5.4 conditionals, this turn):
//   { key, prompt, hint, widget, enumOptions, multiSelect, skippable,
//     filled, required, type }
// (documented shape plus filled/required/type for the chat prompt builder).
// Order per §5.2: x-order ascending → remaining required (declaration order) →
// remaining optional (declaration order). No x-order anywhere = legacy
// required-first exactly.
function buildFieldPlan(schema, formData = {}, answeredKeys = []) {
  const properties = schema?.properties ?? {};
  const data = formData ?? {};
  const answered = answeredKeys instanceof Set ? answeredKeys : new Set(answeredKeys ?? []);
  const { required, excluded } = conditionalRequiredness(schema ?? {}, data);

  const askable = Object.keys(properties).filter(key => {
    const prop = properties[key] ?? {};
    if (isAutoAssigned(prop)) return false;      // §5.1.1 — never asked
    if (prop['x-source'] === 'db') return false; // §5.1.2 — read-only in form, skipped in chat
    if (excluded.has(key)) return false;         // §5.4 — inactive if/then/else branch
    const dep = parseDependsOn(prop['x-depends-on']);
    if (dep && !evalDependsOn(dep, data)) return false; // §5.4 — unsatisfied conditional
    return true;
  });

  const hasOrder = k => typeof properties[k]['x-order'] === 'number';
  const withOrder = askable.filter(hasOrder)
    .sort((a, b) => properties[a]['x-order'] - properties[b]['x-order']);
  const rest = askable.filter(k => !hasOrder(k));
  const ordered = [
    ...withOrder,
    ...rest.filter(k => required.has(k)),
    ...rest.filter(k => !required.has(k))
  ];

  return ordered.map(key => {
    const prop = properties[key];
    const widget = deriveWidget(prop);
    const dynamicOptions = prop['x-options-source'] === 'db' || prop['x-options-source'] === 'app';
    const multiSelect = prop.type === 'array' && Array.isArray(prop.items?.enum);
    // §5.5 — chips only for static option sources; db|app → "pick it in the form"
    const enumOptions = dynamicOptions ? null
      : Array.isArray(prop.enum) ? prop.enum
      : multiSelect ? prop.items.enum
      : widget === 'yesno' ? ['Yes', 'No']
      : null;
    const type = Array.isArray(prop.type) ? prop.type.find(t => t !== 'null') : prop.type;
    return {
      key,
      prompt: prop['x-prompt'] ?? firstSentence(prop.description),
      hint: prop['x-hint'] ?? null,
      widget,
      enumOptions,
      multiSelect,
      skippable: !required.has(key),
      filled: answered.has(key) || isNonEmpty(data[key]),
      required: required.has(key),
      type: type ?? 'string'
    };
  });
}

module.exports = {
  buildFieldPlan,
  isAutoAssigned,
  isNonEmpty,
  deriveWidget,
  parseDependsOn,
  evalDependsOn,
  matchesIf
};
