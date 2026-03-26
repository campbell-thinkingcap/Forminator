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
