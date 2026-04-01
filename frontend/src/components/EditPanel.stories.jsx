import EditPanel from './EditPanel';

export default {
  title: 'Forminator/EditPanel',
  component: EditPanel,
  decorators: [
    (Story) => (
      <div style={{ background: '#0a0a0f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1rem', padding: '1rem', width: '420px', height: '520px', display: 'flex', flexDirection: 'column' }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: { description: { component: 'AI-assisted schema editor. Accepts natural-language edit requests and returns a proposed schema diff.' } },
  },
};

const sampleSchema = {
  title: 'User Profile',
  type: 'object',
  required: ['name', 'email'],
  properties: {
    name:   { type: 'string', description: 'Display name' },
    email:  { type: 'string', description: 'Email address' },
    active: { type: 'boolean' },
  },
};

// ── Static message fixtures ───────────────────────────────────────────────────
// EditPanel requires a live API to function. These stories mock the internal
// state by monkey-patching useState via args, which isn't possible. Instead we
// wrap the component in a decorator that renders a static replica of the UI so
// the relevant visual states are still visible in Storybook without a backend.

const StaticChatPanel = ({ messages, inputPlaceholder = 'Describe a schema change… or type /hint', inputDisabled = false }) => (
  <div className="chat-panel">
    <div className="chat-messages">
      {messages.length === 0 && (
        <div className="chat-empty">Describe a schema change to get started</div>
      )}
      {messages.map((msg, i) => (
        <div key={i} className={`chat-message chat-message--${msg.role}`}>
          <div className="chat-avatar">
            {msg.role === 'assistant'
              ? <span style={{ fontSize: 11, opacity: 0.7 }}>AI</span>
              : <span style={{ fontSize: 11, opacity: 0.7 }}>U</span>}
          </div>
          <div className="chat-bubble-wrap">
            <div className={`chat-bubble${msg.hintResponse ? ' chat-bubble--markdown' : ''}`}>
              {msg.hintResponse
                ? <div dangerouslySetInnerHTML={{ __html: msg.html }} />
                : msg.content}
            </div>
            {msg.schemaApplied && (
              <div className="chat-schema-proposed">
                <span style={{ fontSize: 11 }}>⚗</span> Schema proposed
              </div>
            )}
            {msg.hintResponse && (
              <div className="chat-hint-badge">
                <span style={{ fontSize: 11 }}>💡</span> Hint
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
    <div className="chat-input-row">
      <input
        type="text"
        placeholder={inputPlaceholder}
        disabled={inputDisabled}
        className="chat-input"
        readOnly
      />
      <button className="chat-send-btn" disabled={inputDisabled} title="Send">
        <span style={{ fontSize: 13 }}>→</span>
      </button>
    </div>
  </div>
);

export const Empty = {
  name: 'Empty state',
  render: () => <StaticChatPanel messages={[]} />,
};

export const ConversationWithSchemaProposed = {
  name: 'Schema proposed badge',
  render: () => (
    <StaticChatPanel
      messages={[
        { role: 'user',      content: 'Add a "role" field with options admin, editor, viewer' },
        { role: 'assistant', content: 'Added a required "role" string field with enum options: admin, editor, viewer.', schemaApplied: true },
      ]}
    />
  ),
};

export const HintResponse = {
  name: '/hint response (markdown)',
  render: () => (
    <StaticChatPanel
      messages={[
        { role: 'user', content: '/hint' },
        {
          role: 'assistant',
          hintResponse: true,
          // Pre-rendered HTML so we don't need react-markdown in the static mock
          html: `
            <p>Here are some edits you could make to this schema:</p>
            <ul>
              <li>Add a <strong>phone</strong> field (string) for contact info</li>
              <li>Mark <strong>email</strong> as <code>format: email</code> for validation</li>
              <li>Add an <strong>age</strong> field (integer, min 0)</li>
            </ul>
          `,
          content: '',
        },
      ]}
    />
  ),
};

export const MultiTurnConversation = {
  name: 'Multi-turn conversation',
  render: () => (
    <StaticChatPanel
      messages={[
        { role: 'user',      content: 'Make the email field optional' },
        { role: 'assistant', content: 'Removed "email" from the required array. It is now an optional field.' },
        { role: 'user',      content: 'Also add a description to the active field' },
        { role: 'assistant', content: 'Added description "Account is active" to the active field.', schemaApplied: true },
      ]}
    />
  ),
};

export const NoSchema = {
  name: 'No schema loaded (input disabled)',
  render: () => (
    <StaticChatPanel
      messages={[]}
      inputPlaceholder="Describe a schema change… or type /hint"
      inputDisabled
    />
  ),
};
