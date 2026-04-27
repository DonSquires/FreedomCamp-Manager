import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Login from '@/pages/Login'
import PortalSelection from '@/pages/PortalSelection'
import AdminPortal from '@/pages/AdminPortal'
import FieldOfficerPortal from '@/pages/FieldOfficerPortal'
import CompliancePage from './pages/Compliance'
import ObservationsPage from './pages/Observations'
import BreachesPage from './pages/Breaches'
import EnforcementPage from './pages/Enforcement'
import VehiclesPage from './pages/Vehicles'
import ZonesPage from './pages/Zones'
import LiveMapPage from './pages/LiveMap'
import PatrolsPage from './pages/Patrols'
import ReportsPage from './pages/Reports'
import DataImportPage from './pages/DataImport'
import DisputesPage from './pages/Disputes'
import SettingsPage from './pages/Settings'
import UserManagementPage from './pages/UserManagement'
import ProfilePage from './pages/Profile'
import PlatformPage from './pages/Platform'

/**
 * CleanAppScaffold — isolated router for the clean rebuild surface.
 * Toggle via VITE_ENABLE_CLEAN_REBUILD_ROUTES=true or ?clean_rebuild=1
 *
 * All routes except /login require an active Supabase session. Unauthenticated
 * visitors are redirected to /login automatically.
 */
export function CleanAppScaffold() {
  const [sessionChecked, setSessionChecked] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session)
      setSessionChecked(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Wait for the session check to complete before rendering routes to avoid
  // a flash of the login page for authenticated users.
  if (!sessionChecked) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/70 shadow-2xl backdrop-blur-sm p-6">
          <div className="h-1.5 w-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 mb-5" />
          <div className="flex items-center gap-3 mb-3">
            <div className="h-3 w-3 rounded-full bg-cyan-400 animate-pulse" />
            <p className="text-sm font-semibold tracking-wide text-slate-200">Preparing clean rebuild workspace</p>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Verifying your session and loading protected routes.
          </p>
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* All other routes require authentication */}
        {isAuthenticated ? (
          <>
            <Route path="/portal-selection" element={<PortalSelection />} />
            <Route path="/" element={<AdminPortal />} />
            <Route path="/field" element={<FieldOfficerPortal />} />
            <Route path="/platform" element={<PlatformPage />} />
            <Route path="/compliance" element={<CompliancePage />} />
            <Route path="/observations" element={<ObservationsPage />} />
            <Route path="/breaches" element={<BreachesPage />} />
            <Route path="/enforcement" element={<EnforcementPage />} />
            <Route path="/vehicles" element={<VehiclesPage />} />
            <Route path="/zones" element={<ZonesPage />} />
            <Route path="/live-map" element={<LiveMapPage />} />
            <Route path="/patrols" element={<PatrolsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/data-import" element={<DataImportPage />} />
            <Route path="/disputes" element={<DisputesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/users" element={<UserManagementPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <Route path="*" element={<Navigate to="/login" replace />} />
        )}
      </Routes>
    </BrowserRouter>
  )
}

export default CleanAppScaffold
