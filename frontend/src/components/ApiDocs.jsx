import React, { useState } from 'react';
import { Copy, Check, Terminal } from 'lucide-react';

const ENDPOINTS = [
  { method: 'GET',    suffix: '',     description: 'List all records',             body: false },
  { method: 'POST',   suffix: '',     description: 'Create a record (validated)',  body: true  },
  { method: 'GET',    suffix: '/:id', description: 'Get a record by ID',           body: false },
  { method: 'PUT',    suffix: '/:id', description: 'Replace a record (validated)', body: true  },
  { method: 'PATCH',  suffix: '/:id', description: 'Partially update a record',    body: true  },
  { method: 'DELETE', suffix: '/:id', description: 'Delete a record → 204',        body: false },
];

const METHOD_COLOR = {
  GET:    '#10b981',
  POST:   '#818cf8',
  PUT:    '#f59e0b',
  PATCH:  '#06b6d4',
  DELETE: '#ef4444',
};

function buildSampleBody(schema) {
  if (!schema?.properties) return {};
  const sample = {};
  for (const [key, def] of Object.entries(schema.properties)) {
    if (def.enum) { sample[key] = def.enum[0]; continue; }
    const type = Array.isArray(def.type)
      ? def.type.find(t => t !== 'null') ?? def.type[0]
      : def.type;
    if (type === 'string')        sample[key] = def.format === 'uuid' ? '00000000-0000-0000-0000-000000000000' : 'string';
    else if (type === 'boolean')  sample[key] = def.default ?? false;
    else if (type === 'integer' || type === 'number') sample[key] = def.default ?? 0;
    else if (type === 'array')    sample[key] = [];
    else if (type === 'object')   sample[key] = {};
  }
  return sample;
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      title="Copy"
      style={{
        background: 'rgba(255,255,255,0.07)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '0.4rem',
        padding: '0.25rem 0.5rem',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '0.3rem',
        fontSize: '0.7rem',
        color: copied ? '#10b981' : '#94a3b8',
        transition: 'color 0.2s',
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CodeBlock({ code }) {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: '0.6rem', right: '0.6rem' }}>
        <CopyBtn text={code} />
      </div>
      <pre style={{
        background: '#000',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '0.75rem',
        padding: '1rem 1rem 1rem 1.2rem',
        fontFamily: "'Courier New', monospace",
        fontSize: '0.78rem',
        color: '#10b981',
        overflowX: 'auto',
        whiteSpace: 'pre',
        lineHeight: 1.6,
      }}>{code}</pre>
    </div>
  );
}

function MethodBadge({ method }) {
  return (
    <span style={{
      display: 'inline-block',
      minWidth: '3.8rem',
      textAlign: 'center',
      padding: '0.15rem 0.5rem',
      borderRadius: '0.35rem',
      fontSize: '0.7rem',
      fontWeight: 700,
      letterSpacing: '0.05em',
      background: `${METHOD_COLOR[method]}22`,
      color: METHOD_COLOR[method],
      border: `1px solid ${METHOD_COLOR[method]}55`,
    }}>
      {method}
    </span>
  );
}

