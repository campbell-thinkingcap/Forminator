import React, { useState } from 'react';
import axios from 'axios';
import { Database, Copy, Check, Search, AlertTriangle } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

const MATCH_BADGE = {
  exact:              <span style={{ color: '#10b981', fontSize: '0.7rem', fontWeight: 600 }}>exact</span>,
  'case-insensitive': <span style={{ color: '#818cf8', fontSize: '0.7rem', fontWeight: 600 }}>~case</span>,
  normalized:         <span style={{ color: '#f59e0b', fontSize: '0.7rem', fontWeight: 600 }}>~name</span>,
  unmatched:          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>none</span>,
};

function getScoreBadgeStyle(score) {
  return {
    fontSize: '0.72rem',
    fontWeight: 600,
    padding: '0.15rem 0.5rem',
    borderRadius: '1rem',
    background: score >= 70 ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
    color: score >= 70 ? '#10b981' : '#f59e0b',
    border: `1px solid ${score >= 70 ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`,
  };
}

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

  const isMultiTable = result && Array.isArray(result.tables);

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
            background: 'var(--input-bg)',
            border: '1px solid var(--glass-border)',
            borderRadius: '0.5rem',
            color: 'var(--text-main)',
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
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', paddingTop: '2rem' }}>
          {schema ? 'Select a database and click Analyze' : 'Load a schema first'}
        </div>
      )}

      {/* All-unmatched state */}
      {isMultiTable && result.tables.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', paddingTop: '2rem' }}>
          No matching tables found for this schema.
        </div>
      )}

      {/* Single-table results (legacy path — unchanged) */}
      {result && !isMultiTable && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Database size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {result.tableName}
            </span>
            <span style={{ marginLeft: 'auto', flexShrink: 0, ...getScoreBadgeStyle(result.score) }}>
              {result.score}% match
            </span>
          </div>

          <MappingTable mapping={result.mapping} />
          <SelectPane selectQuery={result.selectQuery} copied={copied} onCopy={handleCopy} showJoinWarning={false} />
        </>
      )}

      {/* Multi-table results */}
      {isMultiTable && result.tables.length > 0 && (
        <>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.9rem' }}>
            <Database size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>
              {result.tables.length} tables identified
            </span>
            <span style={{
              marginLeft: 'auto',
              flexShrink: 0,
              fontSize: '0.7rem',
              fontWeight: 600,
              padding: '0.15rem 0.5rem',
              borderRadius: '1rem',
              background: result.joinPossible ? 'rgba(129,140,248,0.15)' : 'rgba(245,158,11,0.15)',
              color: result.joinPossible ? '#818cf8' : '#f59e0b',
              border: `1px solid ${result.joinPossible ? 'rgba(129,140,248,0.3)' : 'rgba(245,158,11,0.3)'}`,
            }}>
              {result.joinPossible ? 'JOIN available' : 'JOIN: manual'}
            </span>
          </div>

          {/* Per-table sections */}
          {result.tables.map(t => (
            <div key={t.tableName} style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
                <Database size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.tableName}
                </span>
                <span style={{ marginLeft: 'auto', flexShrink: 0, ...getScoreBadgeStyle(t.score) }}>
                  {t.score}% match
                </span>
              </div>
              <MappingTable mapping={t.mapping} />
            </div>
          ))}

          {/* Unmatched props */}
          {result.unmatchedProps.length > 0 && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Unmatched: {result.unmatchedProps.join(', ')}
            </div>
          )}

          <SelectPane
            selectQuery={result.selectQuery}
            copied={copied}
            onCopy={handleCopy}
            showJoinWarning={!result.joinPossible}
          />
        </>
      )}
    </div>
  );
}

function MappingTable({ mapping }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', marginBottom: '0.75rem' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--glass-border)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <th style={{ textAlign: 'left', padding: '0.3rem 0.4rem', fontWeight: 600 }}>Schema field</th>
          <th style={{ textAlign: 'left', padding: '0.3rem 0.4rem', fontWeight: 600 }}>DB column</th>
          <th style={{ textAlign: 'center', padding: '0.3rem 0.4rem', fontWeight: 600 }}>Match</th>
        </tr>
      </thead>
      <tbody>
        {mapping.map(row => (
          <tr
            key={row.schemaProp}
            style={{ borderBottom: '1px solid var(--glass-border)', opacity: row.matchType === 'unmatched' ? 0.5 : 1 }}
          >
            <td style={{ padding: '0.3rem 0.4rem', fontFamily: 'monospace', color: 'var(--jh-key)' }}>
              {row.schemaProp}
            </td>
            <td style={{ padding: '0.3rem 0.4rem', fontFamily: 'monospace', color: row.matchType === 'unmatched' ? 'var(--text-muted)' : 'var(--accent)' }}>
              {row.dbColumn ?? '—'}
            </td>
            <td style={{ padding: '0.3rem 0.4rem', textAlign: 'center' }}>
              {MATCH_BADGE[row.matchType]}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SelectPane({ selectQuery, copied, onCopy, showJoinWarning }) {
  if (!selectQuery) return null;
  return (
    <div>
      <div style={{ position: 'relative' }}>
        <pre style={{
          background: 'var(--json-preview-bg)',
          border: '1px solid var(--glass-border)',
          borderRadius: 'var(--radius-input)',
          padding: '0.75rem 0.9rem',
          paddingRight: '4rem',
          fontSize: '0.72rem',
          fontFamily: 'monospace',
          color: 'var(--jh-string)',
          overflowX: 'auto',
          whiteSpace: 'pre',
          margin: 0,
          lineHeight: 1.6,
        }}>
          {selectQuery}
        </pre>
        <button
          onClick={onCopy}
          style={{
            position: 'absolute',
            top: '0.4rem',
            right: '0.4rem',
            padding: '0.25rem 0.5rem',
            fontSize: '0.7rem',
            borderRadius: '0.4rem',
            background: 'var(--chat-avatar-bg)',
            border: '1px solid var(--glass-border)',
            color: copied ? 'var(--accent)' : 'var(--text-muted)',
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
      {showJoinWarning && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          marginTop: '0.4rem',
          fontSize: '0.72rem',
          color: '#f59e0b',
        }}>
          <AlertTriangle size={12} />
          Join condition unknown — fill in ON clause manually
        </div>
      )}
    </div>
  );
}
