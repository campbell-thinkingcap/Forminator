# ThinkingCap Schema Mapping

This document explains the relationship between Forminator schemas and the ThinkingCap LMS Legacy loom in Tapestry, and how the schema router connects user intent to the right schema.

---

## Two-Layer Model

There are two distinct layers that are easy to conflate:

| Layer | Lives in | What it describes |
|---|---|---|
| **Loom skills** | Tapestry (ThinkingCap LMS Legacy loom) | LMS *features* — UI flows, business logic, what the application does |
| **Forminator schemas** | `schemas/` directory | TCOV *settings* — data structures for branch-level configuration |

These layers do not map 1:1. A loom skill like "Withdraw Learners" describes a feature of the LMS. A Forminator schema like `activities.json` describes the data structure for activity template configuration. They operate at different levels of abstraction.

The schema router does **not** query the loom skill catalog. It routes based on the schema files themselves.

---

## ThinkingCap LMS Legacy Loom

| Field | Value |
|---|---|
| Loom ID | `4b5dd914` |
| Fabric conversation ID | `c2c29ce1-2464-4c99-b56c-1312b16e792f` |
| Location | Tapestry — `tapestry.team` |

The loom contains hundreds of LMS feature skills covering areas such as enrollment, reporting, user management, course authoring, and notifications. These are used by the Dresser to build and maintain the ThinkingCap codebase — they are not schema definitions.

---

## Forminator Schema Reference

Each schema file in `schemas/` represents one TCOV settings domain. The schema router uses the `title` and `description` fields from these files to match user requests.

| File | `$id` | Title | Scope | ThinkingCap DB tables |
|---|---|---|---|---|
| `activities.json` | `settings-activities` | Settings > Activities | branch | `ActivityTemplates`, `LearningObjectWizardSettings`, `LearningObjectHideSettings` |
| `ilt_session_default.json` | `settings-instructor-led-session-default` | Settings > Instructor Led > Session Default | branch | `CourseSession` (where `SessionName = 'SessionDefault'`) |
| `settings.json` | `settings` | Settings > Activities | branch | `ActivityTemplates`, `LearningObjectWizardSettings`, `LearningObjectHideSettings` |

> **Note:** `settings.json` and `activities.json` currently have identical content. `settings.json` was a duplicate and its `$id` has been corrected from `settings-activities` to `settings` to make it unique. The intended distinction between the two files should be clarified and one may be a candidate for removal or repurposing.

---

## How the Schema Router Works

**Endpoint:** `POST /api/schema-router`

On each request the router:

1. Reads all `.json` files from `schemas/` at runtime — no caching, always current
2. Builds a catalog from each schema's `title` and first sentence of `description`
3. Queries the Tapestry DB for loom skills matching key terms from the user's request (see below)
4. Sends the catalog, the user's request, and any matched skills to Claude Haiku
5. Claude returns the names of matching schemas; skills are used as context only — never returned
6. Results are validated — only names that exist in the catalog are returned

The response includes a `skillsUsed` boolean indicating whether any Tapestry skills were found and used as context.

**Tapestry skill cross-reference:**

The router performs an optional ILIKE search against the ThinkingCap LMS Legacy loom in the Tapestry Fabric database (`conversation_messages` where `metadata->>'fabric_type' = 'rsd'`). Key terms are extracted from the user's request (stop words removed, length > 2) and matched against each skill's `name` and `category` fields.

This enriches routing for requests that use LMS feature vocabulary (e.g., "attendance code", "withdraw learners") — Claude can map that vocabulary to the correct settings schema even when the schema's `description` doesn't use the same words.

The cross-reference is fully optional: if the `TAPESTRY_PG_*` environment variables are absent or the DB is unreachable, routing continues using the schema catalog alone.

**Why schema-first, not loom-first:**
Loom skills describe LMS features, not settings schemas — they cannot replace the schema catalog. The skill lookup is additive context only.

---

## Adding a New Schema

1. Create a JSON Schema file in `schemas/` with the following root-level fields:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12",
  "$id": "unique-kebab-case-id",
  "title": "Settings > Category > Subcategory",
  "description": "One clear paragraph explaining what this schema covers, which branch-level settings it configures, and which DB tables it maps to.",
  "type": "object",
  "documentType": "single",
  "scope": "branch"
}
```

2. Drop the file into `schemas/`. The router picks it up automatically on the next request — no config changes needed.

3. The `description` field is the primary routing signal. Write it to answer the question: *"what would a user say if they needed this schema?"*

---

## Schema-to-Skill Mapping (Future)

If a loom skill in Tapestry is ever created that directly corresponds to a Forminator schema (e.g. a skill specifically for managing ILT session defaults), the mapping would be recorded here.

The current cross-reference approach is a best-effort ILIKE match — it surfaces related skills but does not guarantee a precise schema↔skill correspondence. A curated mapping table (added to this document) would let the router make authoritative connections rather than fuzzy ones.

**Improving term coverage:** The stop-word list in `schemaRouter.js` (`STOP_WORDS` constant) can be extended to filter out domain noise. New skills added to the ThinkingCap loom are picked up automatically on the next request — no Forminator config change needed.
