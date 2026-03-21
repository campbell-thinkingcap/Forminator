import React from 'react';
import FormField from './FormField';
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';

const DynamicForm = ({ schema, data = {}, onChange, onFieldFocus }) => {
  if (!schema || !schema.properties) return null;

  const handleFieldChange = (key, value) => {
    onChange({ ...data, [key]: value });
  };

  const renderProperty = (key, propSchema) => {
    const value = data[key];
    const isRequired = schema.required?.includes(key);

    if (propSchema.type === 'object') {
      return (
        <div key={key} className="nested-section">
          <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ChevronDown size={18} />
            {key.charAt(0).toUpperCase() + key.slice(1)}
          </h3>
          {propSchema.description && <p className="description">{propSchema.description}</p>}
          <DynamicForm
            schema={propSchema}
            data={value || {}}
            onChange={(subData) => handleFieldChange(key, subData)}
            onFieldFocus={onFieldFocus}
          />
        </div>
      );
    }

    if (propSchema.type === 'array') {
      const items = Array.isArray(value) ? value : [];

      const handleAdd = () => {
        const newItem = propSchema.items.type === 'object' ? {} : '';
        handleFieldChange(key, [...items, newItem]);
      };

      const handleRemove = (index) => {
        handleFieldChange(key, items.filter((_, i) => i !== index));
      };

      const handleItemChange = (index, itemValue) => {
        const newItems = [...items];
        newItems[index] = itemValue;
        handleFieldChange(key, newItems);
      };

      return (
        <div key={key} className="form-group">
          <label>{key.charAt(0).toUpperCase() + key.slice(1)}</label>
          {propSchema.description && <p className="description">{propSchema.description}</p>}

          <div style={{ marginLeft: '1rem' }}>
            {items.map((item, index) => (
              <div key={index} className="array-item">
                <button
                  className="remove-btn"
                  onClick={() => handleRemove(index)}
                  title="Remove item"
                >
                  <Trash2 size={14} />
                </button>

                {propSchema.items.type === 'object' ? (
                  <DynamicForm
                    schema={propSchema.items}
                    data={item}
                    onChange={(val) => handleItemChange(index, val)}
                    onFieldFocus={onFieldFocus}
                  />
                ) : (
                  <FormField
                    label={`Item ${index + 1}`}
                    type={propSchema.items.type}
                    value={item}
                    onChange={(val) => handleItemChange(index, val)}
                    onFocus={() => onFieldFocus?.(key)}
                    schema={propSchema.items}
                  />
                )}
              </div>
            ))}
            <button className="secondary" onClick={handleAdd} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Plus size={16} /> Add {key}
            </button>
          </div>
        </div>
      );
    }

    // Determine type (handling array types like ["string", "null"])
    const actualType = Array.isArray(propSchema.type)
      ? propSchema.type.find(t => t !== 'null')
      : propSchema.type;

    return (
      <FormField
        key={key}
        label={key}
        type={actualType}
        value={value}
        onChange={(val) => handleFieldChange(key, val)}
        onFocus={() => onFieldFocus?.(key)}
        description={propSchema.description}
        schema={propSchema}
        required={isRequired}
      />
    );
  };

  return (
    <div className="dynamic-form">
      {Object.entries(schema.properties).map(([key, propSchema]) => renderProperty(key, propSchema))}
    </div>
  );
};

export default DynamicForm;
