import JsonHighlight from './JsonHighlight';

export default {
  title: 'Forminator/JsonHighlight',
  component: JsonHighlight,
  decorators: [
    (Story) => (
      <div style={{ background: '#0a0a0f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1rem', padding: '1rem', maxWidth: '600px' }}>
        <Story />
      </div>
    ),
  ],
};

const sampleSchema = {
  title: 'User Profile',
  type: 'object',
  required: ['name', 'email'],
  properties: {
    name:   { type: 'string',  description: 'Display name' },
    email:  { type: 'string',  description: 'Email address' },
    active: { type: 'boolean' },
    age:    { type: 'integer' },
  },
};

export const Default = {
  args: {
    value: sampleSchema,
    activeKey: null,
  },
};

export const ActiveField = {
  name: 'With active field highlighted',
  args: {
    value: sampleSchema,
    activeKey: 'email',
  },
};

export const NestedSchema = {
  name: 'Nested schema',
  args: {
    value: {
      type: 'object',
      properties: {
        org: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            code: { type: 'string' },
          },
        },
        active: { type: 'boolean' },
      },
    },
    activeKey: null,
  },
};

// ── Diff mode ────────────────────────────────────────────────────────────────

const schemaBeforeEdit = {
  title: 'User Profile',
  type: 'object',
  required: ['name', 'email'],
  properties: {
    name:   { type: 'string',  description: 'Display name' },
    email:  { type: 'string',  description: 'Email address' },
    active: { type: 'boolean' },
  },
};

const schemaAfterAddField = {
  title: 'User Profile',
  type: 'object',
  required: ['name', 'email', 'role'],
  properties: {
    name:   { type: 'string',  description: 'Display name' },
    email:  { type: 'string',  description: 'Email address' },
    active: { type: 'boolean' },
    role:   { type: 'string',  enum: ['admin', 'editor', 'viewer'], description: 'System role' },
  },
};

const schemaAfterEditDescription = {
  title: 'User Profile',
  type: 'object',
  required: ['name', 'email'],
  properties: {
    name:   { type: 'string',  description: 'Full legal name' },
    email:  { type: 'string',  description: 'Primary email address' },
    active: { type: 'boolean' },
  },
};

export const DiffAddedField = {
  name: 'Diff — field added',
  args: {
    value: schemaAfterAddField,
    diffBase: schemaBeforeEdit,
    activeKey: null,
  },
};

export const DiffEditedDescription = {
  name: 'Diff — description changed',
  args: {
    value: schemaAfterEditDescription,
    diffBase: schemaBeforeEdit,
    activeKey: null,
  },
};

export const DiffNoChanges = {
  name: 'Diff — no changes',
  args: {
    value: schemaBeforeEdit,
    diffBase: schemaBeforeEdit,
    activeKey: null,
  },
};
