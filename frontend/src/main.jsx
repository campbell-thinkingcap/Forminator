import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import './index.css'
import App from './App.jsx'
import SkillMap from './pages/SkillMap.jsx'

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

const isSkillMap = window.location.pathname === '/skill-map'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isSkillMap ? (
      <SkillMap />
    ) : (
      <GoogleOAuthProvider clientId={clientId}>
        <App />
      </GoogleOAuthProvider>
    )}
  </StrictMode>,
)
