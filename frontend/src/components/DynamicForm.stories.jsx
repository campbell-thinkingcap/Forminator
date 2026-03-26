import DynamicForm from './DynamicForm';

export default {
  title: 'Forminator/DynamicForm',
  component: DynamicForm,
  args: {
    onChange: () => {},
    onFieldFocus: () => {},
  },
};

const flatSchema = {
  title: 'User Profile',
  type: 'object',
  required: ['name', 'email'],
  properties: {
    name:  { type: 'string',  description: 'Display name' },
    email: { type: 'string',  description: 'Email address' },
    age:   { type: 'integer', description: 'Age in years' },
    active: { type: 'boolean' },
    role: { type: 'string', enum: ['admin', 'editor', 'viewer'], description: 'System role' },
  },
};

export const FlatSchema = {
  name: 'Flat schema',
  args: {
    schema: flatSchema,
    data: { name: 'Jane Smith', email: 'jane@example.com', role: 'editor', active: true },
  },
};

export const EmptyData = {
  name: 'Empty data',
  args: {
    schema: flatSchema,
    data: {},
  },
};

const nestedSchema = {
  title: 'Organisation Settings',
  type: 'object',
  properties: {
    orgName: { type: 'string', description: 'Organisation display name' },
    contact: {
      type: 'object',
      description: 'Primary contact details',
      properties: {
        email: { type: 'string' },
        phone: { type: 'string' },
      },
    },
  },
};

export const NestedObject = {
  name: 'Nested object',
  args: {
    schema: nestedSchema,
    data: { orgName: 'Acme Corp', contact: { email: 'hello@acme.com', phone: '+1 555 0100' } },
  },
};

const arraySchema = {
  title: 'Course Tags',
  type: 'object',
  properties: {
    title: { type: 'string' },
    tags: {
      type: 'array',
      description: 'Searchable tags for this course',
      items: { type: 'string' },
    },
  },
};

export const ArrayField = {
  name: 'Array field',
  args: {
    schema: arraySchema,
    data: { title: 'Intro to React', tags: ['react', 'javascript', 'frontend'] },
  },
};
