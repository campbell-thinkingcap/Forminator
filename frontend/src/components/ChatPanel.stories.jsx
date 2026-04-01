import ChatPanel from './ChatPanel';

export default {
  title: 'Forminator/ChatPanel',
  component: ChatPanel,
  decorators: [
    (Story) => (
      <div style={{ background: '#0a0a0f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '1rem', padding: '1rem', width: '420px', height: '520px', display: 'flex', flexDirection: 'column' }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: { description: { component: 'Conversational form-fill assistant. Asks one field at a time and renders enum options as radio buttons or checkboxes.' } },
  },
};

// ── Static replica ────────────────────────────────────────────────────────────
// ChatPanel initialises via a live API call. These stories use a static
// replica to show key visual states without requiring a running backend.

const StaticChatPanel = ({ messages = [], enumOptions = null, multiSelect = false, inputDisabled = false }) => {
  const lastMsg = messages[messages.length - 1];
  const showEnum = enumOptions && lastMsg?.role === 'assistant';

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">Select a schema to start a conversation</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message--${msg.role}`}>
            <div className="chat-avatar">
              {msg.role === 'assistant'
                ? <span style={{ fontSize: 11, opacity: 0.7 }}>AI</span>
                : <span style={{ fontSize: 11, opacity: 0.7 }}>U</span>}
            </div>
            <div className="chat-bubble-wrap">
              <div className="chat-bubble">{msg.content}</div>
              {i === messages.length - 1 && msg.role === 'assistant' && showEnum && (
                multiSelect
                  ? (
                    <div className="chat-enum-options">
                      {enumOptions.map(opt => (
                        <label key={opt} className="chat-enum-option chat-enum-option--check">
                          <input type="checkbox" readOnly /> {opt}
                        </label>
                      ))}
                      <button className="chat-enum-confirm" disabled>Confirm</button>
                    </div>
                  )
                  : (
                    <div className="chat-enum-options">
                      {enumOptions.map(opt => (
                        <button key={opt} className="chat-enum-option">
                          <span className="chat-enum-radio" aria-hidden="true" />
                          {opt}
                        </button>
                      ))}
                    </div>
                  )
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="chat-input-row">
        <input
          type="text"
          placeholder={showEnum ? 'Select an option above…' : 'Type your answer…'}
          disabled={inputDisabled || showEnum}
          className="chat-input"
          readOnly
        />
        <button
          className="chat-send-btn"
          disabled={inputDisabled || showEnum}
          title="Send"
        >
          <span style={{ fontSize: 13 }}>→</span>
        </button>
      </div>
    </div>
  );
};

// ── Stories ───────────────────────────────────────────────────────────────────

export const Empty = {
  name: 'Empty state',
  render: () => <StaticChatPanel />,
};

export const FirstQuestion = {
  name: 'First question asked',
  render: () => (
    <StaticChatPanel
      messages={[
        { role: 'assistant', content: 'What is the name (Display name)?' },
      ]}
    />
  ),
};

export const EnumRadio = {
  name: 'Enum — radio options',
  render: () => (
    <StaticChatPanel
      messages={[
        { role: 'user',      content: 'Alice' },
        { role: 'assistant', content: 'What is the role (System role)? Options: admin, editor, viewer' },
      ]}
      enumOptions={['admin', 'editor', 'viewer']}
    />
  ),
};

export const BooleanRadio = {
  name: 'Boolean — Yes / No options',
  render: () => (
    <StaticChatPanel
      messages={[
        { role: 'user',      content: 'Alice' },
        { role: 'assistant', content: 'Is the account active?' },
      ]}
      enumOptions={['Yes', 'No']}
    />
  ),
};

export const MultiSelectCheckboxes = {
  name: 'Array enum — checkbox multi-select',
  render: () => (
    <StaticChatPanel
      messages={[
        { role: 'user',      content: 'Alice' },
        { role: 'assistant', content: 'Which permissions apply? Select all that apply.' },
      ]}
      enumOptions={['read', 'write', 'delete', 'admin']}
      multiSelect
    />
  ),
};

export const ConversationInProgress = {
  name: 'Conversation in progress',
  render: () => (
    <StaticChatPanel
      messages={[
        { role: 'assistant', content: 'What is the name (Display name)?' },
        { role: 'user',      content: 'Alice Johnson' },
        { role: 'assistant', content: 'What is the email (Email address)?' },
        { role: 'user',      content: 'alice@example.com' },
        { role: 'assistant', content: 'What is the role (System role)? Options: admin, editor, viewer' },
      ]}
      enumOptions={['admin', 'editor', 'viewer']}
    />
  ),
};

export const NoSchema = {
  name: 'No schema loaded (input disabled)',
  render: () => <StaticChatPanel inputDisabled />,
};
