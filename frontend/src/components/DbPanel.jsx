import React, { useState } from 'react';
import axios from 'axios';
import { Database, Copy, Check, Search } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

const MATCH_BADGE = {
  exact:              <span style={{ color: '#10b981', fontSize: '0.7rem', fontWeight: 600 }}>exact</span>,
  'case-insensitive': <span style={{ color: '#818cf8', fontSize: '0.7rem', fontWeight: 600 }}>~case</span>,
  normalized:         <span style={{ color: '#f59e0b', fontSize: '0.7rem', fontWeight: 600 }}>~name</span>,
  unmatched:          <span style={{ color: '#475569', fontSize: '0.7rem' }}>none</span>,
};

export default function DbPanel({ schema }) {
  const [db, setDb] = useState('postgres');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleAnalyze = async () => {
    if (!schema) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await axios.post(`${API_BASE}/dbmeta/analyze`, { schema, db });
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(result.selectQuery);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const scoreBadgeStyle = result ? {
    fontSize: '0.72rem',
    fontWeight: 600,
    padding: '0.15rem 0.5rem',
    borderRadius: '1rem',
    background: result.score >= 70 ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
    color: result.score >= 70 ? '#10b981' : '#f59e0b',
    border: `1px solid ${result.score >= 70 ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`,
  } : {};

  return (
    <div style={{ padding: '0.75rem 0.9rem', overflowY: 'auto', flex: 1 }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
        <select
          value={db}
          onChange={e => setDb(e.target.value)}
          style={{
            flex: 1,
            padding: '0.4rem 0.6rem',
            fontSize: '0.82rem',
            background: 'var(--input-bg, rgba(255,255,255,0.05))',
            border: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
            borderRadius: '0.5rem',
            color: 'var(--text-main, #e2e8f0)',
          }}
        >
          <option value="postgres">PostgreSQL</option>
          <option value="sqlserver">SQL Server</option>
        </select>
        <button
          onClick={handleAnalyze}
          disabled={!schema || loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.4rem 0.9rem',
            fontSize: '0.82rem',
            borderRadius: '0.5rem',
            whiteSpace: 'nowrap',
          }}
        >
          <Search size={13} className={loading ? 'spin' : ''} />
          {loading ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          fontSize: '0.8rem',
          color: '#ef4444',
          padding: '0.5rem 0.7rem',
          background: 'rgba(239,68,68,0.08)',
          borderRadius: '0.5rem',
          border: '1px solid rgba(239,68,68,0.2)',
          marginBottom: '1rem',
        }}>
          {error}
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div style={{ color: 'var(--text-muted, #475569)', fontSize: '0.8rem', textAlign: 'center', paddingTop: '2rem' }}>
          {schema ? 'Select a database and click Analyze' : 'Load a schema first'}
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Table name + confidence badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Database size={14} style={{ color: '#818cf8', flexShrink: 0 }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {result.tableName}
            </span>
            <span style={{ marginLeft: 'auto', flexShrink: 0, ...scoreBadgeStyle }}>
              {result.score}% match
            </span>
          </div>

          {/* Field mapping table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', marginBottom: '1rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={{ textAlign: 'left', padding: '0.3rem 0.4rem', fontWeight: 600 }}>Schema field</th>
                <th style={{ textAlign: 'left', padding: '0.3rem 0.4rem', fontWeight: 600 }}>DB column</th>
                <th style={{ textAlign: 'center', padding: '0.3rem 0.4rem', fontWeight: 600 }}>Match</th>
              </tr>
            </thead>
            <tbody>
              {result.mapping.map(row => (
                <tr
                  key={row.schemaProp}
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: row.matchType === 'unmatched' ? 0.5 : 1 }}
                >
                  <td style={{ padding: '0.3rem 0.4rem', fontFamily: 'monospace', color: '#818cf8' }}>
                    {row.schemaProp}
                  </td>
                  <td style={{ padding: '0.3rem 0.4rem', fontFamily: 'monospace', color: row.matchType === 'unmatched' ? '#475569' : '#10b981' }}>
                    {row.dbColumn ?? '—'}
                  </td>
                  <td style={{ padding: '0.3rem 0.4rem', textAlign: 'center' }}>
                    {MATCH_BADGE[row.matchType]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* SELECT query */}
          <div style={{ position: 'relative' }}>
            <pre style={{
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '0.5rem',
              padding: '0.75rem 0.9rem',
              paddingRight: '4rem',
              fontSize: '0.72rem',
              fontFamily: 'monospace',
              color: '#10b981',
              overflowX: 'auto',
              whiteSpace: 'pre',
              margin: 0,
              lineHeight: 1.6,
            }}>
              {result.selectQuery}
            </pre>
            <button
              onClick={handleCopy}
              style={{
                position: 'absolute',
                top: '0.4rem',
                right: '0.4rem',
                padding: '0.25rem 0.5rem',
                fontSize: '0.7rem',
                borderRadius: '0.4rem',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: copied ? '#10b981' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                cursor: 'pointer',
              }}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
