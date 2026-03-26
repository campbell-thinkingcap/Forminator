import FormField from './FormField';

export default {
  title: 'Forminator/FormField',
  component: FormField,
  args: {
    onChange: () => {},
    onFocus: () => {},
  },
};

export const Text = {
  args: {
    label: 'Full Name',
    type: 'string',
    value: '',
    description: 'The user\'s full display name.',
    schema: { type: 'string' },
    required: false,
  },
};

export const TextRequired = {
  name: 'Text (required)',
  args: {
    label: 'Email',
    type: 'string',
    value: 'user@example.com',
    description: 'Primary email address.',
    schema: { type: 'string' },
    required: true,
  },
};

export const Number = {
  args: {
    label: 'Max Attempts',
    type: 'integer',
    value: 3,
    description: 'Number of allowed login attempts.',
    schema: { type: 'integer' },
    required: false,
  },
};

export const Boolean = {
  args: {
    label: 'Active',
    type: 'boolean',
    value: true,
    schema: { type: 'boolean' },
    required: false,
  },
};

export const Enum = {
  args: {
    label: 'Role',
    type: 'string',
    value: 'admin',
    description: 'User role within the system.',
    schema: { type: 'string', enum: ['admin', 'editor', 'viewer'] },
    required: true,
  },
};

export const UUID = {
  args: {
    label: 'Branch ID',
    type: 'string',
    value: '',
    description: 'Auto-assigned unique identifier.',
    schema: { type: 'string', format: 'uuid' },
    required: false,
  },
};
