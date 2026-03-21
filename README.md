# Forminator

A dynamic form generator that renders interactive forms from JSON Schema definitions. Point it at a schema, fill in the form, and get clean JSON output — with the schema definition visible alongside for reference.

## Features

- **Schema-driven forms** — drop a JSON Schema file into `schemas/` and it appears in the UI automatically
- **Live JSON output** — form data updates in real time as you type
- **Split-pane layout** — resizable divider between the form and the schema viewer
- **Active field highlighting** — focusing a field scrolls the schema panel to the corresponding definition
- **Supports nested objects, arrays, enums, booleans, integers, and strings**

## Project Structure

```
Forminator/
├── backend/          # Express API — serves schemas
│   └── server.js
├── frontend/         # React (Vite) app
│   └── src/
│       ├── App.jsx
│       └── components/
│           ├── DynamicForm.jsx   # Recursive form renderer
│           ├── FormField.jsx     # Individual field inputs
│           └── JsonHighlight.jsx # Syntax-highlighted schema viewer
└── schemas/          # JSON Schema files (add yours here)
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

## Adding a Schema

Drop any valid JSON Schema file into the `schemas/` directory:

```
schemas/my-schema.json
```

It will appear in the schema selector dropdown immediately (no restart needed).

### Schema Requirements

- Must be valid JSON
- Should have a top-level `type: "object"` with a `properties` map
- `title` and `description` fields are displayed in the UI
- Supports `enum` arrays, `required` arrays, and nested `$defs`

### Supported Field Types

| JSON Schema type | Rendered as |
|-----------------|-------------|
| `string`        | Text input  |
| `integer` / `number` | Number input |
| `boolean`       | Checkbox    |
| `string` with `enum` | Dropdown |
| `object`        | Nested section |
| `array`         | Add/remove item list |

## Tech Stack

- **Frontend:** React 19, Vite, Lucide icons
- **Backend:** Node.js, Express
- **Styling:** Custom CSS with glassmorphism dark theme (Outfit font)
