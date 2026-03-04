import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import 'leaflet/dist/leaflet.css'
import { supabaseConfigured } from './lib/supabase.ts'

const root = document.getElementById('root')!

if (!supabaseConfigured) {
  createRoot(root).render(
    <StrictMode>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif',
        background: '#0f172a', color: '#f8fafc', padding: '2rem', textAlign: 'center',
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚙️</div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          Setup Required
        </h1>
        <p style={{ color: '#94a3b8', maxWidth: '480px', lineHeight: 1.6, marginBottom: '1.5rem' }}>
          This deployment is missing its Supabase connection details. Add the following
          environment variables in your deployment platform and redeploy.
        </p>
        <div style={{
          background: '#1e293b', borderRadius: '0.5rem', padding: '1rem 1.5rem',
          textAlign: 'left', fontFamily: 'monospace', fontSize: '0.875rem',
          color: '#7dd3fc', lineHeight: 2, marginBottom: '1.5rem',
        }}>
          <div>{'VITE_SUPABASE_URL=https://<your-ref>.supabase.co'}</div>
          <div>VITE_SUPABASE_ANON_KEY=eyJhbGci...</div>
        </div>
        <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
          Find these values in the Supabase Dashboard → Settings → API.
        </p>
      </div>
    </StrictMode>
  )
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
