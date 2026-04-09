# Skill Map

Skill Map maps a natural-language intent to both **Tapestry LMS skills** (what the system can do) and **TCOV schemas** (how to configure it). A user describes what they want to accomplish; Skill Map returns the relevant schemas and the LMS skills associated with each one.

---

## How it works

### 1. Catalog generation (one-time)

`POST /api/catalog/generate` fetches all schemas from Azure Blob Storage and enriches each one via Claude Haiku, producing:

- `entity` — primary domain object (e.g. `User`, `ILT Session`, `Badge`)
- `actions` — what you can do with it (`create`, `configure`, `enroll`, etc.)
- `keywords` — 5–8 short phrases a user might say to find this schema (e.g. `"add user"`, `"create account"`)
- `intentExamples` — 3 natural-language sentences that should route to this schema

The enriched catalog is saved as `schema-catalog.json` in the Azure `schemas` container and cached in memory for 10 minutes.

### 2. Intent routing

`POST /api/catalog/intent` passes the user's query and the compact catalog index to Claude Haiku. Claude returns up to 5 schema matches, each with a `confidence` level (`high`, `medium`, `low`) and a one-sentence explanation.

### 3. Per-schema skill lookup

For each matched schema, Skill Map queries the **ThinkingCap LMS Legacy loom** in the Tapestry Fabric database. The schema's `keywords` array is used as the search — each keyword is matched as a phrase against skill `name` and `category` (ILIKE).

Skills are then **scored and ranked** by how well they match:

| Match type | Weight |
|---|---|
| Keyword phrase found in skill **name** | 2× |
| Keyword phrase found in skill **category** only | 1× |
| No name match | filtered out |

Score = weighted matches / possible score. Skills are returned ordered best-first with their own `confidence` level (`high`, `medium`, `low`).

---

## API

### `POST /api/catalog/generate`

Builds or refreshes the enriched catalog. Takes 30–60 seconds for 164 schemas.

```json
// Response
{ "generated": 164, "errors": [] }
```

Run once after deployment and again whenever schemas are added or significantly changed.

---

### `GET /api/catalog`

Returns the full enriched catalog array (10-minute memory cache).

```json
[
  {
    "blobDir": "users/manage-users/add-single-user",
    "title": "Add Single User",
    "entity": "User",
    "actions": ["create"],
    "keywords": ["add user", "create account", "new user", "user registration", "sign up"],
    "intentExamples": ["I need to manually create a new user account."],
    "relatedDirs": ["users/manage-users/add-multiple-users"]
  }
]
```

---

### `GET /api/catalog/status`

Returns whether the catalog exists and when it was last generated.

```json
{ "exists": true, "lastGenerated": "2025-04-09T14:32:00.000Z" }
```

---

### `POST /api/catalog/intent`

Maps a natural-language query to schemas and their related LMS skills.

**Request:**
```json
{ "query": "I want to add a user" }
```

**Response:**
```json
{
  "query": "I want to add a user",
  "matches": [
    {
      "blobDir": "users/manage-users/add-single-user",
      "title": "Add Single User",
      "confidence": "high",
      "reason": "Directly matches the intent to add a single user account.",
      "skills": [
        { "name": "Add User to Branch",        "category": "User Management", "confidence": "high"   },
        { "name": "Add User Connections",       "category": "General",         "confidence": "medium" }
      ]
    },
    {
      "blobDir": "users/manage-users/add-multiple-users",
      "title": "Add Multiple Users",
      "confidence": "medium",
      "reason": "Alternative if the user needs to add many users at once.",
      "skills": []
    }
  ]
}
```

Each match has:
- `confidence` — schema match confidence from Claude (`high` / `medium` / `low`)
- `skills` — Tapestry LMS skills related to this schema, sorted by relevance score, each with their own `confidence`

---

## Test UI

Navigate directly to `/skill-map` (not linked from the main nav).

The page has:
- A search box — describe what you want to do
- Result cards per schema showing title, path, confidence badge, reasoning, and skill pills
- Skill pills are colour-coded by confidence (green = high, amber = medium, grey = low)
- A **Generate / Refresh Catalog** button and catalog preview at the bottom

---

## Tapestry skill lookup

| Setting | Value |
|---|---|
| Database | `tapestry-postgres.postgres.database.azure.com` |
| Loom | ThinkingCap LMS Legacy (`4b5dd914`) |
| Fabric conversation ID | `c2c29ce1-2464-4c99-b56c-1312b16e792f` |
| Required env vars | `TAPESTRY_PG_HOST`, `TAPESTRY_PG_PASSWORD` |

If Tapestry credentials are absent or the DB is unreachable, skill lookup is skipped gracefully — schema matching continues unaffected and all `skills` arrays are empty.

Logs prefix with `[tapestry]` for DB activity and `[skill-map]` for routing results.

---

## Catalog storage

| Location | Purpose |
|---|---|
| Azure `schemas` container — `schema-catalog.json` | Enriched catalog (source of truth) |
| Backend in-memory cache | 10-minute TTL; invalidated on generate |

---

## Dependencies

- **Claude Haiku** (`claude-haiku-4-5-20251001`) — catalog enrichment and intent routing. Requires `ANTHROPIC_API_KEY`.
- **Azure Blob Storage** — catalog storage alongside schema files. Requires `AZURE_ACCOUNT_NAME` and `AZURE_ACCOUNT_KEY`.
- **Tapestry PostgreSQL** — skill lookup (optional). Requires `TAPESTRY_PG_HOST` and `TAPESTRY_PG_PASSWORD`.
