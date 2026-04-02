import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
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
 */
export function CleanAppScaffold() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
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
      </Routes>
    </BrowserRouter>
  )
}

export default CleanAppScaffold
