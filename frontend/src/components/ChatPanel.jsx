import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Bot, Send, User } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

export default function ChatPanel({ schema, currentFormData, onFieldUpdates }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState([]);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const schemaKeyRef = useRef(null);

  // Scroll to bottom whenever messages or loading state changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Return focus to the input after each assistant response
  // (no-op when input is disabled, e.g. while enum options are shown)
  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [loading]);

  // Reset checkbox selections when a new message arrives
  useEffect(() => {
    setSelectedOptions([]);
  }, [messages.length]);

  // Re-initialise when the schema changes
  useEffect(() => {
    if (!schema) return;
    const key = schema.$id ?? schema.title ?? JSON.stringify(schema).slice(0, 80);
    if (key === schemaKeyRef.current) return;
    schemaKeyRef.current = key;
    setMessages([]);
    setInput('');
    initChat(schema);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  const initChat = async (currentSchema) => {
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/chat`, {
        schema: currentSchema,
        messages: [],
        currentFormData: {}
      });
      const { message, fieldUpdates, enumOptions, multiSelect } = res.data;
      setMessages([{ role: 'assistant', content: message, enumOptions, multiSelect }]);
      if (fieldUpdates && Object.keys(fieldUpdates).length > 0) {
        onFieldUpdates(fieldUpdates);
      }
    } catch {
      setMessages([{
        role: 'assistant',
        content: `Hi! I'm ready to help you fill out "${currentSchema.title ?? 'this form'}". Let's get started — what would you like to do first?`
      }]);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;

    const userMsg = { role: 'user', content: text.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await axios.post(`${API_BASE}/chat`, {
        schema,
        messages: updatedMessages,
        currentFormData
      });
      const { message, fieldUpdates, enumOptions, multiSelect } = res.data;
      setMessages(prev => [...prev, { role: 'assistant', content: message, enumOptions, multiSelect }]);
      if (fieldUpdates && Object.keys(fieldUpdates).length > 0) {
        onFieldUpdates(fieldUpdates);
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

  const handleSend = () => sendMessage(input);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const lastMsg = messages[messages.length - 1];
  const activeEnumOptions = !loading && lastMsg?.role === 'assistant' && lastMsg?.enumOptions?.length > 0
    ? lastMsg
    : null;

  const renderEnumOptions = (msg) => {
    if (msg.multiSelect) {
      return (
        <div className="chat-enum-options">
          {msg.enumOptions.map(opt => {
            const label = opt === null || opt === undefined ? '(none)' : String(opt);
            const checked = selectedOptions.includes(opt);
            return (
              <label key={label} className="chat-enum-option chat-enum-option--check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e => {
                    setSelectedOptions(prev =>
                      e.target.checked ? [...prev, opt] : prev.filter(o => o !== opt)
                    );
                  }}
                />
                {label}
              </label>
            );
          })}
          <button
            className="chat-enum-confirm"
            disabled={selectedOptions.length === 0}
            onClick={() => sendMessage(selectedOptions.map(o => String(o)).join(', '))}
          >
            Confirm
          </button>
        </div>
      );
    }

    return (
      <div className="chat-enum-options">
        {msg.enumOptions.map(opt => {
          const label = opt === null || opt === undefined ? '(none)' : String(opt);
          return (
            <button
              key={label}
              className="chat-enum-option"
              onClick={() => sendMessage(label)}
            >
              <span className="chat-enum-radio" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.length === 0 && !loading && (
          <div className="chat-empty">Select a schema to start a conversation</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message--${msg.role}`}>
            <div className="chat-avatar">
              {msg.role === 'assistant' ? <Bot size={13} /> : <User size={13} />}
            </div>
            <div className="chat-bubble-wrap">
              <div className="chat-bubble">{msg.content}</div>
              {i === messages.length - 1 && msg.role === 'assistant' && msg.enumOptions && !loading && (
                renderEnumOptions(msg)
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="chat-message chat-message--assistant">
            <div className="chat-avatar"><Bot size={13} /></div>
            <div className="chat-bubble chat-thinking">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={activeEnumOptions ? 'Select an option above…' : 'Type your answer…'}
          disabled={loading || !schema || !!activeEnumOptions}
          className="chat-input"
          ref={inputRef}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim() || !schema || !!activeEnumOptions}
          className="chat-send-btn"
          title="Send"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