export default function ApiDocs({ schema, schemaName, apiBase }) {
  const [openCurl, setOpenCurl] = useState(null);

  if (!schema) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-muted)', paddingTop: '3rem' }}>
        Select a schema to view its API docs
      </div>
    );
  }

  const base = `${apiBase}/data/${schemaName}`;
  const sample = buildSampleBody(schema);
  const sampleJson = JSON.stringify(sample, null, 2);

  function curlFor({ method, suffix }) {
    const url = `${base}${suffix.replace(':id', '{id}')}`;
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
    const lines = [`curl -X ${method} "${url}"`];
    if (hasBody) {
      lines.push(`  -H "Content-Type: application/json"`);
      lines.push(`  -d '${sampleJson}'`);
    }
    return lines.join(' \\\n');
  }

  return (
    <div className="fade-in" style={{ maxWidth: '860px', margin: '0 auto' }}>

      {/* Schema header */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginBottom: '0.4rem' }}>{schema.title}</h2>
        <p className="description">{schema.description}</p>
        <div style={{ marginTop: '1rem', padding: '0.5rem 0.8rem', background: 'rgba(0,0,0,0.3)', borderRadius: '0.5rem', fontFamily: 'monospace', fontSize: '0.8rem', color: '#818cf8' }}>
          Base URL: <span style={{ color: '#e2e8f0' }}>{base}</span>
        </div>
      </div>

      {/* Endpoints table */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '0', overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <Terminal size={14} />
          Endpoints
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <th style={{ padding: '0.6rem 1.5rem', textAlign: 'left', fontWeight: 600 }}>Method</th>
              <th style={{ padding: '0.6rem 1rem', textAlign: 'left', fontWeight: 600 }}>Path</th>
              <th style={{ padding: '0.6rem 1rem', textAlign: 'left', fontWeight: 600 }}>Description</th>
              <th style={{ padding: '0.6rem 1.5rem', textAlign: 'left', fontWeight: 600 }}>Body</th>
              <th style={{ padding: '0.6rem 1rem' }}></th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map((ep, i) => {
              const key = `${ep.method}${ep.suffix}`;
              const isOpen = openCurl === key;
              return (
                <React.Fragment key={key}>
                  <tr
                    style={{
                      borderTop: '1px solid rgba(255,255,255,0.05)',
                      background: isOpen ? 'rgba(99,102,241,0.05)' : undefined,
                      cursor: 'pointer',
                    }}
                    onClick={() => setOpenCurl(isOpen ? null : key)}
                  >
                    <td style={{ padding: '0.75rem 1.5rem' }}>
                      <MethodBadge method={ep.method} />
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.8rem', color: '#e2e8f0' }}>
                      /api/data/{schemaName}{ep.suffix}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.85rem', color: '#94a3b8' }}>
                      {ep.description}
                    </td>
                    <td style={{ padding: '0.75rem 1.5rem', fontSize: '0.75rem', color: ep.body ? '#10b981' : '#334155' }}>
                      {ep.body ? 'JSON' : '—'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.7rem', color: '#64748b' }}>
                      {isOpen ? '▲ curl' : '▼ curl'}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr style={{ background: 'rgba(0,0,0,0.3)' }}>
                      <td colSpan={5} style={{ padding: '1rem 1.5rem' }}>
                        <CodeBlock code={curlFor(ep)} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Properties reference */}
      {schema.properties && (
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--glass-border)', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Request Body Fields
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '0.6rem 1.5rem', textAlign: 'left', fontWeight: 600 }}>Field</th>
                <th style={{ padding: '0.6rem 1rem', textAlign: 'left', fontWeight: 600 }}>Type</th>
                <th style={{ padding: '0.6rem 1rem', textAlign: 'left', fontWeight: 600 }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(schema.properties).map(([key, def]) => {
                const type = Array.isArray(def.type) ? def.type.join(' | ') : (def.type || '');
                const format = def.format ? ` (${def.format})` : '';
                const enumVals = def.enum ? ` [${def.enum.slice(0, 3).join(', ')}${def.enum.length > 3 ? '…' : ''}]` : '';
                return (
                  <tr key={key} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.65rem 1.5rem', fontFamily: 'monospace', fontSize: '0.8rem', color: '#818cf8' }}>
                      {key}
                    </td>
                    <td style={{ padding: '0.65rem 1rem', fontSize: '0.75rem', color: '#f59e0b', whiteSpace: 'nowrap' }}>
                      {type}{format}{enumVals}
                    </td>
                    <td style={{ padding: '0.65rem 1rem', fontSize: '0.8rem', color: '#94a3b8' }}>
                      {def.description || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
