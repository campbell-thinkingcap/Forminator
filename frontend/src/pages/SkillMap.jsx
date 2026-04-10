import React, { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

const CONFIDENCE_COLORS = {
  high:   { bg: 'rgba(16,185,129,0.15)', text: '#10b981', border: 'rgba(16,185,129,0.3)' },
  medium: { bg: 'rgba(245,158,11,0.15)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
  low:    { bg: 'rgba(148,163,184,0.15)', text: '#94a3b8', border: 'rgba(148,163,184,0.3)' },
};

export default function SkillMap() {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState(null);
  const [catalogStatus, setCatalogStatus] = useState(null); // { exists, lastGenerated }
  const [catalogPreview, setCatalogPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setMatches(null);
    setSelectedSkill(null);
    try {
      const res = await fetch(`${API_BASE}/catalog/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });
      if (res.status === 404) {
        setError('Catalog not generated yet. Use the Generate button below to build it first.');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMatches(data.matches ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateResult(null);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/catalog/generate`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGenerateResult(data);
      // Refresh status to show updated timestamp
      fetch(`${API_BASE}/catalog/status`).then(r => r.json()).then(setCatalogStatus).catch(() => {});
    } catch (err) {
      setError(`Generate failed: ${err.message}`);
    } finally {
      setGenerating(false);
    }
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
      <div style={{ maxWidth: selectedSkill ? 1100 : 720, margin: '0 auto', transition: 'max-width 0.2s ease' }}>
        <h1 style={{ marginBottom: '0.25rem', fontSize: '1.5rem', fontWeight: 700 }}>Skill Map</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '0.9rem' }}>
          Describe what you want to do and find the matching skills and schemas.
        </p>

        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="e.g. I want to add a user, configure SAML, enrol someone in a course…"
            style={{
              flex: 1,
              padding: '0.65rem 1rem',
              borderRadius: 'var(--radius-input)',
              border: '1px solid var(--glass-border)',
              background: 'var(--input-bg)',
              color: 'var(--text-main)',
              fontSize: '0.95rem',
              outline: 'none',
            }}
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            style={{
              padding: '0.65rem 1.25rem',
              borderRadius: 'var(--radius-btn)',
              background: 'var(--primary)',
              color: '#fff',
              border: 'none',
              cursor: loading ? 'wait' : 'pointer',
              fontWeight: 600,
              fontSize: '0.9rem',
              opacity: loading || !query.trim() ? 0.6 : 1,
            }}
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>

        {error && (
          <div style={{
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-input)',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#f87171',
            marginBottom: '1.5rem',
            fontSize: '0.875rem',
          }}>
            {error}
          </div>
        )}

        {matches !== null && matches.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '2rem' }}>
            No matching schemas found. Try rephrasing your query.
          </div>
        )}

        {matches && matches.length > 0 && (
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '2rem', alignItems: 'flex-start' }}>
            {/* Schema cards */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem', minWidth: 0 }}>
              {matches.map((match) => {
                const conf = CONFIDENCE_COLORS[match.confidence] ?? CONFIDENCE_COLORS.low;
                return (
                  <div key={match.blobDir} style={{
                    background: 'var(--glass-bg)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 'var(--radius-card)',
                    padding: '1rem 1.25rem',
                    backdropFilter: 'var(--card-backdrop)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.2rem' }}>
                          {match.title}
                        </div>
                        <div style={{
                          fontFamily: 'monospace',
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                          marginBottom: '0.5rem',
                          wordBreak: 'break-all',
                        }}>
                          {match.blobDir}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          {match.reason}
                        </div>
                        {match.skills && match.skills.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.6rem' }}>
                            {match.skills.map((skill, i) => {
                              const skillConf = CONFIDENCE_COLORS[skill.confidence] ?? CONFIDENCE_COLORS.low;
                              const isSelected = selectedSkill?.name === skill.name;
                              return (
                                <span
                                  key={i}
                                  onClick={() => setSelectedSkill(isSelected ? null : skill)}
                                  style={{
                                    padding: '0.2rem 0.55rem',
                                    borderRadius: '999px',
                                    fontSize: '0.72rem',
                                    background: skillConf.bg,
                                    border: `1px solid ${skillConf.border}`,
                                    color: skillConf.text,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.35rem',
                                    cursor: 'pointer',
                                    boxShadow: isSelected ? `0 0 0 2px ${skillConf.text}` : 'none',
                                  }}
                                >
                                  {skill.name}
                                  {skill.category && (
                                    <span style={{ opacity: 0.7, fontSize: '0.68rem' }}>{skill.category}</span>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <span style={{
                        flexShrink: 0,
                        padding: '0.2rem 0.6rem',
                        borderRadius: '999px',
                        fontSize: '0.72rem',
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
              })}
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
                    onClick={() => setSelectedSkill(null)}
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
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {selectedSkill.description ?? selectedSkill.intent ?? (
                    <span style={{ fontStyle: 'italic' }}>No description available.</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '2rem 0' }} />

        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Catalog Management</h2>
          <div style={{ marginBottom: '1rem' }}>
            {catalogStatus === null && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Checking catalog status…</p>
            )}
            {catalogStatus?.exists === false && (
              <p style={{
                fontSize: '0.85rem', margin: 0,
                color: '#f87171',
              }}>
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
                setError(`Preview failed: ${err.message}`);
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
      </div>
    </div>
  );
}
