import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight, ChevronLeft, ChevronDown, FileJson, FolderOpen, Folder, RefreshCw, X, Clock, History } from 'lucide-react';
import JsonHighlight from './JsonHighlight';

const AZURE_API = `${import.meta.env.VITE_API_BASE ?? '/api'}/azure`;

// Build a recursive tree from the flat schemas list using blobDir as path
function buildTree(schemas) {
  const root = [];

  for (const schema of schemas) {
    const parts = schema.blobDir.split('/');
    let level = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      let node = level.find(n => n.key === part);

      if (!node) {
        node = {
          key: part,
          label: part.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          children: [],
          schema: null,
        };
        level.push(node);
      }

      if (isLeaf) node.schema = schema;
      level = node.children;
    }
  }

  return root;
}

function TreeNode({ node, depth = 0, selectedBlobDir, onSelect, onViewHistory }) {
  const isLeaf = node.schema !== null && node.children.length === 0;
  const isFolder = node.children.length > 0;
  const [open, setOpen] = useState(depth === 0);
  const isSelected = node.schema?.blobDir === selectedBlobDir;

  const indent = depth * 12;

  if (isLeaf) {
    return (
      <div
        onClick={() => onSelect(node.schema)}
        onContextMenu={(e) => {
          e.preventDefault();
          onViewHistory(node.schema, e.clientX, e.clientY);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          padding: '0.25rem 0.5rem 0.25rem 0',
          paddingLeft: `${indent + 20}px`,
          cursor: 'pointer',
          borderRadius: '0.35rem',
          fontSize: '0.75rem',
          color: isSelected ? '#e2e8f0' : '#94a3b8',
          background: isSelected ? 'rgba(99,102,241,0.2)' : 'transparent',
          transition: 'background 0.1s, color 0.1s',
          userSelect: 'none',
        }}
        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
      >
        <FileJson size={12} color={isSelected ? '#818cf8' : '#475569'} style={{ flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.label}
        </span>
      </div>
    );
  }

  return (
    <div>
      <div
        onClick={() => isFolder && setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.3rem',
          padding: '0.25rem 0.5rem 0.25rem 0',
          paddingLeft: `${indent}px`,
          cursor: isFolder ? 'pointer' : 'default',
          borderRadius: '0.35rem',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#64748b',
          userSelect: 'none',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#94a3b8'; }}
        onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; }}
      >
        <span style={{ display: 'flex', alignItems: 'center', width: 14, flexShrink: 0 }}>
          {isFolder && (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
        </span>
        {open ? <FolderOpen size={13} color="#818cf8" style={{ flexShrink: 0 }} /> : <Folder size={13} color="#475569" style={{ flexShrink: 0 }} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.label}
        </span>
        {isFolder && (
          <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: '#334155', flexShrink: 0, paddingRight: '0.25rem' }}>
            {node.children.length}
          </span>
        )}
      </div>
      {open && (
        <div>
          {node.children.map(child => (
            <TreeNode
              key={child.key}
              node={child}
              depth={depth + 1}
              selectedBlobDir={selectedBlobDir}
              onSelect={onSelect}
              onViewHistory={onViewHistory}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SchemaTree({ onSelect, selectedBlobDir }) {
  const [status, setStatus] = useState('idle');
  const [tree, setTree] = useState([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  const [contextMenu, setContextMenu] = useState(null); // { schema, x, y }
  const [historyModal, setHistoryModal] = useState(null); // { schema, archives } | 'loading'
  const [selectedArchive, setSelectedArchive] = useState(null); // archive entry
  const [preview, setPreview] = useState(null); // { content: string } | 'loading' | 'error'
  const [rollingBack, setRollingBack] = useState(null); // archive.path being rolled back
  const contextMenuRef = useRef(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch(`${AZURE_API}/schemas`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTree(buildTree(data.schemas || []));
      setTotal(data.total || 0);
      setStatus('ok');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenu]);

  // Close context menu on Escape
  useEffect(() => {
    if (!contextMenu && !historyModal) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setHistoryModal(null);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [contextMenu, historyModal]);

  const handleViewHistory = useCallback(async (schema, x, y) => {
    setContextMenu({ schema, x, y });
  }, []);

  const openHistory = useCallback(async (schema) => {
    setContextMenu(null);
    setSelectedArchive(null);
    setPreview(null);
    setHistoryModal('loading');
    try {
      const res = await fetch(`${AZURE_API}/history/${schema.blobDir}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHistoryModal({ schema, archives: data.archives });
    } catch {
      setHistoryModal({ schema, archives: null });
    }
  }, []);

  const selectArchive = useCallback(async (archive) => {
    setSelectedArchive(archive);
    setPreview('loading');
    try {
      const res = await fetch(`${AZURE_API}/blob?path=${encodeURIComponent(archive.path)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      try { setPreview({ content: JSON.parse(text) }); }
      catch { setPreview({ content: text, raw: true }); }
    } catch {
      setPreview('error');
    }
  }, []);

  const handleRollback = useCallback(async (archive) => {
    if (!historyModal || historyModal === 'loading') return;
    setRollingBack(archive.path);
    try {
      const res = await fetch(`${AZURE_API}/rollback/${historyModal.schema.blobDir}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivePath: archive.path }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Reload the schema in the app, then close
      onSelect(historyModal.schema);
      setHistoryModal(null);
      setSelectedArchive(null);
      setPreview(null);
    } catch {
      // Leave modal open so user can see it failed
    } finally {
      setRollingBack(null);
    }
  }, [historyModal, onSelect]);

  const filteredTree = filter.trim() ? flatFilter(tree, filter.toLowerCase()) : tree;

  return (
    <>
      <PanelShell collapsed={collapsed} onToggle={() => setCollapsed(c => !c)}>
        {status === 'loading' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b', fontSize: '0.75rem', padding: '1rem' }}>
            <RefreshCw size={13} className="spin" /> Loading schemas...
          </div>
        ) : status === 'error' ? (
          <div style={{ padding: '1rem', color: '#ef4444', fontSize: '0.72rem' }}>
            Failed to reach Azure schemas.
            <button onClick={load} style={{ marginTop: '0.5rem', fontSize: '0.72rem', padding: '0.3rem 0.6rem', display: 'block' }}>
              Retry
            </button>
          </div>
        ) : (
          <>
            <div style={{ padding: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'relative' }}>
              <input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder={`Search ${total} schemas...`}
                style={{ fontSize: '0.72rem', padding: '0.3rem 1.4rem 0.3rem 0.6rem', borderRadius: '0.4rem', width: '100%' }}
              />
              {filter && (
                <button
                  onClick={() => setFilter('')}
                  title="Clear search"
                  style={{
                    position: 'absolute',
                    right: '0.75rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    borderRadius: '50%',
                  }}
                >
                  <X size={11} />
                </button>
              )}
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '0.4rem 0.5rem' }}>
              {filteredTree.map(node => (
                <TreeNode
                  key={node.key}
                  node={node}
                  depth={0}
                  selectedBlobDir={selectedBlobDir}
                  onSelect={onSelect}
                  onViewHistory={handleViewHistory}
                />
              ))}
            </div>
          </>
        )}
      </PanelShell>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 1000,
            background: '#13131a',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '0.5rem',
            padding: '0.3rem',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            minWidth: '150px',
          }}
        >
          <button
            onClick={() => openHistory(contextMenu.schema)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              width: '100%',
              padding: '0.4rem 0.6rem',
              background: 'none',
              border: 'none',
              borderRadius: '0.35rem',
              color: '#94a3b8',
              fontSize: '0.78rem',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            <History size={13} />
            View history
          </button>
        </div>
      )}

      {/* History modal */}
      {historyModal && (
        <div
          onClick={() => { setHistoryModal(null); setSelectedArchive(null); setPreview(null); }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#13131a',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '0.75rem',
              width: '860px',
              maxWidth: '95vw',
              height: '72vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.85rem 1rem',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Clock size={14} color="#818cf8" />
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e2e8f0' }}>
                  {historyModal === 'loading' ? 'Loading…' : historyModal.schema.blobDir}
                </span>
              </div>
              <button
                onClick={() => { setHistoryModal(null); setSelectedArchive(null); setPreview(null); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', display: 'flex', alignItems: 'center', padding: '0.15rem', borderRadius: '0.3rem' }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Body — split pane */}
            <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
              {/* Left: version list */}
              <div style={{ width: '260px', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.08)', overflowY: 'auto', padding: '0.5rem 0' }}>
                {historyModal === 'loading' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b', fontSize: '0.75rem', padding: '1.25rem 1rem' }}>
                    <RefreshCw size={13} className="spin" /> Loading…
                  </div>
                ) : historyModal.archives === null ? (
                  <div style={{ color: '#ef4444', fontSize: '0.75rem', padding: '1.25rem 1rem' }}>
                    Failed to load history.
                  </div>
                ) : historyModal.archives.length === 0 ? (
                  <div style={{ color: '#475569', fontSize: '0.75rem', padding: '1.25rem 1rem' }}>
                    No history yet — archived versions will appear here after saving edits.
                  </div>
                ) : (
                  historyModal.archives.map((archive) => {
                    const isSelected = selectedArchive?.path === archive.path;
                    const isRollingBack = rollingBack === archive.path;
                    return (
                      <div
                        key={archive.path}
                        onClick={() => selectArchive(archive)}
                        style={{
                          padding: '0.55rem 0.75rem',
                          cursor: 'pointer',
                          background: isSelected ? 'rgba(99,102,241,0.15)' : 'transparent',
                          borderLeft: isSelected ? '2px solid #818cf8' : '2px solid transparent',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <div style={{ fontSize: '0.75rem', color: isSelected ? '#c7d2fe' : '#94a3b8', marginBottom: '0.2rem' }}>
                          {new Date(archive.lastModified).toLocaleString(undefined, {
                            year: 'numeric', month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </div>
                        <div style={{ fontSize: '0.65rem', color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '0.35rem' }}>
                          {archive.name}
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); handleRollback(archive); }}
                          disabled={!!rollingBack}
                          style={{
                            fontSize: '0.68rem',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '0.3rem',
                            background: isRollingBack ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.1)',
                            border: '1px solid rgba(99,102,241,0.3)',
                            color: rollingBack && !isRollingBack ? '#334155' : '#818cf8',
                            cursor: rollingBack ? 'default' : 'pointer',
                            opacity: rollingBack && !isRollingBack ? 0.4 : 1,
                          }}
                        >
                          {isRollingBack ? 'Rolling back…' : 'Rollback'}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Right: preview */}
              <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '0.75rem 1rem' }}>
                {!selectedArchive ? (
                  <div style={{ color: '#334155', fontSize: '0.78rem', paddingTop: '1rem' }}>
                    Select a version on the left to preview it.
                  </div>
                ) : preview === 'loading' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b', fontSize: '0.75rem' }}>
                    <RefreshCw size={13} className="spin" /> Loading preview…
                  </div>
                ) : preview === 'error' ? (
                  <div style={{ color: '#ef4444', fontSize: '0.75rem' }}>Failed to load preview.</div>
                ) : preview.raw ? (
                  <pre style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: '0.72rem', color: '#94a3b8', margin: 0, whiteSpace: 'pre', lineHeight: 1.6 }}>
                    {preview.content}
                  </pre>
                ) : (
                  <JsonHighlight value={preview.content} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PanelShell({ children, collapsed, onToggle }) {
  return (
    <aside style={{
      width: collapsed ? '36px' : '220px',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: '#0a0a0f',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '1rem',
      overflow: 'hidden',
      marginRight: '8px',
      transition: 'width 0.2s ease',
    }}>
      <div style={{
        padding: '0.6rem 0.75rem',
        borderBottom: collapsed ? 'none' : '1px solid rgba(255,255,255,0.07)',
        fontSize: '0.7rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: '#64748b',
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
        flexShrink: 0,
        justifyContent: collapsed ? 'center' : 'space-between',
      }}>
        {!collapsed && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <FolderOpen size={13} color="#818cf8" /> Thinkingcap Schemas
          </span>
        )}
        <button
          onClick={onToggle}
          title={collapsed ? 'Expand panel' : 'Collapse panel'}
          style={{
            background: 'none',
            border: 'none',
            padding: '0.1rem',
            cursor: 'pointer',
            color: '#475569',
            display: 'flex',
            alignItems: 'center',
            borderRadius: '0.3rem',
            transform: 'none',
          }}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
      {!collapsed && children}
    </aside>
  );
}

function flatFilter(nodes, query) {
  const result = [];
  for (const node of nodes) {
    if (node.children.length > 0) {
      const filteredChildren = flatFilter(node.children, query);
      if (filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren });
      }
    } else if (node.label.toLowerCase().includes(query) || node.schema?.blobDir?.includes(query)) {
      result.push(node);
    }
  }
  return result;
}
