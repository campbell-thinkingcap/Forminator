import React, { useId } from 'react';

// Widget derivation mirrors backend/lib/fieldPlan.js deriveWidget — §4 of
// docs/SCHEMA-AUTHORING-STANDARD.md. The frontend can't import the backend lib;
// the standard is normative, keep both aligned with it (not with each other).
export const widgetFor = (schema) => {
  const explicit = schema['x-widget'];
  if (explicit) return explicit;
  if (schema.type === 'array' && Array.isArray(schema.items?.enum)) return 'checkbox';
  if (schema.type === 'boolean') return 'yesno';
  if (Array.isArray(schema.enum)) return schema.enum.length <= 5 ? 'radio' : 'dropdown';
  if (schema['x-options-source'] === 'db' || schema['x-options-source'] === 'app') return 'dropdown';
  return null;
};

const FormField = ({ label, type, value, onChange, onFocus, description, schema, required }) => {
  if ('const' in schema) {
    return (
      <div className="form-group">
        <label>{label}</label>
        {description && <p className="description">{description}</p>}
        <div className="uuid-display" onClick={onFocus}>{String(schema.const)}</div>
      </div>
    );
  }

  if (schema.format === 'uuid') {
    return (
      <div className="form-group">
        <label>{label}</label>
        {description && <p className="description">{description}</p>}
        <div className="uuid-display" onClick={onFocus}>{value || <span className="uuid-placeholder">auto-assigned</span>}</div>
      </div>
    );
  }

  const handleChange = (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    onChange(type === 'integer' || type === 'number' ? Number(val) : val);
  };

  const widget = widgetFor(schema);
  // Per-instance radio group name: array items / sibling objects can repeat the
  // same field key, and shared names would merge the groups in the browser.
  const radioName = useId();

  const renderInput = () => {
    if (schema.enum) {
      if (widget === 'radio') {
        return (
          <div className="radio-group" role="radiogroup" aria-label={label}>
            {schema.enum.map(option => (
              <label key={String(option)} className="radio-option">
                <input
                  type="radio"
                  name={radioName}
                  checked={value === option}
                  onChange={() => onChange(option)}
                  onFocus={onFocus}
                />
                {option === '' || option == null ? 'None' : String(option)}
              </label>
            ))}
          </div>
        );
      }
      return (
        <select value={value || ''} onChange={handleChange} onFocus={onFocus}>
          <option value="" disabled>Select {label}...</option>
          {schema.enum.map(option => (
            <option key={option} value={option || ''}>{option || 'None'}</option>
          ))}
        </select>
      );
    }

    // §5.5 — dynamic options (db|app): placeholder picker populated from
    // x-options-preview in dev/test only; real option loading is a later seam.
    const optionsSource = schema['x-options-source'];
    if ((optionsSource === 'db' || optionsSource === 'app') && Array.isArray(schema['x-options-preview'])) {
      return (
        <select value={value || ''} onChange={handleChange} onFocus={onFocus}>
          <option value="" disabled>Select {label} (preview)...</option>
          {schema['x-options-preview'].map(option => (
            <option key={String(option)} value={option ?? ''}>{String(option ?? 'None')}</option>
          ))}
        </select>
      );
    }

    if (type === 'array' && Array.isArray(schema.items?.enum)) {
      const items = Array.isArray(value) ? value : [];
      const toggle = (option, checked) =>
        onChange(checked ? [...items, option] : items.filter(v => v !== option));
      return (
        <div className="checkbox-options" role="group" aria-label={label}>
          {schema.items.enum.map(option => (
            <label key={String(option)} className="checkbox-option">
              <input
                type="checkbox"
                checked={items.includes(option)}
                onChange={e => toggle(option, e.target.checked)}
                onFocus={onFocus}
              />
              {String(option)}
            </label>
          ))}
        </div>
      );
    }

    switch (type) {
      case 'boolean':
        return (
          <div className="segmented" role="group" aria-label={label}>
            <button
              type="button"
              className={value === true ? 'segmented-btn active' : 'segmented-btn'}
              aria-pressed={value === true}
              onClick={() => onChange(true)}
              onFocus={onFocus}
            >
              Yes
            </button>
            <button
              type="button"
              className={value === false ? 'segmented-btn active' : 'segmented-btn'}
              aria-pressed={value === false}
              onClick={() => onChange(false)}
              onFocus={onFocus}
            >
              No
            </button>
          </div>
        );
      case 'integer':
      case 'number':
        return <input type="number" value={value || ''} onChange={handleChange} onFocus={onFocus} />;
      default:
        return <input type="text" value={value || ''} onChange={handleChange} onFocus={onFocus} />;
    }
  };

  return (
    <div className="form-group">
      <label>
        {label}
        {required && <span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>}
      </label>
      {description && <p className="description">{description}</p>}
      {renderInput()}
    </div>
  );
};

export default FormField;
