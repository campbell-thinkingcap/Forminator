import React from 'react';

const FormField = ({ label, type, value, onChange, description, schema, required }) => {
  const handleChange = (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    onChange(type === 'integer' || type === 'number' ? Number(val) : val);
  };

  const renderInput = () => {
    if (schema.enum) {
      return (
        <select value={value || ''} onChange={handleChange}>
          <option value="" disabled>Select {label}...</option>
          {schema.enum.map(option => (
            <option key={option} value={option || ''}>{option || 'None'}</option>
          ))}
        </select>
      );
    }

    switch (type) {
      case 'boolean':
        return (
          <div className="checkbox-group">
            <input 
              type="checkbox" 
              checked={!!value} 
              onChange={handleChange} 
              id={label}
            />
            <label htmlFor={label} style={{ margin: 0 }}>{label}</label>
          </div>
        );
      case 'integer':
      case 'number':
        return <input type="number" value={value || ''} onChange={handleChange} />;
      default:
        return <input type="text" value={value || ''} onChange={handleChange} />;
    }
  };

  if (type === 'boolean') return <div className="form-group">{renderInput()}</div>;

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
