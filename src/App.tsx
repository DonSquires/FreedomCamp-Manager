import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { useSessionInactivityLock } from '@/hooks/useSessionInactivityLock'
import { useThemeMode } from '@/hooks/useThemeMode'
import { NetworkStatusBar } from '@/components/features/NetworkStatusBar'
import { PWAInstallPrompt } from '@/components/features/PWAInstallPrompt'
import { GlobalOperationsBar } from '@/components/features/GlobalOperationsBar'

// ---------------------------------------------------------------------------
// Lazy-loaded page chunks — Vite code-splits each of these into a separate
// JS chunk that is only downloaded when the user first navigates to that route.
// This dramatically reduces the initial bundle size and improves Lighthouse
// performance scores (FCP, LCP, TTI).
// ---------------------------------------------------------------------------
const Login = lazy(() => import('@/pages/Login'))
const AdminPortal = lazy(() => import('@/pages/AdminPortal'))
const FieldOfficerPortal = lazy(() => import('@/pages/FieldOfficerPortal'))
const VehicleManagement = lazy(() => import('@/pages/VehicleManagement'))
const ZoneManagement = lazy(() => import('@/pages/ZoneManagement'))
const CompliancePage = lazy(() => import('@/pages/CompliancePage'))
const BreachAlerts = lazy(() => import('@/pages/BreachAlerts'))
const DataManagement = lazy(() => import('@/pages/DataManagement'))
const UserManagement = lazy(() => import('@/pages/UserManagement'))
const OrganizationManagement = lazy(() => import('@/pages/OrganizationManagement'))
const IncidentManagement = lazy(() => import('@/pages/IncidentManagement'))
const Reports = lazy(() => import('@/pages/Reports'))
const SystemDiagnostics = lazy(() => import('@/pages/SystemDiagnostics'))
const TestDashboard = lazy(() => import('@/pages/TestDashboard'))
const ComplianceRecalculation = lazy(() => import('@/pages/ComplianceRecalculation'))
const CleanupAndRecalculate = lazy(() => import('@/pages/CleanupAndRecalculate'))
const PhotoReingest = lazy(() => import('@/pages/PhotoReingest'))
const EvidencePhotoLinker = lazy(() => import('@/pages/EvidencePhotoLinker'))
const LiveOfficerTracking = lazy(() => import('@/pages/LiveOfficerTracking'))
const OrganizationProfile = lazy(() => import('@/pages/OrganizationProfile'))
const AuditLog = lazy(() => import('@/pages/AuditLog'))
const EnforcementActions = lazy(() => import('@/pages/EnforcementActions'))
const EnforcementCommandCenter = lazy(() => import('@/pages/EnforcementCommandCenter'))
const InfringementNotices = lazy(() => import('@/pages/InfringementNotices'))
const PrivacyCurtain = lazy(() => import('@/pages/PrivacyCurtain'))
const PatrolCheckpointManagement = lazy(() => import('@/pages/PatrolCheckpointManagement'))
const PatrolScheduleManagement = lazy(() => import('@/pages/PatrolScheduleManagement'))
const PatrolKPIDashboard = lazy(() => import('@/pages/PatrolKPIDashboard'))
const DataManagementHub = lazy(() => import('@/pages/DataManagementHub'))
const DataCleanupUtility = lazy(() => import('@/pages/DataCleanupUtility'))
const DataIntegrityDashboard = lazy(() => import('@/pages/DataIntegrityDashboard'))
const LivePatrolMonitor = lazy(() => import('@/pages/LivePatrolMonitor'))
const ReportsHub = lazy(() => import('@/pages/ReportsHub'))
const AiAnalysis = lazy(() => import('@/pages/AiAnalysis'))
const HotspotsMap = lazy(() => import('@/pages/HotspotsMap'))
const SpatialComplianceAdmin = lazy(() => import('@/pages/SpatialComplianceAdmin'))
const ComplianceAnalytics = lazy(() => import('@/pages/ComplianceAnalytics'))
const IncidentReports = lazy(() => import('@/pages/IncidentReports'))
const ObservationsView = lazy(() => import('@/pages/ObservationsView'))
const ObservationRecords = lazy(() => import('@/pages/ObservationRecords'))
const UniversalSearch = lazy(() => import('@/pages/UniversalSearch'))
const NoticeToVacate = lazy(() => import('@/pages/NoticeToVacate'))
const OfficerWelfareSettings = lazy(() => import('@/pages/OfficerWelfareSettings'))
const EnforcementReview = lazy(() => import('@/pages/EnforcementReview'))
const InvestigationJobsPage = lazy(() => import('@/pages/InvestigationJobsPage'))
const VehicleDetailPage = lazy(() => import('@/pages/VehicleDetailPage'))
const PersonRecords = lazy(() => import('@/pages/PersonRecords'))
const ImportData = lazy(() => import('@/pages/ImportData'))
const ImportHistoricalData = lazy(() => import('@/pages/ImportHistoricalData'))
const BreachNotices = lazy(() => import('@/pages/BreachNotices'))
const ObservationsReport = lazy(() => import('@/pages/ObservationsReport'))
const PortalSelection = lazy(() => import('@/pages/PortalSelection'))
const Settings = lazy(() => import('@/pages/Settings'))
const Profile = lazy(() => import('@/pages/Profile'))
const VehicleRegistry = lazy(() => import('@/pages/VehicleRegistry'))
const CanonicalRecordsManager = lazy(() => import('@/pages/CanonicalRecordsManager'))
const PublicDisputePortal = lazy(() => import('@/pages/PublicDisputePortal'))
const Disputes = lazy(() => import('@/pages/Disputes'))
const Platform = lazy(() => import('@/pages/Platform'))
const ParkingEnforcementPortal = lazy(() => import('@/pages/ParkingEnforcementPortal'))
const ParkingOfficerPortal = lazy(() => import('@/pages/ParkingOfficerPortal'))
const NoiseControlPortal = lazy(() => import('@/pages/NoiseControlPortal'))
const NoiseOfficerPortal = lazy(() => import('@/pages/NoiseOfficerPortal'))
const PointsOfInterest = lazy(() => import('@/pages/PointsOfInterest'))
const SiteRiskAssessment = lazy(() => import('@/pages/SiteRiskAssessment'))
const VehicleDiscrepancies = lazy(() => import('@/pages/VehicleDiscrepancies'))
const NZSCVMonitor = lazy(() => import('@/pages/NZSCVMonitor'))
const NotificationsCenter = lazy(() => import('@/pages/NotificationsCenter'))
const ComplianceDashboard = lazy(() => import('@/pages/ComplianceDashboard'))
const CleanDashboard = lazy(() => import('@/pages/CleanDashboard'))
const FaceRecognitionPage = lazy(() => import('@/pages/FaceRecognitionPage'))
const TimesheetReview = lazy(() => import('@/pages/TimesheetReview'))
const OpenShifts = lazy(() => import('@/pages/OpenShifts'))
const DispatchConsole = lazy(() => import('@/pages/DispatchConsole'))
const ClientSites = lazy(() => import('@/pages/ClientSites'))
const RosterPlanner = lazy(() => import('@/pages/RosterPlanner'))
const OfficerSkills = lazy(() => import('@/pages/OfficerSkills'))
const OfficerAvailability = lazy(() => import('@/pages/OfficerAvailability'))
const ClientOrganisationPortal = lazy(() => import('@/pages/ClientOrganisationPortal'))
const CRMModule = lazy(() => import('@/pages/CRMModule'))
const ContractorAccountPage = lazy(() => import('@/pages/ContractorAccountPage'))
const EMSPortal = lazy(() => import('@/pages/EMSPortal'))
const SiteGuardPortal = lazy(() => import('@/pages/SiteGuardPortal'))
const AccessControlPage = lazy(() => import('@/pages/AccessControlPage'))
const TeamChat = lazy(() => import('@/pages/TeamChat'))

