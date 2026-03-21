import React from 'react';

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

const JsonHighlight = ({ value }) => {
  const lines = highlight(JSON.stringify(value, null, 2)).split('\n');
  return (
    <pre className="json-highlight">
      {lines.map((line, i) => (
        <div key={i} className="jh-line">
          <span className="jh-ln">{i + 1}</span>
          <span dangerouslySetInnerHTML={{ __html: line || ' ' }} />
        </div>
      ))}
    </pre>
  );
};

export default JsonHighlight;
