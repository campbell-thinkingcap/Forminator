import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import DynamicForm from './components/DynamicForm';
import JsonHighlight from './components/JsonHighlight';
import ApiDocs from './components/ApiDocs';
import SchemaTree from './components/SchemaTree';
import LoginPage from './components/LoginPage';
import ChatPanel from './components/ChatPanel';
import EditPanel from './components/EditPanel';
import { Code, FileJson, AlertCircle, Braces, ExternalLink, BookOpen, LayoutTemplate, LogOut, MessageSquare, Wand2, RotateCcw } from 'lucide-react';

function getConstDefaults(schema) {
  if (!schema?.properties) return {};
  const defaults = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    if ('const' in prop) {
      defaults[key] = prop.const;
    } else if (prop.type === 'object') {
      const nested = getConstDefaults(prop);
      if (Object.keys(nested).length > 0) defaults[key] = nested;
    }
  }
  return defaults;
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key])
    ) {
      result[key] = deepMerge(result[key] ?? {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('forminator_user')) ?? null; } catch { return null; }
  });
  const [schemas, setSchemas] = useState([]);
  const [selectedSchemaName, setSelectedSchemaName] = useState('');
  const [schema, setSchema] = useState(null);
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [splitPercent, setSplitPercent] = useState(40);
  const [activeField, setActiveField] = useState(null);
  const [view, setView] = useState('form');
  const [leftPanel, setLeftPanel] = useState('schema');
  const [formTab, setFormTab] = useState('form');
  const [selectedBlobDir, setSelectedBlobDir] = useState(null);
  const workspaceRef = useRef(null);
  const originalSchemaRef = useRef(null);

  const login = (u) => { localStorage.setItem('forminator_user', JSON.stringify(u)); setUser(u); };
  const logout = () => { localStorage.removeItem('forminator_user'); setUser(null); };

  const onResizerMouseDown = useCallback((e) => {
    e.preventDefault();

    const onMouseMove = (e) => {
      const rect = workspaceRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Math.max(20, Math.min(80, pct)));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  useEffect(() => {
    if (user) fetchSchemas();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!user) {
    return <LoginPage onLogin={login} />;
  }

  const fetchSchemas = async () => {
    try {
      const res = await axios.get(`${API_BASE}/schemas`);
      setSchemas(res.data);
      if (res.data.length > 0) {
        handleSchemaSelect(res.data[0].name);
      }
    } catch (err) {
      setError('Failed to connect to backend server.');
    }
  };

  const handleSchemaSelect = async (name) => {
    setLoading(true);
    setSelectedSchemaName(name);
    setLeftPanel('schema');
    try {
      const res = await axios.get(`${API_BASE}/schemas/${name}`);
      originalSchemaRef.current = res.data;
      setSchema(res.data);
      setFormData(getConstDefaults(res.data));
      setFormTab('form');
      setError(null);
    } catch (err) {
      setError('Failed to load schema.');
    } finally {
      setLoading(false);
    }
  };

  const handleFieldUpdates = (updates) => {
    setFormData(prev => deepMerge(prev, updates));
  };

  const handleFormChange = (newData) => {
    setFormData(newData);
  };

  const handleSchemaEdit = (newSchema) => {
    setSchema(newSchema);
    setFormData(getConstDefaults(newSchema));
  };

  const handleSchemaReset = () => {
    if (originalSchemaRef.current) {
      setSchema(originalSchemaRef.current);
      setFormData(getConstDefaults(originalSchemaRef.current));
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header fade-in">
        <div>
          <h1>Forminator</h1>
          <p className="subtitle">Dynamic Form Generator based on JSON Schema</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            className={view === 'form' ? '' : 'secondary'}
            onClick={() => setView('form')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', fontSize: '0.85rem' }}
          >
            <LayoutTemplate size={15} /> Form
          </button>
          <button
            className={view === 'docs' ? '' : 'secondary'}
            onClick={() => setView('docs')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', fontSize: '0.85rem' }}
          >
            <BookOpen size={15} /> API Docs
          </button>
          <div className="user-pill">
            {user.picture && <img src={user.picture} alt={user.name} className="user-avatar" referrerPolicy="no-referrer" />}
            <span className="user-name">{user.name}</span>
            <button
              className="secondary sign-out-btn"
              onClick={logout}
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="card fade-in error-banner">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, minHeight: 0 }}>
        <SchemaTree
          selectedBlobDir={selectedBlobDir}
          onSelect={async (azureSchema) => {
            setSelectedBlobDir(azureSchema.blobDir);
            setLoading(true);
            setView('form');
            try {
              const res = await axios.get(`${API_BASE}/azure/schemas/${azureSchema.blobDir}`);
              originalSchemaRef.current = res.data;
              setSchema(res.data);
              setSelectedSchemaName(azureSchema.blobDir);
              setFormData(getConstDefaults(res.data));
              setFormTab('form');
              setError(null);
            } catch {
              setError('Failed to load Azure schema.');
            } finally {
              setLoading(false);
            }
          }}
        />

        {view === 'docs' && (
          <div style={{ flex: 1, minWidth: 0, padding: '0 0.5rem' }}>
            <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <FileJson size={16} color="#818cf8" />
              <select
                value={selectedSchemaName}
                onChange={(e) => handleSchemaSelect(e.target.value)}
                style={{ width: 'auto', minWidth: '180px', padding: '0.4rem 0.75rem', fontSize: '0.85rem', borderRadius: '0.5rem' }}
              >
                <option value="" disabled>Select a schema...</option>
                {schemas.map(s => (
                  <option key={s.name} value={s.name}>{s.name}.json</option>
                ))}
              </select>
            </div>
            <ApiDocs schema={schema} schemaName={selectedSchemaName} apiBase={API_BASE} />
          </div>
        )}

        <div className="workspace" ref={workspaceRef} style={{ display: view === 'form' ? 'flex' : 'none', flex: 1, minWidth: 0 }}>
        <aside className="schema-panel" style={{ width: `${splitPercent}%` }}>
          <div className="schema-panel-header">
            <div className="panel-tabs">
              <button
                className={`panel-tab${leftPanel === 'schema' ? ' panel-tab--active' : ''}`}
                onClick={() => setLeftPanel('schema')}
              >
                <Braces size={13} /> Schema
              </button>
              <button
                className={`panel-tab${leftPanel === 'chat' ? ' panel-tab--active' : ''}`}
                onClick={() => setLeftPanel('chat')}
              >
                <MessageSquare size={13} /> Chat
              </button>
              <button
                className={`panel-tab${leftPanel === 'edit' ? ' panel-tab--active' : ''}`}
                onClick={() => setLeftPanel('edit')}
              >
                <Wand2 size={13} /> Edit
              </button>
            </div>
          </div>
          <div className="schema-panel-body">
            {leftPanel === 'schema' && (
              schema
                ? <JsonHighlight value={schema} activeKey={activeField} />
                : <span className="schema-panel-empty">No schema loaded</span>
            )}
            {leftPanel === 'chat' && (
              <ChatPanel
                schema={schema}
                currentFormData={formData}
                onFieldUpdates={handleFieldUpdates}
              />
            )}
            {leftPanel === 'edit' && (
              <>
                {schema && schema !== originalSchemaRef.current && (
                  <div className="edit-panel-reset-bar">
                    <span className="edit-panel-reset-label">Schema has unsaved edits</span>
                    <button className="secondary edit-panel-reset-btn" onClick={handleSchemaReset}>
                      <RotateCcw size={12} /> Reset
                    </button>
                  </div>
                )}
                <EditPanel schema={schema} onSchemaEdit={handleSchemaEdit} />
              </>
            )}
          </div>
        </aside>

        <div className="resizer" onMouseDown={onResizerMouseDown} />

        <main className="form-column" style={{ width: `${100 - splitPercent}%`, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem' }}>
              <div className="loader">Loading Schema...</div>
            </div>
          ) : schema ? (
            <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div className="form-tab-bar">
                <button
                  className={`panel-tab${formTab === 'form' ? ' panel-tab--active' : ''}`}
                  onClick={() => setFormTab('form')}
                >
                  <LayoutTemplate size={13} /> Form
                </button>
                <button
                  className={`panel-tab${formTab === 'json' ? ' panel-tab--active' : ''}`}
                  onClick={() => setFormTab('json')}
                >
                  <Code size={13} /> JSON
                </button>
                <a
                  href={`${API_BASE}/data/${selectedSchemaName}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: '#818cf8', textDecoration: 'none' }}
                >
                  <ExternalLink size={13} /> API
                </a>
              </div>

              {formTab === 'form' && (
                <div className="card fade-in">
                  <h2 style={{ marginBottom: '0.25rem' }}>{schema.title}</h2>
                  <p className="description" style={{ marginBottom: '2rem' }}>{schema.description}</p>
                  <DynamicForm
                    schema={schema}
                    data={formData}
                    onChange={handleFormChange}
                    onFieldFocus={setActiveField}
                  />
                </div>
              )}

              {formTab === 'json' && (
                <div className="json-preview fade-in">
                  <pre>{JSON.stringify(formData, null, 2)}</pre>
                </div>
              )}
            </div>
          ) : (
            !error && <div style={{ textAlign: 'center', color: 'var(--text-muted)', paddingTop: '3rem' }}>Select a schema to begin</div>
          )}
        </main>
        </div>
      </div>
    </div>
  );
}

export default App;
