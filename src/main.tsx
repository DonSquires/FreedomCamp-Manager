import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { RebuildSurfaceSwitcher } from './rebuild/RebuildSurfaceSwitcher.tsx'
import './index.css'
import 'leaflet/dist/leaflet.css'
import { supabaseConfigured } from './lib/supabase.ts'
import { registerServiceWorker } from './lib/pwa.ts'
import { assertRouteManifestValid, routeManifest } from './navigation'

const App = lazy(() => import('./App.tsx'))
const CleanAppScaffold = lazy(() => import('./rebuild/CleanAppScaffold.tsx'))

// Inject a preconnect hint for the Supabase backend at runtime so the browser
// can open the TCP+TLS connection before any API calls are made.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
if (supabaseUrl) {
  const link = document.createElement('link')
  link.rel = 'preconnect'
  link.href = supabaseUrl
  link.crossOrigin = 'anonymous'
  document.head.appendChild(link)
}

const root = document.getElementById('root')!
const enableCleanRebuildRoutes = import.meta.env.VITE_ENABLE_CLEAN_REBUILD_ROUTES === 'true'
const _qp = new URLSearchParams(window.location.search)
const devToolsFromQuery = _qp.get('dev-tools') === '1'
const devToolsFromStorage = localStorage.getItem('dev_tools_visible') === 'true'
const allowCleanSurfaceToggle = enableCleanRebuildRoutes || import.meta.env.DEV || devToolsFromQuery || devToolsFromStorage
const cleanFromQuery = _qp.get('clean_rebuild') === '1'
const clearFromQuery = _qp.get('clean_rebuild') === '0'
// Persist/clear the tester toggle via localStorage so it survives page reloads.
if (clearFromQuery) localStorage.removeItem('clean_rebuild_surface')
else if (cleanFromQuery) localStorage.setItem('clean_rebuild_surface', 'true')
const cleanFromStorage = allowCleanSurfaceToggle && localStorage.getItem('clean_rebuild_surface') === 'true'
const useCleanSurface = enableCleanRebuildRoutes || cleanFromQuery || cleanFromStorage

// Self-heal accidental persistence: if rebuild toggles are not explicitly enabled,
// clear the sticky flag so normal users always see the production surface.
if (!allowCleanSurfaceToggle && localStorage.getItem('clean_rebuild_surface') === 'true') {
  localStorage.removeItem('clean_rebuild_surface')
}

const recentDispatchTitles: string[] = (() => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem('fc_recent_dispatch_titles')
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 8)
  } catch {
    return []
  }
})()

if (import.meta.env.DEV) {
  assertRouteManifestValid(routeManifest)
}

const appBootLoader = (
  <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-6 text-center text-slate-50">
    <div className="space-y-5">
      <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
        <div className="absolute h-20 w-20 rounded-full border-[3px] border-cyan-300/20 border-t-cyan-300 animate-spin" />
        <img
          src="/iron-eagle-security-logo.jpg"
          alt="Iron Eagle Security Limited"
          className="h-12 w-12 rounded-xl object-cover shadow-lg"
        />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-200">Iron Eagle Security Limited</p>
        <h1 className="text-2xl font-bold text-white">Field Compliance Manager</h1>
        <p className="text-sm text-slate-300">Preparing the Freedom Camp enforcement workspace...</p>
        {recentDispatchTitles.length > 0 && (
          <div className="pt-3 text-left">
            <p className="text-xs uppercase tracking-wide text-slate-400">Recent dispatch jobs</p>
            <div className="mt-2 space-y-1">
              {recentDispatchTitles.map((title) => (
                <p key={title} className="text-xs text-slate-200">{title}</p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  </div>
)

if (supabaseConfigured && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerServiceWorker().catch(() => {
    // Non-blocking: app should still load if SW registration fails.
  })
}

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
          <div>{'VITE_SUPABASE_URL=https://kxwjcupuxnnbnzcgmkoi.supabase.co'}</div>
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
      <Suspense fallback={appBootLoader}>
        {useCleanSurface ? <CleanAppScaffold /> : <App />}
      </Suspense>
      <RebuildSurfaceSwitcher />
    </StrictMode>
  )
}
