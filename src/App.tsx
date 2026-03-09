import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import Login from '@/pages/Login'
import AdminPortal from '@/pages/AdminPortal'
import FieldOfficerPortal from '@/pages/FieldOfficerPortal'
import VehicleManagement from '@/pages/VehicleManagement'
import ZoneManagement from '@/pages/ZoneManagement'
import CompliancePage from '@/pages/CompliancePage'
import BreachAlerts from '@/pages/BreachAlerts'
import DataManagement from '@/pages/DataManagement'
import UserManagement from '@/pages/UserManagement'
import OrganizationManagement from '@/pages/OrganizationManagement'
import IncidentManagement from '@/pages/IncidentManagement'
import Reports from '@/pages/Reports'
import SystemDiagnostics from '@/pages/SystemDiagnostics'
import TestDashboard from '@/pages/TestDashboard'
import { NetworkStatusBar } from '@/components/features/NetworkStatusBar'
import { PWAInstallPrompt } from '@/components/features/PWAInstallPrompt'

// Add your two new pages
import ComplianceRecalculation from '@/pages/ComplianceRecalculation'
import LiveOfficerTracking from '@/pages/LiveOfficerTracking'
import OrganizationProfile from '@/pages/OrganizationProfile'
import AuditLog from '@/pages/AuditLog'
import EnforcementActions from '@/pages/EnforcementActions'
import EnforcementCommandCenter from '@/pages/EnforcementCommandCenter'
import InfringementNotices from '@/pages/InfringementNotices'
import PrivacyCurtain from '@/pages/PrivacyCurtain'
import PatrolCheckpointManagement from '@/pages/PatrolCheckpointManagement'
import DataManagementHub from '@/pages/DataManagementHub'
import DataCleanupUtility from '@/pages/DataCleanupUtility'
import DataIntegrityDashboard from '@/pages/DataIntegrityDashboard'
import LivePatrolMonitor from '@/pages/LivePatrolMonitor'
import ReportsHub from '@/pages/ReportsHub'
import HotspotsMap from '@/pages/HotspotsMap'
import SpatialComplianceAdmin from '@/pages/SpatialComplianceAdmin'
import ComplianceAnalytics from '@/pages/ComplianceAnalytics'
import IncidentReports from '@/pages/IncidentReports'
import ObservationsView from '@/pages/ObservationsView'
import UniversalSearch from '@/pages/UniversalSearch'
import NoticeToVacate from '@/pages/NoticeToVacate'
import OfficerWelfareSettings from '@/pages/OfficerWelfareSettings'
import EnforcementReview from '@/pages/EnforcementReview'
import InvestigationJobsPage from '@/pages/InvestigationJobsPage'
import VehicleDetailPage from '@/pages/VehicleDetailPage'
import PersonRecords from '@/pages/PersonRecords'
import ImportData from '@/pages/ImportData'
import ImportHistoricalData from '@/pages/ImportHistoricalData'
import BreachNotices from '@/pages/BreachNotices'
import ObservationsReport from '@/pages/ObservationsReport'
import PortalSelection from '@/pages/PortalSelection'
import Settings from '@/pages/Settings'
import Profile from '@/pages/Profile'
import VehicleRegistry from '@/pages/VehicleRegistry'

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
})

// Protected Route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore()
  const location = useLocation()

  const hasPortalChoice = () => {
    if (typeof window === 'undefined') return false
    return window.sessionStorage.getItem('adminOfficerPortalChoice') === 'selected'
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg font-semibold">Loading...</div>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // admin_officer must choose a portal once per login session.
  if (
    user.role === 'admin_officer' &&
    location.pathname !== '/portal-selection' &&
    !hasPortalChoice()
  ) {
    return <Navigate to="/portal-selection" replace />
  }

  return <>{children}</>
}

