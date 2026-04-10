import React, { useState, useEffect, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

const CONFIDENCE_COLORS = {
  high:   { bg: 'rgba(16,185,129,0.15)', text: '#10b981', border: 'rgba(16,185,129,0.3)' },
  medium: { bg: 'rgba(245,158,11,0.15)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
  low:    { bg: 'rgba(148,163,184,0.15)', text: '#94a3b8', border: 'rgba(148,163,184,0.3)' },
};

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

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = { role: 'user', content: input.trim() };
    const nextMessages = [...messages, userMessage];
    setMessages([...nextMessages, { role: 'assistant', content: '…', loading: true }]);
    setInput('');
    setLoading(true);
    setSelectedSkill(null);
    setSkillDetail(null);

    try {
      const res = await fetch(`${API_BASE}/catalog/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
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
    return (
      <div style={{
        background: 'var(--glass-bg)',
        border: '1px solid var(--glass-border)',
        borderRadius: 'var(--radius-card)',
        padding: '0.75rem 1rem',
        backdropFilter: 'var(--card-backdrop)',
      }}>
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

  const isLastAssistant = (index) => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i === index;
    }
    return false;
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-gradient)',
      color: 'var(--text-main)',
      fontFamily: '"Myriad Pro", "myriad-pro", -apple-system, BlinkMacSystemFont, "Aptos", "Segoe UI", sans-serif',
      padding: '2rem',
      boxSizing: 'border-box',
    }}>
      <div style={{
        maxWidth: selectedSkill ? 1100 : 720,
        margin: '0 auto',
        transition: 'max-width 0.2s ease',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 'calc(100vh - 4rem)',
      }}>
        <h1 style={{ marginBottom: '0.25rem', fontSize: '1.5rem', fontWeight: 700 }}>Skill Map</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          Describe what you want to do and I'll find the matching schemas and skills.
        </p>

        {/* Chat + skill panel row */}
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flex: 1 }}>

          {/* Chat column */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>

            {/* Message list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
              {messages.map((msg, i) => {
                const isUser = msg.role === 'user';
                const isLoading = msg.loading;
                const showSchemas = !isUser && isLastAssistant(i) && !isLoading && schemas.length > 0;
                return (
                  <div key={i}>
                    {/* Bubble */}
                    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '80%',
                        padding: '0.65rem 1rem',
                        borderRadius: isUser ? '1.2rem 1.2rem 0.25rem 1.2rem' : '1.2rem 1.2rem 1.2rem 0.25rem',
                        background: isUser ? 'var(--primary)' : 'var(--glass-bg)',
                        border: isUser ? 'none' : '1px solid var(--glass-border)',
                        color: isUser ? '#fff' : 'var(--text-main)',
                        fontSize: '0.9rem',
                        lineHeight: 1.55,
                        backdropFilter: isUser ? undefined : 'var(--card-backdrop)',
                        fontStyle: isLoading ? 'italic' : undefined,
                        opacity: isLoading ? 0.6 : 1,
                      }}>
                        {msg.content}
                      </div>
                    </div>

                    {/* Schema cards below last assistant message */}
                    {showSchemas && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                        {schemas.map((match) => (
                          <SchemaCard key={match.blobDir} match={match} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {/* Input bar */}
            <form onSubmit={handleSend} style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Type a message…"
                disabled={loading}
                autoFocus
                style={{
                  flex: 1,
                  padding: '0.65rem 1rem',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--glass-border)',
                  background: 'var(--input-bg)',
                  color: 'var(--text-main)',
                  fontSize: '0.95rem',
                  outline: 'none',
                  opacity: loading ? 0.6 : 1,
                }}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                style={{
                  padding: '0.65rem 1.25rem',
                  borderRadius: 'var(--radius-btn)',
                  background: 'var(--primary)',
                  color: '#fff',
                  border: 'none',
                  cursor: loading ? 'wait' : 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  opacity: loading || !input.trim() ? 0.6 : 1,
                }}
              >
                Send
              </button>
            </form>
          </div>

          {/* Skill detail panel */}
          {selectedSkill && (
            <div style={{
              width: 280,
              flexShrink: 0,
              position: 'sticky',
              top: '2rem',
              alignSelf: 'flex-start',
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
