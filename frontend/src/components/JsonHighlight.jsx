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

// Simple LCS-based line diff. Returns array of { type: 'equal'|'add'|'remove', line }
function diffLines(oldLines, newLines) {
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Trace back
  const result = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && oldLines[i] === newLines[j]) {
      result.push({ type: 'equal', line: newLines[j] });
      i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ type: 'add', line: newLines[j] });
      j++;
    } else {
      result.push({ type: 'remove', line: oldLines[i] });
      i++;
    }
  }
  return result;
}

const JsonHighlight = ({ value, activeKey, diffBase }) => {
  const activeLineRef = useRef(null);

  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeKey]);

  if (diffBase) {
    const oldLines = JSON.stringify(diffBase, null, 2).split('\n');
    const newLines = JSON.stringify(value, null, 2).split('\n');
    const hunks = diffLines(oldLines, newLines);
    const highlightedOld = highlight(oldLines.join('\n')).split('\n');
    const highlightedNew = highlight(newLines.join('\n')).split('\n');
    let oldIdx = 0, newIdx = 0;

    return (
      <pre className="json-highlight">
        {hunks.map((hunk, i) => {
          let htmlLine, cls;
          if (hunk.type === 'equal') {
            htmlLine = highlightedNew[newIdx++];
            oldIdx++;
            cls = 'jh-line';
          } else if (hunk.type === 'add') {
            htmlLine = highlightedNew[newIdx++];
            cls = 'jh-line jh-diff-add';
          } else {
            htmlLine = highlightedOld[oldIdx++];
            cls = 'jh-line jh-diff-remove';
          }
          return (
            <div key={i} className={cls}>
              <span className="jh-diff-marker">
                {hunk.type === 'add' ? '+' : hunk.type === 'remove' ? '−' : ' '}
              </span>
              <span dangerouslySetInnerHTML={{ __html: htmlLine || ' ' }} />
            </div>
          );
        })}
      </pre>
    );
  }

  const json = JSON.stringify(value, null, 2);
  const rawLines = json.split('\n');
  const htmlLines = highlight(json).split('\n');
  const range = activeKey ? findBlockRange(rawLines, activeKey) : null;

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