// Role-based route wrapper
function RoleRoute({ 
  children, 
  allowedRoles 
}: { 
  children: React.ReactNode
  allowedRoles: string[]
}) {
  const { user } = useAuthStore()

  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

export default function App() {
  const { user, loading, checkSession, initializeAuth } = useAuthStore()

  // Check session on app load
  useEffect(() => {
    initializeAuth()
    checkSession()
  }, [checkSession, initializeAuth])

  // Show loading state while checking session
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <NetworkStatusBar />
        <PWAInstallPrompt />
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route
            path="/portal-selection"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin_officer']}>
                  <PortalSelection />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* Field Officer Portal */}
          <Route
            path="/field-officer"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['officer', 'admin_officer']}>
                  <FieldOfficerPortal />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          {/* Protected routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                {user?.role === 'officer' ? (
                  <FieldOfficerPortal />
                ) : user?.role === 'admin_officer' ? (
                  <Navigate to="/portal-selection" replace />
                ) : (
                  <AdminPortal />
                )}
              </ProtectedRoute>
            }
          />

          {/* Admin/Master routes */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <AdminPortal />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/vehicles"
            element={
              <ProtectedRoute>
                <VehicleManagement />
              </ProtectedRoute>
            }
          />

          <Route
            path="/zones"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <ZoneManagement />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/compliance"
            element={
              <ProtectedRoute>
                <CompliancePage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/breaches"
            element={
              <ProtectedRoute>
                <BreachAlerts />
              </ProtectedRoute>
            }
          />

          <Route
            path="/data"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master']}>
                  <DataManagement />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/users"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master']}>
                  <UserManagement />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/organizations"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['master']}>
                  <OrganizationManagement />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/incidents"
            element={
              <ProtectedRoute>
                <IncidentManagement />
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <Reports />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/diagnostics"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['master']}>
                  <SystemDiagnostics />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/test-dashboard"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['master']}>
                  <TestDashboard />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* --- NEW ROUTES ADDED BELOW --- */}

          <Route
            path="/compliance-recalculation"
            element={
              <ProtectedRoute>
                  <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <ComplianceRecalculation />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/live-tracking"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master']}>
                  <LiveOfficerTracking />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/organization-profile"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <OrganizationProfile />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/audit-log"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <AuditLog />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/enforcement-actions"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'officer']}>
                  <EnforcementActions />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/enforcement-command-center"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <EnforcementCommandCenter />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/infringements"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'officer']}>
                  <InfringementNotices />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/privacy-curtain"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master']}>
                  <PrivacyCurtain />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/patrol-checkpoints"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <PatrolCheckpointManagement />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/data-hub"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master']}>
                  <DataManagementHub />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/data-cleanup"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master']}>
                  <DataCleanupUtility />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/data-integrity"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master']}>
                  <DataIntegrityDashboard />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/live-patrol"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <LivePatrolMonitor />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports-hub"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <ReportsHub />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/hotspots"
            element={
              <ProtectedRoute>
                <HotspotsMap />
              </ProtectedRoute>
            }
          />

          <Route
            path="/spatial-compliance"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master']}>
                  <SpatialComplianceAdmin />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/compliance-analytics"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <ComplianceAnalytics />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/incident-reports"
            element={
              <ProtectedRoute>
                <IncidentReports />
              </ProtectedRoute>
            }
          />

          <Route
            path="/observations"
            element={
              <ProtectedRoute>
                <ObservationsView />
              </ProtectedRoute>
            }
          />

          <Route
            path="/search"
            element={
              <ProtectedRoute>
                <UniversalSearch />
              </ProtectedRoute>
            }
          />

          <Route
            path="/notice-to-vacate"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <NoticeToVacate />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/officer-welfare"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <OfficerWelfareSettings />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/enforcement-review"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <EnforcementReview />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/investigations"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <InvestigationJobsPage />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/vehicles/:id"
            element={
              <ProtectedRoute>
                <VehicleDetailPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/person-records"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <PersonRecords />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/import-data"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <ImportData />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/import-historical"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <ImportHistoricalData />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/breach-notices"
            element={
              <ProtectedRoute>
                <BreachNotices />
              </ProtectedRoute>
            }
          />

          <Route
            path="/observations-report"
            element={
              <ProtectedRoute>
                <ObservationsReport />
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />

          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />

          <Route
            path="/vehicle-registry"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <VehicleRegistry />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster position="top-right" />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