// ---------------------------------------------------------------------------
// PageLoader – minimal spinner shown while a lazy page chunk is downloading.
// Keeps the UI responsive and avoids a blank screen on navigation.
// ---------------------------------------------------------------------------
function PageLoader() {
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
      staleTime: 1000 * 60 * 2, // 2 minutes — reduces waterfall re-fetches on navigation
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: false,
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

  // Client viewer users are limited to their organisation's client portal.
  if (
    user.role === 'client_viewer' &&
    !['/client-portal', '/profile', '/settings'].includes(location.pathname)
  ) {
    return <Navigate to="/client-portal" replace />
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

  if (!user) return <Navigate to="/login" replace />

  // grand_master is the platform owner — bypasses all role restrictions
  if (user.role === 'grand_master') return <>{children}</>

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

/**
 * AreaRoute
 *
 * Extends RoleRoute with portal-area access control.  A user must:
 *   1. Be authenticated (handled by the wrapping ProtectedRoute).
 *   2. Have one of the allowedRoles OR be grand_master/master.
 *   3. Have the portal area code in their portal_access array (if set).
 *
 * grand_master and master roles bypass all area restrictions (they always pass).
 */
function AreaRoute({
  children,
  allowedRoles,
  area,
}: {
  children: React.ReactNode
  allowedRoles: string[]
  area: string
}) {
  const { user } = useAuthStore()

  if (!user) return <Navigate to="/login" replace />

  // grand_master / master bypass all restrictions
  const isSuperUser = user.role === 'grand_master' || user.role === 'master'

  // Role check
  if (!isSuperUser && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />
  }

  // Portal-area check (skip if portal_access is empty — fall back to role only)
  if (!isSuperUser && user.portal_access && user.portal_access.length > 0) {
    if (!user.portal_access.includes(area)) {
      return <Navigate to="/" replace />
    }
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
    }, 3000)

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
        <Suspense fallback={<PageLoader />}>
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
                <AreaRoute allowedRoles={['officer', 'admin_officer']} area="field_officer">
                  <FieldOfficerPortal />
                </AreaRoute>
              </ProtectedRoute>
            }
          />
          {/* Legacy deep-link support */}
          <Route
            path="/field"
            element={<Navigate to="/field-officer" replace />}
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
                <AreaRoute allowedRoles={['admin', 'master']} area="users">
                  <UserManagement />
                </AreaRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/access-control"
            element={
              <ProtectedRoute>
                <AreaRoute allowedRoles={['admin', 'master', 'grand_master']} area="users">
                  <AccessControlPage />
                </AreaRoute>
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
            path="/client-portal"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['client_viewer', 'admin', 'master', 'grand_master']}>
                  <ClientOrganisationPortal />
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
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
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
            path="/team-chat"
            element={
              <ProtectedRoute>
                <TeamChat />
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
                <AreaRoute allowedRoles={['officer', 'admin_officer', 'admin', 'master']} area="parking">
                  <ParkingOfficerPortal />
                </AreaRoute>
              </ProtectedRoute>
            }
          />

          {/* ── Noise Control ────────────────────────────────────────────── */}
          <Route
            path="/noise-control"
            element={
              <ProtectedRoute>
                <AreaRoute allowedRoles={['admin', 'admin_officer', 'master']} area="noise">
                  <NoiseControlPortal />
                </AreaRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/noise-officer"
            element={
              <ProtectedRoute>
                <AreaRoute allowedRoles={['officer', 'admin_officer', 'admin', 'master']} area="noise">
                  <NoiseOfficerPortal />
                </AreaRoute>
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
            path="/points-of-interest"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'officer']}>
                  <PointsOfInterest />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/site-risk-assessment"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'officer']}>
                  <SiteRiskAssessment />
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

          {/* ── Workforce / Dispatch / Roster (new) ─────────────────────── */}
          <Route
            path="/timesheets"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <TimesheetReview />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/open-shifts"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'officer']}>
                  <OpenShifts />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dispatch"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <DispatchConsole />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/client-sites"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <ClientSites />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/roster"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <RosterPlanner />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/officer-skills"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <OfficerSkills />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/availability"
            element={
              <ProtectedRoute>
                <OfficerAvailability />
              </ProtectedRoute>
            }
          />

          {/* CRM – Accounts (Clients + Contractors) */}
          <Route
            path="/crm"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']}>
                  <CRMModule />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/crm/contractor/:orgId"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']}>
                  <ContractorAccountPage />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* EMS – Electronic Monitoring Services */}
          <Route
            path="/ems"
            element={
              <ProtectedRoute>
                <AreaRoute allowedRoles={['officer', 'admin_officer', 'admin', 'master', 'grand_master']} area="ems">
                  <EMSPortal />
                </AreaRoute>
              </ProtectedRoute>
            }
          />

          {/* Site Guard Portal – static guard at a specific client site */}
          <Route
            path="/site-guard"
            element={
              <ProtectedRoute>
                <AreaRoute allowedRoles={['officer', 'admin_officer', 'admin', 'master', 'grand_master']} area="site_guard">
                  <SiteGuardPortal />
                </AreaRoute>
              </ProtectedRoute>
            }
          />

        </Routes>
        </Suspense>
        </RouteErrorBoundary>
        <Toaster position="top-right" />
        <GlobalOperationsBar />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
