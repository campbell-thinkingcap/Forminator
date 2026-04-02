import React, { useRef } from 'react';
import { highlight, diffLines } from './JsonHighlight';

// Groups unified diff hunks into aligned left/right rows.
// Equal lines appear in both; removes only on left; adds only on right.
// Consecutive remove/add blocks are paired row-by-row with empty placeholders for alignment.
function buildSideBySide(hunks) {
  const left = [];
  const right = [];
  let i = 0;
  while (i < hunks.length) {
    if (hunks[i].type === 'equal') {
      left.push({ type: 'equal' });
      right.push({ type: 'equal' });
      i++;
    } else {
      const removes = [], adds = [];
      while (i < hunks.length && hunks[i].type !== 'equal') {
        if (hunks[i].type === 'remove') removes.push(true);
        else adds.push(true);
        i++;
      }
      const maxLen = Math.max(removes.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        left.push(j < removes.length ? { type: 'remove' } : { type: 'empty' });
        right.push(j < adds.length ? { type: 'add' } : { type: 'empty' });
      }
    }
  }
  return { left, right };
}

const SideBySideDiff = ({ oldValue, newValue, oldLabel = 'Selected version', newLabel = 'Current version' }) => {
  const leftRef = useRef(null);
  const rightRef = useRef(null);

  const oldLines = JSON.stringify(oldValue, null, 2).split('\n');
  const newLines = JSON.stringify(newValue, null, 2).split('\n');
  const hunks = diffLines(oldLines, newLines);
  const { left, right } = buildSideBySide(hunks);

  const highlightedOld = highlight(oldLines.join('\n')).split('\n');
  const highlightedNew = highlight(newLines.join('\n')).split('\n');

  // Build rendered rows for each pane by tracking independent line indices
  let oldIdx = 0;
  const leftRows = left.map(entry => {
    if (entry.type === 'empty') return { html: '', type: 'empty' };
    return { html: highlightedOld[oldIdx++] ?? '', type: entry.type };
  });

  let newIdx = 0;
  const rightRows = right.map(entry => {
    if (entry.type === 'empty') return { html: '', type: 'empty' };
    return { html: highlightedNew[newIdx++] ?? '', type: entry.type };
  });

  const syncLeft = () => {
    if (rightRef.current) rightRef.current.scrollTop = leftRef.current.scrollTop;
  };
  const syncRight = () => {
    if (leftRef.current) leftRef.current.scrollTop = rightRef.current.scrollTop;
  };

  const panes = [
    { rows: leftRows, ref: leftRef, onScroll: syncLeft, label: oldLabel },
    { rows: rightRows, ref: rightRef, onScroll: syncRight, label: newLabel },
  ];

  return (
    <div className="sbs-diff">
      {panes.map(({ rows, ref, onScroll, label }, paneIdx) => (
        <div key={paneIdx} className="sbs-diff-pane">
          <div className="sbs-diff-header">{label}</div>
          <pre ref={ref} onScroll={onScroll} className="json-highlight sbs-diff-pre">
            {rows.map((row, i) => {
              const cls = row.type === 'add' ? ' jh-diff-add'
                : row.type === 'remove' ? ' jh-diff-remove'
                : row.type === 'empty' ? ' sbs-diff-empty'
                : '';
              const marker = row.type === 'add' ? '+' : row.type === 'remove' ? '−' : ' ';
              return (
                <div key={i} className={`jh-line${cls}`}>
                  <span className="jh-diff-marker">{marker}</span>
                  <span dangerouslySetInnerHTML={{ __html: row.html || ' ' }} />
                </div>
              );
            })}
          </pre>
        </div>
      ))}
    </div>
  );
};

export default SideBySideDiff;
