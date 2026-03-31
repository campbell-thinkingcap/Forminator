import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Wand2, Send, User, CheckCircle } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

export default function EditPanel({ schema, onSchemaEdit }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const schemaKeyRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Refocus input after each response
  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [loading]);

  // Reset conversation when a new schema is loaded (identity change only)
  useEffect(() => {
    if (!schema) return;
    const key = schema.$id ?? schema.title ?? JSON.stringify(schema).slice(0, 80);
    if (key === schemaKeyRef.current) return;
    schemaKeyRef.current = key;
    setMessages([]);
    setInput('');
  }, [schema]);

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;

    const userMsg = { role: 'user', content: text.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await axios.post(`${API_BASE}/chat/edit`, {
        schema,
        messages: updatedMessages
      });

      const { message, schema: newSchema } = res.data;
      const assistantMsg = { role: 'assistant', content: message, schemaApplied: !!newSchema };
      setMessages(prev => [...prev, assistantMsg]);

      if (newSchema) {
        onSchemaEdit(newSchema);
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.'
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.length === 0 && !loading && (
          <div className="chat-empty">Describe a schema change to get started</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message--${msg.role}`}>
            <div className="chat-avatar">
              {msg.role === 'assistant' ? <Wand2 size={13} /> : <User size={13} />}
            </div>
            <div className="chat-bubble-wrap">
              <div className="chat-bubble">{msg.content}</div>
              {msg.schemaApplied && (
                <div className="chat-schema-applied">
                  <CheckCircle size={11} /> Schema updated
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="chat-message chat-message--assistant">
            <div className="chat-avatar"><Wand2 size={13} /></div>
            <div className="chat-bubble chat-thinking">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe a schema change…"
          disabled={loading || !schema}
          className="chat-input"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim() || !schema}
          className="chat-send-btn"
          title="Send"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
