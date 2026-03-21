import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import DynamicForm from './components/DynamicForm';
import JsonHighlight from './components/JsonHighlight';
import { Code, FileJson, AlertCircle, Braces } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

function App() {
  const [schemas, setSchemas] = useState([]);
  const [selectedSchemaName, setSelectedSchemaName] = useState('');
  const [schema, setSchema] = useState(null);
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [splitPercent, setSplitPercent] = useState(60);
  const [activeField, setActiveField] = useState(null);
  const workspaceRef = useRef(null);

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
    fetchSchemas();
  }, []);

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
    try {
      const res = await axios.get(`${API_BASE}/schemas/${name}`);
      setSchema(res.data);
      setFormData({}); // Reset form
      setError(null);
    } catch (err) {
      setError('Failed to load schema.');
    } finally {
      setLoading(false);
    }
  };

  const handleFormChange = (newData) => {
    setFormData(newData);
  };

  return (
    <div className="app-shell">
      <header className="app-header fade-in">
        <div>
          <h1>Forminator</h1>
          <p className="subtitle">Dynamic Form Generator based on JSON Schema</p>
        </div>
        <div className="card header-selector">
          <FileJson size={20} color="#818cf8" />
          <select
            value={selectedSchemaName}
            onChange={(e) => handleSchemaSelect(e.target.value)}
          >
            <option value="" disabled>Select a schema...</option>
            {schemas.map(s => (
              <option key={s.name} value={s.name}>{s.name}.json</option>
            ))}
          </select>
        </div>
      </header>

      {error && (
        <div className="card fade-in error-banner">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      <div className="workspace" ref={workspaceRef}>
        <main className="form-column" style={{ width: `${splitPercent}%` }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem' }}>
              <div className="loader">Loading Schema...</div>
            </div>
          ) : schema ? (
            <div className="fade-in">
              <div className="card">
                <h2 style={{ marginBottom: '0.5rem' }}>{schema.title}</h2>
                <p className="description" style={{ marginBottom: '2rem' }}>{schema.description}</p>
                <DynamicForm
                  schema={schema}
                  data={formData}
                  onChange={handleFormChange}
                  onFieldFocus={setActiveField}
                />
              </div>

              <div className="json-preview fade-in">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: '#94a3b8' }}>
                  <Code size={18} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase' }}>Generated JSON Output</span>
                </div>
                <pre>{JSON.stringify(formData, null, 2)}</pre>
              </div>
            </div>
          ) : (
            !error && <div style={{ textAlign: 'center', color: 'var(--text-muted)', paddingTop: '3rem' }}>Select a schema to begin</div>
          )}
        </main>

        <div className="resizer" onMouseDown={onResizerMouseDown} />

        <aside className="schema-panel" style={{ width: `${100 - splitPercent}%` }}>
          <div className="schema-panel-header">
            <Braces size={16} />
            <span>Schema Definition</span>
          </div>
          <div className="schema-panel-body">
            {schema ? (
              <JsonHighlight value={schema} activeKey={activeField} />
            ) : (
              <span className="schema-panel-empty">No schema loaded</span>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;
