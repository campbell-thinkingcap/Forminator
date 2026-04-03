# Schema Finder

Schema Finder lets you describe what you want to do in plain English and get back the
schemas that handle that action. It powers intent-based schema routing — useful for
building assistants, onboarding flows, or any UI where users shouldn't need to know
schema names up front.

---

## How it works

1. **Catalog generation** — A one-time (or on-demand) process fetches all schemas from
   Azure Blob Storage, sends them through Claude Haiku in batches, and extracts:
   - The primary domain entity (e.g. `User`, `Activity`, `SSO Provider`)
   - Supported actions (`create`, `configure`, `enroll`, etc.)
   - Keywords and example natural-language phrases

   The result is saved as `schema-catalog.json` in the root of the `schemas` Azure
   container.

2. **Intent routing** — When a query comes in, the compact catalog index is passed to
   Claude Haiku in a single call. It returns up to 5 ranked matches with a confidence
   level (`high`, `medium`, `low`) and a one-sentence explanation for each.

---

## API

### `POST /api/catalog/generate`

Builds or refreshes the catalog. Takes 30–60 seconds for 164 schemas.

**No request body required.**

```json
// Response
{
  "generated": 164,
  "errors": []
}
```

Run this once after initial deployment, and again whenever schemas are added or
significantly changed.

---

### `GET /api/catalog`

Returns the full enriched catalog array. Responses are cached in memory for 10 minutes.

```json
// Response — array of entries
[
  {
    "blobDir": "users/manage-users/add-single-user",
    "title": "Add Single User",
    "description": "...",
    "documentType": "single",
    "scope": "branch",
    "parentDir": "users/manage-users",
    "entity": "User",
    "actions": ["create"],
    "keywords": ["add user", "create account", "new learner", "register user"],
    "intentExamples": [
      "I want to add a user",
      "Create a new learner account",
      "How do I register someone?"
    ],
    "relatedDirs": [
      "users/manage-users/add-multiple-users",
      "users/access/user-basic"
    ]
  }
]
```

---

### `POST /api/catalog/intent`

Routes a natural-language query to matching schemas.

```json
// Request
{ "query": "I want to add a user" }

// Response
{
  "query": "I want to add a user",
  "matches": [
    {
      "blobDir": "users/manage-users/add-single-user",
      "title": "Add Single User",
      "confidence": "high",
      "reason": "Directly matches the intent to add a single user account"
    },
    {
      "blobDir": "users/manage-users/add-multiple-users",
      "title": "Add Multiple Users",
      "confidence": "medium",
      "reason": "Alternative if the user needs to add users in bulk"
    }
  ]
}
```

`confidence` is `high`, `medium`, or `low`. Up to 5 matches are returned, ordered by
relevance.

---

## Test UI

A hidden test page is available at `/schema-finder`. It is not linked from the main
navigation — navigate to it directly.

The page has:
- A search box to try intent queries
- Result cards showing title, schema path, confidence badge, and reasoning
- A **Generate / Refresh Catalog** button at the bottom for rebuilding the catalog

---

## Catalog storage

| Location | Purpose |
|----------|---------|
| Azure `schemas` container — `schema-catalog.json` | Generated catalog (source of truth) |
| Backend in-memory cache | 10-minute TTL; invalidated on generate |

The catalog is stored in Azure so it persists across server restarts and deployments.

---

## Dependencies

- **Claude Haiku** (`claude-haiku-4-5-20251001`) — used for both catalog enrichment and
  intent routing. Requires `ANTHROPIC_API_KEY` in the backend environment.
- **Azure Blob Storage** — catalog is read/written alongside the schema files. Requires
  `AZURE_ACCOUNT_NAME` and `AZURE_ACCOUNT_KEY`.
