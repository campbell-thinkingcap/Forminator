import React, { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, FileJson, FolderOpen, Folder, RefreshCw } from 'lucide-react';

const TCOV_SCHEMAS_URL = 'https://tcov.thinkingcap.com/api/schemas';

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

function TreeNode({ node, depth = 0, selectedBlobDir, onSelect, defaultOpen }) {
  const isLeaf = node.schema !== null && node.children.length === 0;
  const isFolder = node.children.length > 0;
  const [open, setOpen] = useState(defaultOpen || depth === 0);
  const isSelected = node.schema?.blobDir === selectedBlobDir;

  const indent = depth * 12;

  if (isLeaf) {
    return (
      <div
        onClick={() => onSelect(node.schema)}
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
      {open && isFolder && (
        <div>
          {node.children.map(child => (
            <TreeNode
              key={child.key}
              node={child}
              depth={depth + 1}
              selectedBlobDir={selectedBlobDir}
              onSelect={onSelect}
              defaultOpen={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SchemaTree({ onSelect, selectedBlobDir }) {
  const [status, setStatus] = useState('idle'); // idle | loading | error | ok
  const [tree, setTree] = useState([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetch(TCOV_SCHEMAS_URL);
      const data = await res.json();
      setTree(buildTree(data.schemas || []));
      setTotal(data.total || 0);
      setStatus('ok');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredTree = filter.trim()
    ? flatFilter(tree, filter.toLowerCase())
    : tree;

  if (status === 'loading') return (
    <PanelShell>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b', fontSize: '0.75rem', padding: '1rem' }}>
        <RefreshCw size={13} className="spin" /> Loading schemas...
      </div>
    </PanelShell>
  );

  if (status === 'error') return (
    <PanelShell>
      <div style={{ padding: '1rem', color: '#ef4444', fontSize: '0.72rem' }}>
        Failed to reach TCOV schemas.
        <button onClick={() => load()} style={{ marginTop: '0.5rem', fontSize: '0.72rem', padding: '0.3rem 0.6rem', display: 'block' }}>
          Retry
        </button>
      </div>
    </PanelShell>
  );

  return (
    <PanelShell>
      <div style={{ padding: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={`Search ${total} schemas...`}
          style={{ fontSize: '0.72rem', padding: '0.3rem 0.6rem', borderRadius: '0.4rem', width: '100%' }}
        />
      </div>
      <div style={{ overflowY: 'auto', flex: 1, padding: '0.4rem 0.5rem' }}>
        {filteredTree.map(node => (
          <TreeNode
            key={node.key}
            node={node}
            depth={0}
            selectedBlobDir={selectedBlobDir}
            onSelect={onSelect}
            defaultOpen={false}
          />
        ))}
      </div>
    </PanelShell>
  );
}

function PanelShell({ children }) {
  return (
    <aside style={{
      width: '220px',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: '#0a0a0f',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '1rem',
      overflow: 'hidden',
      position: 'sticky',
      top: '2rem',
      maxHeight: 'calc(100vh - 4rem)',
      marginRight: '8px',
    }}>
      <div style={{
        padding: '0.6rem 0.75rem',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        fontSize: '0.7rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: '#64748b',
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
        flexShrink: 0,
      }}>
        <FolderOpen size={13} color="#818cf8" /> TCOV Schemas
      </div>
      {children}
    </aside>
  );
}

// Flatten tree to matching leaves only, preserving folder wrappers
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
