# Forminator

A dynamic form generator that renders interactive forms from JSON Schema definitions. Point it at a schema, fill in the form, and get clean JSON output. Includes an AI chat assistant for guided form filling and an AI edit assistant for iterating on schemas in memory.

## Features

- **Schema-driven forms** — drop a JSON Schema file into `schemas/` and it appears automatically
- **Azure Blob Storage** — browse and load schemas stored in Azure via the schema tree sidebar
- **Live JSON output** — switch between Form and JSON tabs; output updates in real time
- **Split-pane layout** — resizable divider between the left panel and the form
- **Active field highlighting** — focusing a field scrolls the schema panel to that definition
- **`const` fields auto-prefilled** — fields with a `const` value are pre-populated and shown read-only
- **Google OAuth login** — users sign in with their Google account

### Left Panel — three tabs

| Tab | Purpose |
|-----|---------|
| **Schema** | Syntax-highlighted JSON Schema viewer with active-field scroll |
| **Chat** | AI assistant that guides the user through filling in the form field by field |
| **Edit** | AI assistant that accepts natural-language schema changes and applies them in memory |

### Chat assistant

- Asks for one field at a time in required-first order
- Skips `const` and UUID fields (auto-assigned, never prompted)
- Presents **radio buttons** for `enum` and `boolean` fields — no free-text guessing
- Presents **checkboxes** for array fields with `items.enum`
- Refocuses the input after each response

### Edit assistant

- Accepts natural-language instructions: *"add a required priority field with options low, medium, high"*
- Returns and applies the complete modified schema in memory — no file writes
- An amber **reset bar** appears when edits are active; clicking Reset restores the original schema
- A green **✓ Schema updated** indicator appears on each successful change
- The Schema tab, form, and Chat assistant all reflect edits immediately
- The Chat assistant reinitializes with the updated schema after each edit

### Supported field types

| JSON Schema type | Form control |
|-----------------|--------------|
| `string` | Text input |
| `integer` / `number` | Number input |
| `boolean` | Checkbox (form) / Yes·No radio (chat) |
| `string` with `enum` | Dropdown (form) / Radio group (chat) |
| `array` with `items.enum` | Add/remove list (form) / Checkboxes (chat) |
| `object` | Collapsible nested section |
| `string` with `format: uuid` | Read-only auto-assigned display |
| Any field with `const` | Read-only pre-filled display |

## Project Structure

```
Forminator/
├── backend/
│   ├── server.js
│   └── routes/
│       ├── chat.js       # Guided form-filling assistant (/api/chat)
│       ├── chatEdit.js   # Schema edit assistant (/api/chat/edit)
│       ├── azure.js      # Azure Blob Storage schema loader
│       └── data.js       # Form submission CRUD API
├── frontend/
│   └── src/
│       ├── App.jsx
│       └── components/
│           ├── DynamicForm.jsx    # Recursive form renderer
│           ├── FormField.jsx      # Individual field inputs
│           ├── JsonHighlight.jsx  # Syntax-highlighted schema viewer
│           ├── ChatPanel.jsx      # Guided form-filling chat UI
│           ├── EditPanel.jsx      # Schema edit chat UI
│           ├── SchemaTree.jsx     # Azure schema browser sidebar
│           ├── ApiDocs.jsx        # Auto-generated API docs view
│           └── LoginPage.jsx      # Google OAuth login
└── schemas/              # Local JSON Schema files
```

## Getting Started

**Prerequisites:** Node.js 18+

### 1. Start the backend

```bash
cd backend
npm install
npm run dev
```

Runs on `http://localhost:3001`.

### 2. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Opens at `http://localhost:5173`.

### Environment variables

Create `backend/.env`:

```
ANTHROPIC_API_KEY=sk-...
AZURE_STORAGE_CONNECTION_STRING=...   # optional — for Azure schema browser
```

## Adding a Schema

Drop any valid JSON Schema file into the `schemas/` directory:

```
schemas/my-schema.json
```

It appears in the UI immediately (no restart needed).

### Schema tips

- Top-level `type: "object"` with a `properties` map is required
- `title` and `description` are displayed in the form header
- `required` arrays control field ordering and required indicators in the chat assistant
- Fields with `"const": <value>` are pre-filled and locked — the chat assistant skips them
- Fields with `"format": "uuid"` are displayed as auto-assigned and skipped in chat

## Tech Stack

- **Frontend:** React 19, Vite, Lucide icons, Storybook, Vitest + Playwright
- **Backend:** Node.js, Express, Anthropic SDK (`claude-haiku-4-5`)
- **Auth:** Google OAuth (`@react-oauth/google`)
- **Storage:** Azure Blob Storage (`@azure/storage-blob`)
- **Styling:** Custom CSS, glassmorphism dark theme, Outfit font
