import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import './index.css'
import App from './App.jsx'
import SchemaFinder from './pages/SchemaFinder.jsx'

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

const isSchemaFinder = window.location.pathname === '/schema-finder'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isSchemaFinder ? (
      <SchemaFinder />
    ) : (
      <GoogleOAuthProvider clientId={clientId}>
        <App />
      </GoogleOAuthProvider>
    )}
  </StrictMode>,
)
