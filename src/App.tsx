import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { useSessionInactivityLock } from '@/hooks/useSessionInactivityLock'
import { useThemeMode } from '@/hooks/useThemeMode'
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
import { GlobalOperationsBar } from '@/components/features/GlobalOperationsBar'

// Add your two new pages
import ComplianceRecalculation from '@/pages/ComplianceRecalculation'
import CleanupAndRecalculate from '@/pages/CleanupAndRecalculate'
import PhotoReingest from '@/pages/PhotoReingest'
import EvidencePhotoLinker from '@/pages/EvidencePhotoLinker'
import LiveOfficerTracking from '@/pages/LiveOfficerTracking'
import OrganizationProfile from '@/pages/OrganizationProfile'
import AuditLog from '@/pages/AuditLog'
import EnforcementActions from '@/pages/EnforcementActions'
import EnforcementCommandCenter from '@/pages/EnforcementCommandCenter'
import InfringementNotices from '@/pages/InfringementNotices'
import PrivacyCurtain from '@/pages/PrivacyCurtain'
import PatrolCheckpointManagement from '@/pages/PatrolCheckpointManagement'
import PatrolScheduleManagement from '@/pages/PatrolScheduleManagement'
import PatrolKPIDashboard from '@/pages/PatrolKPIDashboard'
import DataManagementHub from '@/pages/DataManagementHub'
import DataCleanupUtility from '@/pages/DataCleanupUtility'
import DataIntegrityDashboard from '@/pages/DataIntegrityDashboard'
import LivePatrolMonitor from '@/pages/LivePatrolMonitor'
import ReportsHub from '@/pages/ReportsHub'
import AiAnalysis from '@/pages/AiAnalysis'
import HotspotsMap from '@/pages/HotspotsMap'
import SpatialComplianceAdmin from '@/pages/SpatialComplianceAdmin'
import ComplianceAnalytics from '@/pages/ComplianceAnalytics'
import IncidentReports from '@/pages/IncidentReports'
import ObservationsView from '@/pages/ObservationsView'
import ObservationRecords from '@/pages/ObservationRecords'
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
import CanonicalRecordsManager from '@/pages/CanonicalRecordsManager'
import PublicDisputePortal from '@/pages/PublicDisputePortal'
import Disputes from '@/pages/Disputes'
import Platform from '@/pages/Platform'
import ParkingEnforcementPortal from '@/pages/ParkingEnforcementPortal'
import ParkingOfficerPortal from '@/pages/ParkingOfficerPortal'
import NoiseControlPortal from '@/pages/NoiseControlPortal'
import NoiseOfficerPortal from '@/pages/NoiseOfficerPortal'
import VehicleDiscrepancies from '@/pages/VehicleDiscrepancies'
import NZSCVMonitor from '@/pages/NZSCVMonitor'
import NotificationsCenter from '@/pages/NotificationsCenter'
import ComplianceDashboard from '@/pages/ComplianceDashboard'
import CleanDashboard from '@/pages/CleanDashboard'
import FaceRecognitionPage from '@/pages/FaceRecognitionPage'

// ---------------------------------------------------------------------------
// ErrorBoundary – catches render-time errors so a crash on one page does not
// bring down the whole SPA.  On error it shows a minimal recovery UI that lets
// the user navigate away (or retry) instead of staring at a white screen.
// ---------------------------------------------------------------------------
interface ErrorBoundaryProps { children: ReactNode }
interface ErrorBoundaryState { hasError: boolean; error: Error | null }

class RouteErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[RouteErrorBoundary] Uncaught render error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-8">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-2xl font-bold text-destructive">Something went wrong</h1>
            <p className="text-muted-foreground text-sm">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                Try Again
              </button>
              <button
                className="px-4 py-2 rounded-md border text-sm"
                onClick={() => { window.location.href = '/' }}
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// RouteChangeCleanup – cancels in-flight queries when the user navigates to a
// new page.  This prevents stale async work from the previous page from
// interfering with the new page's state (the root cause of most "crash on
// page change" reports).
// ---------------------------------------------------------------------------
function RouteChangeCleanup() {
  const location = useLocation()
  const qc = useQueryClient()

  useEffect(() => {
    // Cancel only actively fetching queries when the route changes so that
    // callbacks from the previous page don't run against unmounted components.
    // Using { fetchStatus: 'fetching' } avoids cancelling idle/background queries.
    qc.cancelQueries({ fetchStatus: 'fetching' })
  }, [location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: 'always',
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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="relative inline-flex items-center justify-center">
            <div className="absolute h-16 w-16 rounded-full border-[3px] border-transparent border-t-primary animate-spin" style={{ animationDuration: '1.2s' }} />
            <img
              src="/iron-eagle-security-logo.jpg"
              alt="Loading"
              className="h-10 w-10 rounded-lg object-cover"
            />
          </div>
          <div className="flex items-center justify-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            ))}
          </div>
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

  // NZSCV monitor users are limited to registry monitoring and basic account pages.
  if (
    user.role === 'nzscv_monitor' &&
    !['/vehicle-registry', '/admin/nzscv', '/search', '/profile', '/settings'].includes(location.pathname)
  ) {
    return <Navigate to="/admin/nzscv" replace />
  }

  // Grand master users land on the platform overview page.
  if (
    user.role === 'grand_master' &&
    location.pathname === '/'
  ) {
    return <Navigate to="/platform" replace />
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
  const { user, loading, checkSession, initializeAuth, ensureLoadingResolved } = useAuthStore()
  useSessionInactivityLock()
  useThemeMode()

  // Check session on app load
  useEffect(() => {
    initializeAuth()
    checkSession()

    // Safety net: never block routing indefinitely on auth init.
    const loadingFallback = window.setTimeout(() => {
      ensureLoadingResolved()
    }, 12000)

    return () => {
      window.clearTimeout(loadingFallback)
    }
  }, [checkSession, ensureLoadingResolved, initializeAuth])

  // Recover quickly when returning to the tab/app (desktop focus, browser back,
  // or mobile app resume via pageshow) so dashboards do not appear stale.
  useEffect(() => {
    let inFlight = false

    const refreshActiveState = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (inFlight) return

      inFlight = true
      try {
        await checkSession()
        await queryClient.refetchQueries({ type: 'active' })
      } finally {
        inFlight = false
      }
    }

    const onFocus = () => { void refreshActiveState() }
    const onPageShow = () => { void refreshActiveState() }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshActiveState()
      }
    }

    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [checkSession])

  // Show loading state while checking session
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-cyan-50/30 to-gray-50 dark:from-gray-900 dark:via-cyan-950/20 dark:to-gray-900">
        <div className="text-center space-y-6">
          <div className="relative inline-flex items-center justify-center">
            {/* Outer ring */}
            <div className="absolute h-24 w-24 rounded-full border-4 border-primary/20 animate-ping" style={{ animationDuration: '2s' }} />
            {/* Spinning ring */}
            <div className="absolute h-20 w-20 rounded-full border-[3px] border-transparent border-t-primary animate-spin" style={{ animationDuration: '1.2s' }} />
            {/* Logo */}
            <img
              src="/iron-eagle-security-logo.jpg"
              alt="Loading"
              className="h-14 w-14 rounded-xl object-cover shadow-lg"
            />
          </div>
          <div>
            <p className="text-lg font-semibold text-foreground">FreedomCamp Manager</p>
            <div className="flex items-center justify-center gap-1.5 mt-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-2 w-2 rounded-full bg-primary animate-pulse"
                  style={{ animationDelay: `${i * 200}ms` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RouteChangeCleanup />
        <NetworkStatusBar />
        <PWAInstallPrompt />
        <RouteErrorBoundary>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/public/dispute" element={<PublicDisputePortal />} />
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
                ) : user?.role === 'nzscv_monitor' ? (
                  <Navigate to="/admin/nzscv" replace />
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
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <CompliancePage />
                </RoleRoute>
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
                <RoleRoute allowedRoles={['master', 'grand_master']}>
                  <OrganizationManagement />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/platform"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['grand_master']}>
                  <Platform />
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
            path="/photo-reingest"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <PhotoReingest />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/evidence-photo-linker"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master']}>
                  <EvidencePhotoLinker />
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
            path="/patrol-schedule"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <PatrolScheduleManagement />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/patrol-kpis"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <PatrolKPIDashboard />
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
            path="/admin/cleanup-recalculate"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master']}>
                  <CleanupAndRecalculate />
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
            path="/ai-analysis"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <AiAnalysis />
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
            path="/observation-records"
            element={
              <ProtectedRoute>
                <ObservationRecords />
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
            path="/disputes"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <Disputes />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/discrepancies"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <VehicleDiscrepancies />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/nzscv"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master', 'nzscv_monitor']}>
                  <NZSCVMonitor />
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

          {/* ── Parking Enforcement ─────────────────────────────────── */}
          <Route
            path="/parking"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <ParkingEnforcementPortal />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/parking-officer"
            element={
              <ProtectedRoute>
                <ParkingOfficerPortal />
              </ProtectedRoute>
            }
          />

          {/* ── Noise Control ────────────────────────────────────────────── */}
          <Route
            path="/noise-control"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <NoiseControlPortal />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/noise-officer"
            element={
              <ProtectedRoute>
                <NoiseOfficerPortal />
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
            path="/face-recognition"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'officer']}>
                  <FaceRecognitionPage />
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
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'nzscv_monitor']}>
                  <VehicleRegistry />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/canonical-records"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <CanonicalRecordsManager />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/notifications"
            element={
              <ProtectedRoute>
                <NotificationsCenter />
              </ProtectedRoute>
            }
          />
          <Route
            path="/compliance-dashboard"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master', 'admin_officer']}>
                  <ComplianceDashboard />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/clean-dashboard"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master', 'admin_officer']}>
                  <CleanDashboard />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </RouteErrorBoundary>
        <Toaster position="top-right" />
        <GlobalOperationsBar />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
