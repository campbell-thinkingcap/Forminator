# Forminator

A dynamic form generator that renders interactive forms from JSON Schema definitions. Point it at a schema stored in Azure Blob Storage, fill in the form, and get clean JSON output. Includes an AI chat assistant for guided form filling and an AI edit assistant for iterating on schemas.

## Features

- **Azure Blob Storage** — browse and load schemas from Azure via the schema tree sidebar
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
- Presents **radio buttons** for `enum` and `boolean` fields — only the listed options are accepted
- Presents **checkboxes** for array fields with `items.enum`
- Never guesses or infers a value — if the user's answer is unclear, it asks again
- Respects `x-hint` on any field — hint text is woven naturally into the question
- Refocuses the input after each response

### Edit assistant

- Accepts natural-language instructions: *"add a required priority field with options low, medium, high"*
- Asks targeted clarifying questions before applying changes when needed
- Returns a **proposed** schema — an amber bar lets you test it in the form and chat before committing
- Click **Approve** to accept the proposal, **Discard** to revert
- After approving, a blue **Save to Azure** bar appears — click it to persist the schema back to Azure Blob Storage
- Before saving, the previous `schema.json` is automatically archived to `{blobDir}/archive/schema-{timestamp}.json`
- The Schema tab switches to a **diff view** (green added lines, red removed lines) while a proposal is active, and scrolls to the first change automatically
- Type `/hint` to get a quality review of the current schema — response is rendered as markdown
- **Archive history** — right-click any schema in the sidebar to view past versions, preview them with syntax highlighting, and roll back to any prior version

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
│       ├── azure.js      # Azure Blob Storage schema loader and saver
│       └── data.js       # Form submission CRUD API
├── frontend/
│   └── src/
│       ├── App.jsx
│       └── components/
│           ├── DynamicForm.jsx    # Recursive form renderer
│           ├── FormField.jsx      # Individual field inputs
│           ├── JsonHighlight.jsx  # Syntax-highlighted schema viewer with diff mode
│           ├── ChatPanel.jsx      # Guided form-filling chat UI
│           ├── EditPanel.jsx      # Schema edit chat UI
│           ├── SchemaTree.jsx     # Azure schema browser sidebar
│           ├── ApiDocs.jsx        # Auto-generated API docs view
│           └── LoginPage.jsx      # Google OAuth login
└── schema_ai_concept.md  # Schema design guide loaded by the edit assistant
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

### 3. Start Storybook

```bash
cd frontend
npm run storybook
```

Opens at `http://localhost:6006`. Stories cover `JsonHighlight` (including diff mode), `ChatPanel` (enum/boolean/checkbox states), `EditPanel` (schema-proposed badge, `/hint` markdown), `DynamicForm`, and `FormField`.

### Environment variables

Create `backend/.env`:

```
ANTHROPIC_API_KEY=sk-...
AZURE_ACCOUNT_NAME=tcsettings
AZURE_ACCOUNT_KEY=...
```

`AZURE_ACCOUNT_NAME` and `AZURE_ACCOUNT_KEY` are required — schemas are loaded exclusively from Azure Blob Storage. The schemas container is expected to contain paths of the form `{category}/{name}/schema.json`.

## Schema edit workflow

1. Load a schema from the Azure sidebar
2. Switch to the **Edit** tab and describe a change in plain English
3. The assistant may ask clarifying questions, then proposes the full modified schema
4. The Schema tab switches to diff view — the first change scrolls into view automatically
5. Use the form and Chat tab to test the proposed schema
6. Click **Approve** to accept, or **Discard** to revert
7. Click **Save to Azure** to write the schema back to Azure Blob Storage

The previous version is always archived before saving.

## Tech Stack

- **Frontend:** React 19, Vite, Lucide icons, `react-markdown`, Storybook, Vitest + Playwright
- **Backend:** Node.js, Express, Anthropic SDK (`claude-sonnet-4-6`)
- **Auth:** Google OAuth (`@react-oauth/google`)
- **Storage:** Azure Blob Storage (`@azure/storage-blob`)
- **Styling:** Custom CSS, glassmorphism dark theme, Outfit font
