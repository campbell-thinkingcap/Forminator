import React, { useEffect, useRef } from 'react';

function highlight(json) {
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) return `<span class="jh-key">${match}</span>`;
        return `<span class="jh-string">${match}</span>`;
      }
      if (/true|false/.test(match)) return `<span class="jh-bool">${match}</span>`;
      if (/null/.test(match))       return `<span class="jh-null">${match}</span>`;
      return `<span class="jh-number">${match}</span>`;
    }
  );
}

function findBlockRange(rawLines, key) {
  const searchFor = `"${key}":`;
  const startIdx = rawLines.findIndex(line => line.includes(searchFor));
  if (startIdx === -1) return null;

  let depth = 0;
  for (let i = startIdx; i < rawLines.length; i++) {
    const stripped = rawLines[i].replace(/"(?:[^"\\]|\\.)*"/g, '""');
    for (const ch of stripped) {
      if (ch === '{' || ch === '[') depth++;
      if (ch === '}' || ch === ']') depth--;
    }
    if (i === startIdx && depth === 0) return [startIdx, startIdx];
    if (i > startIdx && depth <= 0)   return [startIdx, i];
  }
  return [startIdx, startIdx];
}

const JsonHighlight = ({ value, activeKey }) => {
  const activeLineRef = useRef(null);
  const json = JSON.stringify(value, null, 2);
  const rawLines = json.split('\n');
  const htmlLines = highlight(json).split('\n');
  const range = activeKey ? findBlockRange(rawLines, activeKey) : null;

  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeKey]);

  return (
    <pre className="json-highlight">
      {htmlLines.map((line, i) => {
        const isActive = range && i >= range[0] && i <= range[1];
        const isFirst  = range && i === range[0];
        return (
          <div
            key={i}
            ref={isFirst ? activeLineRef : null}
            className={`jh-line${isActive ? ' jh-active' : ''}`}
          >
            <span className="jh-ln">{i + 1}</span>
            <span dangerouslySetInnerHTML={{ __html: line || ' ' }} />
          </div>
        );
      })}
    </pre>
  );
};

export default JsonHighlight;
