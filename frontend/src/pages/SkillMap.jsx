import React, { useState, useEffect, useRef } from 'react';
import { Bot, RotateCcw, Send, User } from 'lucide-react';
import DynamicForm from '../components/DynamicForm';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

const CONFIDENCE_COLORS = {
  high:   { bg: 'rgba(16,185,129,0.15)', text: '#10b981', border: 'rgba(16,185,129,0.3)' },
  medium: { bg: 'rgba(245,158,11,0.15)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
  low:    { bg: 'rgba(148,163,184,0.15)', text: '#94a3b8', border: 'rgba(148,163,184,0.3)' },
};

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] ?? {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export default function SkillMap() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'What would you like to do today?' },
  ]);
  const [schemas, setSchemas] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [skillDetail, setSkillDetail] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState(null);
  const [catalogStatus, setCatalogStatus] = useState(null);
  const [catalogPreview, setCatalogPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(null);
  const [phase, setPhase]                           = useState('discovery');
  const [selectedSchema, setSelectedSchema]         = useState(null);
  const [formData, setFormData]                     = useState({});
  const [collectingMessages, setCollectingMessages] = useState([]);
  const [enumOptions, setEnumOptions]               = useState(null);

  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  // Apply saved theme
  useEffect(() => {
    const stored = localStorage.getItem('forminator_theme');
    if (stored && ['dark', 'light', 'thinkingcap'].includes(stored)) {
      document.documentElement.setAttribute('data-theme', stored);
    }
  }, []);

  // Fetch catalog status on mount
  useEffect(() => {
    fetch(`${API_BASE}/catalog/status`)
      .then(r => r.json())
      .then(setCatalogStatus)
      .catch(() => {});
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, schemas]);

  const selectSkill = async (skill) => {
    if (selectedSkill?.name === skill.name) {
      setSelectedSkill(null);
      setSkillDetail(null);
      return;
    }
    setSelectedSkill(skill);
    setSkillDetail({ loading: true });
    try {
      const res = await fetch(`${API_BASE}/catalog/skill-detail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: skill.name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSkillDetail({ loading: false, docs: data.docs ?? [], error: null });
    } catch (err) {
      setSkillDetail({ loading: false, docs: [], error: err.message });
    }
  };

  const handleSchemaSelect = async (match) => {
    if (phase !== 'discovery' || loading) return;
    setLoading(true);
    try {
      const schemaRes = await fetch(`${API_BASE}/catalog/schema?blobDir=${encodeURIComponent(match.blobDir)}`);
      if (!schemaRes.ok) throw new Error(`HTTP ${schemaRes.status}`);
      const schema = await schemaRes.json();

      const transitionMsg = {
        role: 'assistant',
        content: `Great, let's collect the information needed for **${match.title}**. I'll guide you through each field.`,
      };
      setSelectedSchema(schema);
      setPhase('collecting');
      setFormData({});
      setEnumOptions(null);
      setCollectingMessages([]);

      const messagesWithTransition = [...messages, transitionMsg];
      setMessages(messagesWithTransition);

      // Get first field question
      const chatRes = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema, messages: [], currentFormData: {} }),
      });
      if (!chatRes.ok) throw new Error(`HTTP ${chatRes.status}`);
      const data = await chatRes.json();

      const assistantMsg = { role: 'assistant', content: data.message };
      setMessages([...messagesWithTransition, assistantMsg]);
      setCollectingMessages([assistantMsg]);
      if (data.fieldUpdates) setFormData(prev => deepMerge(prev, data.fieldUpdates));
      setEnumOptions(data.enumOptions ? { options: data.enumOptions, multiSelect: data.multiSelect ?? false } : null);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Sorry, couldn't load that schema: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (text) => {
    if (loading) return;
    const userMsg = { role: 'user', content: text };
    const nextMessages = [...messages, userMsg];
    const nextCollecting = [...collectingMessages, userMsg];
    setMessages(nextMessages);
    setCollectingMessages(nextCollecting);
    setEnumOptions(null);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema: selectedSchema, messages: nextCollecting, currentFormData: formData }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const assistantMsg = { role: 'assistant', content: data.message };
      setMessages([...nextMessages, assistantMsg]);
      setCollectingMessages([...nextCollecting, assistantMsg]);
      if (data.fieldUpdates) setFormData(prev => deepMerge(prev, data.fieldUpdates));
      setEnumOptions(data.enumOptions ? { options: data.enumOptions, multiSelect: data.multiSelect ?? false } : null);
      if (data.message.includes('All done') || data.message.includes('form is complete')) {
        setPhase('complete');
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Sorry, something went wrong: ${err.message}` }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!input.trim() || loading) return;

    if (phase === 'collecting') {
      const text = input.trim();
      setInput('');
      await sendMessage(text);
      return;
    }

    // discovery phase
    const userMessage = { role: 'user', content: input.trim() };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setSelectedSkill(null);
    setSkillDetail(null);

    try {
      const res = await fetch(`${API_BASE}/catalog/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages,
          ...(schemas.length > 0 ? { lockedSchemas: schemas } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setMessages([...nextMessages, { role: 'assistant', content: data.message }]);
      setSchemas(data.schemas ?? []);
    } catch (err) {
      setMessages([...nextMessages, { role: 'assistant', content: `Sorry, something went wrong: ${err.message}` }]);
      setSchemas([]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleNewChat = () => {
    setMessages([{ role: 'assistant', content: 'What would you like to do today?' }]);
    setSchemas([]);
    setPhase('discovery');
    setSelectedSchema(null);
    setFormData({});
    setCollectingMessages([]);
    setEnumOptions(null);
    setSelectedSkill(null);
    setSkillDetail(null);
    setInput('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateResult(null);
    setCatalogError(null);
    try {
      const res = await fetch(`${API_BASE}/catalog/generate`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGenerateResult(data);
      fetch(`${API_BASE}/catalog/status`).then(r => r.json()).then(setCatalogStatus).catch(() => {});
    } catch (err) {
      setCatalogError(`Generate failed: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  // Schema card — used inside the chat bubble area
  const SchemaCard = ({ match }) => {
    const conf = CONFIDENCE_COLORS[match.confidence] ?? CONFIDENCE_COLORS.low;
    const isClickable = phase === 'discovery';
    return (
      <div
        onClick={isClickable ? () => handleSchemaSelect(match) : undefined}
        style={{
          background: 'var(--glass-bg)',
          border: '1px solid var(--glass-border)',
          borderRadius: 'var(--radius-card)',
          padding: '0.75rem 1rem',
          backdropFilter: 'var(--card-backdrop)',
          cursor: isClickable ? 'pointer' : 'default',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.15rem' }}>
              {match.title}
            </div>
            <div style={{
              fontFamily: 'monospace',
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              marginBottom: '0.35rem',
              wordBreak: 'break-all',
            }}>
              {match.blobDir}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {match.reason}
            </div>
            {match.skills && match.skills.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.5rem' }}>
                {match.skills.map((skill, i) => {
                  const skillConf = CONFIDENCE_COLORS[skill.confidence] ?? CONFIDENCE_COLORS.low;
                  const isSelected = selectedSkill?.name === skill.name;
                  return (
                    <span
                      key={i}
                      onClick={() => selectSkill(skill)}
                      style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '999px',
                        fontSize: '0.7rem',
                        background: skillConf.bg,
                        border: `1px solid ${skillConf.border}`,
                        color: skillConf.text,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        cursor: 'pointer',
                        boxShadow: isSelected ? `0 0 0 2px ${skillConf.text}` : 'none',
                      }}
                    >
                      {skill.name}
                      {skill.category && (
                        <span style={{ opacity: 0.7, fontSize: '0.65rem' }}>{skill.category}</span>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <span style={{
            flexShrink: 0,
            padding: '0.15rem 0.5rem',
            borderRadius: '999px',
            fontSize: '0.68rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            background: conf.bg,
            color: conf.text,
            border: `1px solid ${conf.border}`,
          }}>
            {match.confidence}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div style={{
      height: '100vh',
      overflow: 'hidden',
      background: 'var(--bg-gradient)',
      color: 'var(--text-main)',
      fontFamily: '"Myriad Pro", "myriad-pro", -apple-system, BlinkMacSystemFont, "Aptos", "Segoe UI", sans-serif',
      padding: '2rem',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        maxWidth: (selectedSkill || schemas.length > 0 || phase !== 'discovery') ? 1100 : 720,
        margin: '0 auto',
        width: '100%',
        transition: 'max-width 0.2s ease',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      }}>
        <h1 style={{ marginBottom: '0.25rem', fontSize: '1.5rem', fontWeight: 700 }}>Skill Map</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          Describe what you want to do and I'll find the matching schemas and skills.
        </p>

        {/* Chat + skill panel row */}
        <div style={{ display: 'flex', gap: '1.5rem', flex: 1, minHeight: 0, overflow: 'hidden' }}>

          {/* Chat column */}
          <div className="chat-panel" style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.5rem 1rem 0',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {phase === 'collecting' ? selectedSchema?.title
                  : phase === 'complete' ? 'Complete'
                  : null}
              </span>
              <button
                onClick={handleNewChat}
                className="chat-send-btn"
                title="New chat"
                style={{ padding: '0.3rem' }}
              >
                <RotateCcw size={14} />
              </button>
            </div>
            <div className="chat-messages">
              {messages.map((msg, i) => (
                <div key={i} className={`chat-message chat-message--${msg.role}`}>
                  <div className="chat-avatar">
                    {msg.role === 'assistant' ? <Bot size={13} /> : <User size={13} />}
                  </div>
                  <div className="chat-bubble-wrap">
                    <div className="chat-bubble">{msg.content}</div>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="chat-message chat-message--assistant">
                  <div className="chat-avatar"><Bot size={13} /></div>
                  <div className="chat-bubble chat-thinking">
                    <span /><span /><span />
                  </div>
                </div>
              )}
              {phase === 'collecting' && enumOptions && !loading && (
                <div className="chat-enum-options">
                  {enumOptions.options.map((opt, i) => (
                    <button key={i} className="chat-enum-option" onClick={() => sendMessage(opt)}>
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="chat-input-row">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); } }}
                placeholder="Type a message…"
                disabled={loading || phase === 'complete' || (phase === 'collecting' && !!enumOptions)}
                autoFocus
                className="chat-input"
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim() || phase === 'complete' || (phase === 'collecting' && !!enumOptions)}
                className="chat-send-btn"
                title="Send"
              >
                <Send size={15} />
              </button>
            </div>
          </div>

          {/* Right panel — DynamicForm (collecting/complete) or schemas/skill-detail (discovery) */}
          {(phase !== 'discovery' || schemas.length > 0 || selectedSkill) && (
            <div style={{
              width: 320,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              overflowY: 'auto',
              height: '100%',
            }}>
              {phase !== 'discovery' ? (
                /* Form-filling: live form preview */
                <div style={{
                  background: 'var(--glass-bg)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: 'var(--radius-card)',
                  padding: '1rem 1.25rem',
                  backdropFilter: 'var(--card-backdrop)',
                }}>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.75rem' }}>
                    {selectedSchema?.title ?? 'Form'}
                  </div>
                  <DynamicForm schema={selectedSchema} data={formData} onChange={() => {}} />
                  {phase === 'complete' && (
                    <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#10b981', fontWeight: 500 }}>
                      Form complete
                    </div>
                  )}
                </div>
              ) : selectedSkill ? (
                /* Skill detail */
                <div style={{
                  background: 'var(--glass-bg)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: 'var(--radius-card)',
                  padding: '1rem 1.25rem',
                  backdropFilter: 'var(--card-backdrop)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.6rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', lineHeight: 1.3 }}>
                      {selectedSkill.name}
                    </div>
                    <button
                      onClick={() => { setSelectedSkill(null); setSkillDetail(null); }}
                      style={{
                        flexShrink: 0,
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: '1rem',
                        lineHeight: 1,
                        padding: '0 0.1rem',
                      }}
                      aria-label="Close skill panel"
                    >
                      ×
                    </button>
                  </div>
                  {selectedSkill.category && (() => {
                    const skillConf = CONFIDENCE_COLORS[selectedSkill.confidence] ?? CONFIDENCE_COLORS.medium;
                    return (
                      <span style={{
                        display: 'inline-block',
                        padding: '0.15rem 0.5rem',
                        borderRadius: '999px',
                        fontSize: '0.7rem',
                        background: skillConf.bg,
                        border: `1px solid ${skillConf.border}`,
                        color: skillConf.text,
                        marginBottom: '0.75rem',
                      }}>
                        {selectedSkill.category}
                      </span>
                    );
                  })()}
                  <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
                    {!skillDetail || skillDetail.loading ? (
                      <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        Looking up in knowledge base…
                      </span>
                    ) : skillDetail.error ? (
                      <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        Could not load description.
                      </span>
                    ) : skillDetail.docs.length === 0 ? (
                      <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        No knowledge base article found.
                      </span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {skillDetail.docs.map((doc, i) => (
                          <div key={i}>
                            <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.25rem' }}>
                              {doc.title}
                            </div>
                            {doc.summary && (
                              <div style={{ color: 'var(--text-muted)' }}>{doc.summary}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Schema cards */
                schemas.map((match) => (
                  <SchemaCard key={match.blobDir} match={match} />
                ))
              )}
            </div>
          )}
        </div>

        {/* Catalog Management — collapsible */}
        <details style={{ marginTop: '2.5rem' }}>
          <summary style={{
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'var(--text-muted)',
            userSelect: 'none',
            listStyle: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            paddingBottom: '0.75rem',
            borderTop: '1px solid var(--glass-border)',
            paddingTop: '0.75rem',
          }}>
            ▾ Catalog Management
          </summary>
          <div style={{ paddingTop: '0.75rem' }}>
            <div style={{ marginBottom: '1rem' }}>
              {catalogStatus === null && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Checking catalog status…</p>
              )}
              {catalogStatus?.exists === false && (
                <p style={{ fontSize: '0.85rem', margin: 0, color: '#f87171' }}>
                  No catalog found — generate it before searching.
                </p>
              )}
              {catalogStatus?.exists === true && (
                <p style={{ fontSize: '0.85rem', margin: 0, color: 'var(--text-muted)' }}>
                  Catalog last generated:{' '}
                  <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>
                    {new Date(catalogStatus.lastGenerated).toLocaleString()}
                  </span>
                </p>
              )}
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Run this once (or after schemas change) to build the enriched catalog used for intent routing.
              Takes around 30–60 seconds for 164 schemas.
            </p>
            <button
              onClick={handleGenerate}
              disabled={generating}
              style={{
                padding: '0.6rem 1.25rem',
                borderRadius: 'var(--radius-btn)',
                background: 'var(--glass-bg)',
                color: 'var(--text-main)',
                border: '1px solid var(--glass-border)',
                cursor: generating ? 'wait' : 'pointer',
                fontSize: '0.875rem',
                fontWeight: 500,
                opacity: generating ? 0.7 : 1,
              }}
            >
              {generating ? 'Generating… (this takes ~30-60s)' : 'Generate / Refresh Catalog'}
            </button>
            <button
              onClick={async () => {
                if (catalogPreview) { setCatalogPreview(null); return; }
                setPreviewLoading(true);
                try {
                  const res = await fetch(`${API_BASE}/catalog`);
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  setCatalogPreview(await res.json());
                } catch (err) {
                  setCatalogError(`Preview failed: ${err.message}`);
                } finally {
                  setPreviewLoading(false);
                }
              }}
              disabled={previewLoading}
              style={{
                marginLeft: '0.5rem',
                padding: '0.6rem 1.25rem',
                borderRadius: 'var(--radius-btn)',
                background: 'var(--glass-bg)',
                color: 'var(--text-main)',
                border: '1px solid var(--glass-border)',
                cursor: previewLoading ? 'wait' : 'pointer',
                fontSize: '0.875rem',
                fontWeight: 500,
                opacity: previewLoading ? 0.7 : 1,
              }}
            >
              {previewLoading ? 'Loading…' : catalogPreview ? 'Hide Preview' : 'Preview Catalog'}
            </button>

            {catalogError && (
              <div style={{
                marginTop: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-input)',
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                color: '#f87171',
                fontSize: '0.875rem',
              }}>
                {catalogError}
              </div>
            )}

            {catalogPreview && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                  {catalogPreview.length} entries
                </div>
                <pre style={{
                  maxHeight: 400,
                  overflowY: 'auto',
                  background: 'var(--glass-bg)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: 'var(--radius-input)',
                  padding: '1rem',
                  fontSize: '0.75rem',
                  lineHeight: 1.5,
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}>
                  {JSON.stringify(catalogPreview, null, 2)}
                </pre>
              </div>
            )}

            {generateResult && (
              <div style={{
                marginTop: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-input)',
                background: 'rgba(16,185,129,0.1)',
                border: '1px solid rgba(16,185,129,0.3)',
                color: '#10b981',
                fontSize: '0.875rem',
              }}>
                Done — {generateResult.generated} schemas catalogued.
                {generateResult.errors?.length > 0 && ` ${generateResult.errors.length} error(s).`}
              </div>
            )}
          </div>
        </details>

      </div>
    </div>
  );
}
