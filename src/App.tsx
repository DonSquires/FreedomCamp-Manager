import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { useSessionInactivityLock } from '@/hooks/useSessionInactivityLock'
import { useThemeMode } from '@/hooks/useThemeMode'
import { usePTTAutoConnect } from '@/hooks/usePTTAutoConnect'
import { useSessionGpsLogging } from '@/hooks/useSessionGpsLogging'
import { useOrgModules } from '@/hooks/useOrgModules'
import { useOrganization } from '@/hooks/useOrganization'
import { OrganizationContext } from '@/contexts/OrganizationContext'
import { useFeedbackCapture } from '@/hooks/useFeedbackCapture'
import { useLiveSessionDiagnostics } from '@/hooks/useLiveSessionDiagnostics'
import { getDefaultRouteForRole, getRoleConstrainedRedirect } from '@/navigation/rolePath'
import { isRouteVisibleForRole } from '@/navigation/routeManifestAdapter'
import { routeManifest, type AppRole } from '@/navigation/routeManifest'
import { ShieldOff } from 'lucide-react'

// ---------------------------------------------------------------------------
// Lazy-loaded page chunks — Vite code-splits each of these into a separate
// JS chunk that is only downloaded when the user first navigates to that route.
// This dramatically reduces the initial bundle size and improves Lighthouse
// performance scores (FCP, LCP, TTI).
// ---------------------------------------------------------------------------
const Login = lazy(() => import('@/pages/Login'))
const AdminHub = lazy(() => import('@/pages/AdminHub'))
const AdminPortal = lazy(() => import('@/pages/AdminPortal'))
const FieldOfficerPortal = lazy(() => import('@/pages/FieldOfficerPortal'))
const VehicleManagement = lazy(() => import('@/pages/VehicleManagement'))
const ZoneManagement = lazy(() => import('@/pages/ZoneManagement'))
const CompliancePage = lazy(() => import('@/pages/CompliancePage'))
const Compliance = lazy(() => import('@/pages/Compliance'))  // Unified compliance page
const BreachAlerts = lazy(() => import('@/pages/BreachAlerts'))
const DataManagement = lazy(() => import('@/pages/DataManagement'))
const UserManagement = lazy(() => import('@/pages/UserManagement'))
const OrganizationManagement = lazy(() => import('@/pages/OrganizationManagement'))
const IncidentManagement = lazy(() => import('@/pages/IncidentManagement'))
const Reports = lazy(() => import('@/pages/Reports'))
const CleanupAndRecalculate = lazy(() => import('@/pages/CleanupAndRecalculate'))
const PhotoReingest = lazy(() => import('@/pages/PhotoReingest'))
const EvidencePhotoLinker = lazy(() => import('@/pages/EvidencePhotoLinker'))
const LiveOfficerTracking = lazy(() => import('@/pages/LiveOfficerTracking'))
const OrganizationProfile = lazy(() => import('@/pages/OrganizationProfile'))
const AuditLog = lazy(() => import('@/pages/AuditLog'))
const ComplianceRecalculation = lazy(() => import('@/pages/ComplianceRecalculation'))
const InfringementNotices = lazy(() => import('@/pages/InfringementNotices'))
const PrivacyCurtain = lazy(() => import('@/pages/PrivacyCurtain'))
const PatrolCheckpointManagement = lazy(() => import('@/pages/PatrolCheckpointManagement'))
const PatrolScheduleManagement = lazy(() => import('@/pages/PatrolScheduleManagement'))
const PatrolKPIDashboard = lazy(() => import('@/pages/PatrolKPIDashboard'))
const DataManagementHub = lazy(() => import('@/pages/DataManagementHub'))
const LivePatrolMonitor = lazy(() => import('@/pages/LivePatrolMonitor'))
const CustomReportBuilder = lazy(() => import('@/pages/CustomReportBuilder'))
const AiAnalysis = lazy(() => import('@/pages/AiAnalysis'))
const HotspotsMap = lazy(() => import('@/pages/HotspotsMap'))
const SpatialComplianceAdmin = lazy(() => import('@/pages/SpatialComplianceAdmin'))
const ComplianceAnalytics = lazy(() => import('@/pages/ComplianceAnalytics'))
const IncidentReports = lazy(() => import('@/pages/IncidentReports'))
const ObservationsView = lazy(() => import('@/pages/ObservationsView'))
const ObservationRecords = lazy(() => import('@/pages/ObservationRecords'))
const UniversalSearch = lazy(() => import('@/pages/UniversalSearch'))
const NoticeToVacate = lazy(() => import('@/pages/NoticeToVacate'))
const EnforcementActions = lazy(() => import('@/pages/EnforcementActions'))
const EnforcementCommandCenter = lazy(() => import('@/pages/EnforcementCommandCenter'))
const OfficerWelfareSettings = lazy(() => import('@/pages/OfficerWelfareSettings'))
const EnforcementReview = lazy(() => import('@/pages/EnforcementReview'))
const InvestigationJobsPage = lazy(() => import('@/pages/InvestigationJobsPage'))
const VehicleDetailPage = lazy(() => import('@/pages/VehicleDetailPage'))
const PersonRecords = lazy(() => import('@/pages/PersonRecords'))
const DispatchLOIBrowser = lazy(() => import('@/pages/DispatchLOIBrowser'))
const TrespassNotices = lazy(() => import('@/pages/TrespassNotices'))
const AccessPermissions = lazy(() => import('@/pages/AccessPermissions'))
const CanonicalPersonViewer = lazy(() => import('@/pages/CanonicalPersonViewer'))
const ImportData = lazy(() => import('@/pages/ImportData'))
const ImportHistoricalData = lazy(() => import('@/pages/ImportHistoricalData'))
const BreachNotices = lazy(() => import('@/pages/BreachNotices'))
const ObservationsReport = lazy(() => import('@/pages/ObservationsReport'))
const PortalSelection = lazy(() => import('@/pages/PortalSelection'))
const Settings = lazy(() => import('@/pages/Settings'))
const Profile = lazy(() => import('@/pages/Profile'))
const VehicleRegistry = lazy(() => import('@/pages/VehicleRegistry'))
const CanonicalRecordsManager = lazy(() => import('@/pages/CanonicalRecordsManager'))
const CohortAnalysis = lazy(() => import('@/pages/CohortAnalysis'))
const MobilePlateFinder = lazy(() => import('@/pages/MobilePlateFinder'))
const EvidencePackages = lazy(() => import('@/pages/EvidencePackages'))
const AlarmEvents = lazy(() => import('@/pages/AlarmEvents'))
const OccupancyAnalytics = lazy(() => import('@/pages/OccupancyAnalytics'))
const PatrolRouteOptimiser = lazy(() => import('@/pages/PatrolRouteOptimiser'))
const FixedCameras = lazy(() => import('@/pages/FixedCameras'))
const PublicPayByPlate = lazy(() => import('@/pages/PublicPayByPlate'))
const PatrolNavigation = lazy(() => import('@/pages/PatrolNavigation'))
const DynamicPricing = lazy(() => import('@/pages/DynamicPricing'))
const RevenueForecast = lazy(() => import('@/pages/RevenueForecast'))
const LMRBridge = lazy(() => import('@/pages/LMRBridge'))
const CaseBridge = lazy(() => import('@/pages/CaseBridge'))
const ServiceAgreements = lazy(() => import('@/pages/ServiceAgreements'))
const POIVOIDashboard = lazy(() => import('@/pages/POIVOIDashboard'))
const AccessAuditLog = lazy(() => import('@/pages/AccessAuditLog'))
const PublicDisputePortal = lazy(() => import('@/pages/PublicDisputePortal'))
const PublicFreedomCampingMap = lazy(() => import('@/pages/PublicFreedomCampingMap'))
const PublicNoiseComplaintPortal = lazy(() => import('@/pages/PublicNoiseComplaintPortal'))
const PublicParkingAppealPortal = lazy(() => import('@/pages/PublicParkingAppealPortal'))
const PublicCamperRegistration = lazy(() => import('@/pages/PublicCamperRegistration'))
const Disputes = lazy(() => import('@/pages/Disputes'))
const Platform = lazy(() => import('@/pages/Platform'))
const ComplianceEscalations = lazy(() => import('@/pages/ComplianceEscalations'))
const ParkingEnforcementPortal = lazy(() => import('@/pages/ParkingEnforcementPortal'))
const ParkingOfficerPortal = lazy(() => import('@/pages/ParkingOfficerPortal'))
const NoiseControlPortal = lazy(() => import('@/pages/NoiseControlPortal'))
const NoiseOfficerPortal = lazy(() => import('@/pages/NoiseOfficerPortal'))
const BiosecurityOfficerPortal = lazy(() => import('@/pages/BiosecurityOfficerPortal'))
const BiosecurityControlPage = lazy(() => import('@/pages/BiosecurityControlPage'))
const SmokeComplaintOfficerPortal = lazy(() => import('@/pages/SmokeComplaintOfficerPortal'))
const SmokeComplaintControlPage = lazy(() => import('@/pages/SmokeComplaintControlPage'))
const PointsOfInterest = lazy(() => import('@/pages/PointsOfInterest'))
const SiteRiskAssessment = lazy(() => import('@/pages/SiteRiskAssessment'))
const VehicleDiscrepancies = lazy(() => import('@/pages/VehicleDiscrepancies'))
const NZSCVMonitor = lazy(() => import('@/pages/NZSCVMonitor'))
const NotificationsCenter = lazy(() => import('@/pages/NotificationsCenter'))
const FaceRecognitionPage = lazy(() => import('@/pages/FaceRecognitionPage'))
const IdentityVerificationPage = lazy(() => import('@/pages/IdentityVerificationPage'))
const TimesheetReview = lazy(() => import('@/pages/TimesheetReview'))
const OpenShifts = lazy(() => import('@/pages/OpenShifts'))
const DispatchConsole = lazy(() => import('@/pages/DispatchConsole'))
const FieldOfficerDispatch = lazy(() => import('@/pages/FieldOfficerDispatch'))
const JobMap = lazy(() => import('@/pages/JobMap'))
const ClientSites = lazy(() => import('@/pages/ClientSites'))
const SitePermissionsAdmin = lazy(() => import('@/pages/SitePermissionsAdmin'))
const ClientMasterList = lazy(() => import('@/pages/ClientMasterList'))
const DispatchMonitor = lazy(() => import('@/pages/DispatchMonitor'))
const DispatchWizard = lazy(() => import('@/pages/DispatchWizard'))
const DispatchedJobsList = lazy(() => import('@/pages/DispatchedJobsList'))
const RosterPlanner = lazy(() => import('@/pages/RosterPlanner'))
const OfficerSkills = lazy(() => import('@/pages/OfficerSkills'))
const OfficerAvailability = lazy(() => import('@/pages/OfficerAvailability'))
const AssetManagement = lazy(() => import('@/pages/AssetManagement'))
const ClientOrganisationPortal = lazy(() => import('@/pages/ClientOrganisationPortal'))
const InvoicingPage = lazy(() => import('@/pages/InvoicingPage'))
const PricingPage = lazy(() => import('@/pages/PricingPage'))
const OperationsMap = lazy(() => import('@/pages/OperationsMap'))
const CRMModule = lazy(() => import('@/pages/CRMModule'))
const ContractorAccountPage = lazy(() => import('@/pages/ContractorAccountPage'))
const ClientAccountPage = lazy(() => import('@/pages/ClientAccountPage'))
const EMSPortal = lazy(() => import('@/pages/EMSPortal'))
const SiteGuardPortal = lazy(() => import('@/pages/SiteGuardPortal'))
const AccessControlPage = lazy(() => import('@/pages/AccessControlPage'))
const TeamChat = lazy(() => import('@/pages/TeamChat'))
const PTTRadio = lazy(() => import('@/pages/PTTRadio'))
const PTTTransmissionLog = lazy(() => import('@/pages/PTTTransmissionLog').then((m) => ({ default: m.PTTTransmissionLog })))
const RadioAuditDashboard = lazy(() => import('@/pages/RadioAuditDashboard'))
const RadioTransmissionsLog = lazy(() => import('@/pages/RadioTransmissionsLog'))
const VoiceProfilesConsent = lazy(() => import('@/pages/VoiceProfilesConsent'))
const InvestigationJobLog = lazy(() => import('@/pages/InvestigationJobLog'))
const OperationalCaseLog = lazy(() => import('@/pages/OperationalCaseLog'))
const PatrolEventLog = lazy(() => import('@/pages/PatrolEventLog'))
const MessagingPage = lazy(() => import('@/modules/messaging'))
const IntelApprovalQueue = lazy(() => import('@/pages/IntelApprovalQueue'))
const BobIntakeQueue = lazy(() => import('@/pages/BobIntakeQueue'))
const BobAssistantStudio = lazy(() => import('@/pages/BobAssistantStudio'))
const BobUIReview = lazy(() => import('@/pages/BobUIReview'))
const OpsLivePlanReviewQueue = lazy(() => import('@/pages/OpsLivePlanReviewQueue'))
  const BobStudio = lazy(() => import('@/pages/BobStudio'))
const OfficerHomePage = lazy(() => import('@/pages/OfficerHomePage'))
const TenderWorkspace = lazy(() => import('@/pages/TenderWorkspace'))
const TenderWorkspaceDetail = lazy(() => import('@/pages/TenderWorkspaceDetail'))
const TenderReferenceLibrary = lazy(() => import('@/pages/TenderReferenceLibrary'))
const ServiceProviderAccessSettings = lazy(() => import('@/pages/admin/ServiceProviderAccessSettings'))
const GrandmasterCodingStudio = lazy(() => import('@/pages/GrandmasterCodingStudio'))
const SystemDiagnostics = lazy(() => import('@/pages/SystemDiagnostics'))
const DataCleanupUtility = lazy(() => import('@/pages/DataCleanupUtility'))
const DataIntegrityDashboard = lazy(() => import('@/pages/DataIntegrityDashboard'))
const CleanDashboard = lazy(() => import('@/pages/CleanDashboard'))
const TestDashboard = lazy(() => import('@/pages/TestDashboard'))

const NetworkStatusBar = lazy(() => import('@/components/features/NetworkStatusBar').then((m) => ({ default: m.NetworkStatusBar })))
const PWAInstallPrompt = lazy(() => import('@/components/features/PWAInstallPrompt').then((m) => ({ default: m.PWAInstallPrompt })))
const GlobalOperationsBar = lazy(() => import('@/components/features/GlobalOperationsBar').then((m) => ({ default: m.GlobalOperationsBar })))

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

// Detects the "Failed to fetch dynamically imported module" error thrown by
// browsers when a Vite code-split chunk URL no longer exists after a new
// deployment (content-hash rotation).  Both Chrome and Firefox/Safari use
// slightly different messages so we check for all known variants.
function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false
  const msg = error.message || ''
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    /Loading chunk \d+ failed/.test(msg)
  )
}

const CHUNK_RELOAD_KEY = 'chunk-reload-attempted'

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

    // If the error is a stale-chunk fetch failure (new deployment rotated the
    // content-hash filenames) attempt a single automatic full-page reload to
    // pick up the fresh assets.  A sessionStorage flag acts as a circuit-
    // breaker so we never reload more than once per session for this reason.
    if (isChunkLoadError(error)) {
      const alreadyReloaded = sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1'
      if (!alreadyReloaded) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
        window.location.reload()
      }
    }
  }

  render() {
    if (this.state.hasError) {
      const chunkError = isChunkLoadError(this.state.error)
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-8">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-2xl font-bold text-destructive">
              {chunkError ? 'App updated — reload required' : 'Something went wrong'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {chunkError
                ? 'A new version of the app has been deployed. Please reload the page to continue.'
                : (this.state.error?.message || 'An unexpected error occurred.')}
            </p>
            <div className="flex gap-3 justify-center">
              {chunkError ? (
                <button
                  className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm"
                  onClick={() => window.location.reload()}
                >
                  Reload Now
                </button>
              ) : (
                <button
                  className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm"
                  onClick={() => this.setState({ hasError: false, error: null })}
                >
                  Try Again
                </button>
              )}
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

function GlobalAppObservers() {
  useFeedbackCapture()
  useLiveSessionDiagnostics()

  return null
}

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 minutes — reduces waterfall re-fetches on navigation
      gcTime: 1000 * 60 * 10, // 10 minutes — garbage collect unused queries to prevent memory leaks
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: false,
    },
  },
})

// ---------------------------------------------------------------------------
// AccessDenied — replaces silent role-mismatch redirects with explicit guidance
// ---------------------------------------------------------------------------
function AccessDenied({ requiredRoles, currentRole }: { requiredRoles: string[]; currentRole: string }) {
  const navigate = useNavigate()
  const defaultPath = getDefaultRouteForRole(currentRole)
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="h-16 w-16 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
            <ShieldOff className="h-8 w-8 text-red-500" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-foreground">Access Restricted</h1>
          <p className="text-sm text-muted-foreground">
            Your current role (<strong>{currentRole.replace(/_/g, ' ')}</strong>) does not have
            permission to view this page.
          </p>
          {requiredRoles.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Required: {requiredRoles.map(r => r.replace(/_/g, ' ')).join(', ')}
            </p>
          )}
        </div>
        <button
          onClick={() => navigate(defaultPath, { replace: true })}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Go to my portal
        </button>
      </div>
    </div>
  )
}

// Protected Route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore()
  const location = useLocation()

  // Auto-connect to PTT when authenticated
  usePTTAutoConnect()
  useSessionGpsLogging()

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

  const roleConstrainedRedirect = getRoleConstrainedRedirect(
    user.role,
    location.pathname,
    hasPortalChoice(),
  )
  if (roleConstrainedRedirect) {
    return <Navigate to={roleConstrainedRedirect} replace />
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
  const location = useLocation()

  if (!user) return <Navigate to="/login" replace />

  const activeFeatureFlags = new Set<string>()
  if (user.role === 'master' || user.role === 'grand_master') {
    activeFeatureFlags.add('enable_internal_tools')
  }

  const normalizePath = (path: string) => (path !== '/' ? path.replace(/\/+$/, '') : path)
  const currentPath = normalizePath(location.pathname)
  const manifestEntry = routeManifest.find((entry) => normalizePath(entry.path) === currentPath)
  if (
    manifestEntry &&
    !isRouteVisibleForRole(
      manifestEntry.path,
      user.role as AppRole,
      routeManifest,
      activeFeatureFlags,
    )
  ) {
    return <AccessDenied requiredRoles={manifestEntry.rolesAllowed} currentRole={user.role} />
  }

  // grand_master is the platform owner — bypasses all role restrictions
  if (user.role === 'grand_master') return <>{children}</>

  if (!allowedRoles.includes(user.role)) {
    return <AccessDenied requiredRoles={allowedRoles} currentRole={user.role} />
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
  const { hasAreaAccess, isLoading: modulesLoading } = useOrgModules()
  const orgCtx = useOrganization()

  if (!user) return <Navigate to="/login" replace />

  // grand_master / master bypass all restrictions
  const isSuperUser = user.role === 'grand_master' || user.role === 'master'

  // Role check
  if (!isSuperUser && !allowedRoles.includes(user.role)) {
    return <Navigate to={getDefaultRouteForRole(user.role)} replace />
  }

  // Portal-area check (skip if portal_access is empty — fall back to role only)
  if (!isSuperUser && user.portal_access && user.portal_access.length > 0) {
    if (!user.portal_access.includes(area)) {
      return <Navigate to={getDefaultRouteForRole(user.role)} replace />
    }
  }

  // Module subscription check — don't block while loading (fallback = allow all)
  if (!isSuperUser && !modulesLoading && !hasAreaAccess(area)) {
    return <Navigate to="/portal-selection" replace />
  }

  return (
    <OrganizationContext.Provider value={orgCtx}>
      {children}
    </OrganizationContext.Provider>
  )
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
            <p className="text-lg font-semibold text-foreground">FieldOps Manager</p>
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
        <GlobalAppObservers />
        <Suspense fallback={null}>
          <NetworkStatusBar />
          <PWAInstallPrompt />
        </Suspense>
        <RouteErrorBoundary>
        <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/dispute" element={<PublicDisputePortal />} />
          <Route path="/public/zone-map" element={<PublicFreedomCampingMap />} />
          <Route path="/public/noise-complaint" element={<PublicNoiseComplaintPortal />} />
          <Route path="/public/parking-appeal" element={<PublicParkingAppealPortal />} />
          <Route path="/public/pay-by-plate" element={<PublicPayByPlate />} />
          <Route path="/public/register" element={<PublicCamperRegistration />} />
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

          {/* Officer home – shown when not rostered / outside geofence */}
          <Route
            path="/officer-home"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['officer', 'admin_officer']}>
                  <OfficerHomePage />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* Field Officer Dispatch bootstrap route */}
          <Route
            path="/field-officer/dispatch"
            element={
              <ProtectedRoute>
                <AreaRoute allowedRoles={['officer', 'admin_officer']} area="field_officer">
                  <FieldOfficerDispatch />
                </AreaRoute>
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
          {/* Backward-compatibility redirect for legacy deep-links */}
          <Route
            path="/field"
            element={<Navigate to="/field-officer?service=freedom_camping" replace />}
          />
          {/* Protected routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                {user?.role === 'officer' ? (
                  <Navigate to="/officer-home" replace />
                ) : user?.role === 'admin_officer' ? (
                  <Navigate to="/portal-selection" replace />
                ) : user?.role === 'nzscv_monitor' ? (
                  <Navigate to="/admin/nzscv" replace />
                ) : (
                  <AdminHub />
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
                  <AdminHub />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* Full operational dashboard — accessible from the hub card */}
          <Route
            path="/admin/dashboard"
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
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <DataManagement />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/users"
            element={
              <ProtectedRoute>
                <AreaRoute allowedRoles={['admin', 'admin_officer', 'master']} area="users">
                  <UserManagement />
                </AreaRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/access-control"
            element={
              <ProtectedRoute>
                <AreaRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']} area="users">
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
            path="/grandmaster-code-studio"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['grand_master']}>
                  <GrandmasterCodingStudio />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/compliance-escalations"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['grand_master']}>
                  <ComplianceEscalations />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/client-portal"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['client_viewer', 'client_officer', 'client_admin', 'admin', 'admin_officer', 'master', 'grand_master']}>
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
            path="/evidence-packages"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'officer']}>
                  <EvidencePackages />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/cohort-analysis"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <CohortAnalysis />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/alarm-events"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <AlarmEvents />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/occupancy-analytics"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <OccupancyAnalytics />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/patrol-route-optimiser"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'officer']}>
                  <PatrolRouteOptimiser />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/fixed-cameras"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <FixedCameras />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/patrol-navigation"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'officer']}>
                  <PatrolNavigation />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/dynamic-pricing"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <DynamicPricing />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/revenue-forecasting"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <RevenueForecast />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/lmr-bridge"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <LMRBridge />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* Case Bridge — operational case management (B-37) */}
          <Route
            path="/case-bridge"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']}>
                  <CaseBridge />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* Service Agreements (B-39) */}
          <Route
            path="/service-agreements"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']}>
                  <ServiceAgreements />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* POI / VOI Watch-list Dashboard (B-40) */}
          <Route
            path="/poi-voi-dashboard"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']}>
                  <POIVOIDashboard />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* Access Entries Audit Log (B-41) */}
          <Route
            path="/access-audit"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']}>
                  <AccessAuditLog />
                </RoleRoute>
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
                <RoleRoute allowedRoles={['master', 'grand_master']}>
                  <SystemDiagnostics />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/test-dashboard"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']}>
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
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']}>
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
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
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
            path="/admin/enforcement"
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
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
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
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <DataManagementHub />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/data-cleanup"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
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
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
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

          <Route path="/reports-hub" element={<Navigate to="/reports" replace />} />

          <Route
            path="/custom-reports"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <CustomReportBuilder />
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
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <HotspotsMap />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/spatial-compliance"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
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
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <IncidentReports />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/observations"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <ObservationsView />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route path="/observation-records" element={<Navigate to="/observations" replace />} />

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
            path="/radio"
            element={
              <ProtectedRoute>
                <PTTRadio />
              </ProtectedRoute>
            }
          />

          <Route
            path="/radio/log"
            element={
              <ProtectedRoute>
                <PTTTransmissionLog />
              </ProtectedRoute>
            }
          />

          <Route
            path="/radio/audit"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']}>
                  <RadioAuditDashboard />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/radio-transmissions"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <RadioTransmissionsLog />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/voice-profiles"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <VoiceProfilesConsent />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

            <Route
              path="/messages"
              element={
                <ProtectedRoute>
                  <MessagingPage />
                </ProtectedRoute>
              }
            />

          <Route
            path="/intel-approvals"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['master', 'grand_master']}>
                  <IntelApprovalQueue />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/bob-intake-queue"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']}>
                  <BobIntakeQueue />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/bob-assistant"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'officer', 'grand_master']}>
                  <BobAssistantStudio />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/bob-ui-review"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']}>
                  <BobUIReview />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/live-plan-reviews"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']}>
                  <OpsLivePlanReviewQueue />
                </RoleRoute>
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
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'nzscv_monitor']}>
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

          {/* ── Biosecurity Inspection ───────────────────────────────────── */}
          <Route
            path="/biosecurity-control"
            element={
              <ProtectedRoute>
                <AreaRoute allowedRoles={['admin', 'admin_officer', 'master']} area="biosecurity">
                  <BiosecurityControlPage />
                </AreaRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/biosecurity-officer"
            element={
              <ProtectedRoute>
                <AreaRoute allowedRoles={['officer', 'admin_officer', 'admin', 'master']} area="biosecurity">
                  <BiosecurityOfficerPortal />
                </AreaRoute>
              </ProtectedRoute>
            }
          />

          {/* ── Smoke Complaint OOH ──────────────────────────────────────── */}
          <Route
            path="/smoke-control"
            element={
              <ProtectedRoute>
                <AreaRoute allowedRoles={['admin', 'admin_officer', 'master']} area="smoke">
                  <SmokeComplaintControlPage />
                </AreaRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/smoke-officer"
            element={
              <ProtectedRoute>
                <AreaRoute allowedRoles={['officer', 'admin_officer', 'admin', 'master']} area="smoke">
                  <SmokeComplaintOfficerPortal />
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
            path="/loi-browser"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <DispatchLOIBrowser />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/trespass-notices"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <TrespassNotices />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/access-permissions"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <AccessPermissions />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/canonical-persons"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <CanonicalPersonViewer />
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
            path="/identity-verification"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <IdentityVerificationPage />
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
                <RoleRoute allowedRoles={['admin', 'master']}>
                  <ImportHistoricalData />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/breach-notices"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'officer']}>
                  <BreachNotices />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path="/observations-report"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <ObservationsReport />
                </RoleRoute>
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
            path="/admin/service-provider-access"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master']}>
                  <ServiceProviderAccessSettings />
                </RoleRoute>
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
            path="/plate-finder"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'officer']}>
                  <MobilePlateFinder />
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
          <Route path="/compliance-dashboard" element={<Navigate to="/compliance" replace />} />
          <Route
            path="/clean-dashboard"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <CleanDashboard />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* Asset Management — equipment, stock, stocktake, keys */}
          <Route
            path="/asset-management"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']}>
                  <AssetManagement />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* Invoicing — read-only billing view */}
          <Route
            path="/invoicing"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']}>
                  <InvoicingPage />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* Pricing — per-client service rate management */}
          <Route
            path="/pricing"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']}>
                  <PricingPage />
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
            path="/admin/dispatch"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <DispatchConsole />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dispatch-monitor"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <DispatchMonitor />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dispatch-wizard"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <DispatchWizard />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dispatched-jobs"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <DispatchedJobsList />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/job-map"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'officer']}>
                  <JobMap />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/operations-map"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <OperationsMap />
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
            path="/site-permissions"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master', 'grand_master']}>
                  <SitePermissionsAdmin />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/client-master-list"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <ClientMasterList />
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
          <Route
            path="/crm/client/:orgId"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master', 'grand_master']}>
                  <ClientAccountPage />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* Tender Workspace */}
          <Route
            path="/tender-workspace"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master', 'grand_master']}>
                  <TenderWorkspace />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/tender-workspace/:id"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master', 'grand_master']}>
                  <TenderWorkspaceDetail />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/tender-reference-library"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'master', 'grand_master']}>
                  <TenderReferenceLibrary />
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

          {/* Sprint 23 — B-79 Investigation Job Log */}
          <Route
            path="/investigation-jobs-log"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <InvestigationJobLog />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* Sprint 23 — B-80 Operational Case Log */}
          <Route
            path="/operational-cases-log"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <OperationalCaseLog />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

          {/* Sprint 23 — B-81 Patrol Event Log */}
          <Route
            path="/patrol-events-log"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={['admin', 'admin_officer', 'master']}>
                  <PatrolEventLog />
                </RoleRoute>
              </ProtectedRoute>
            }
          />

        </Routes>
        </Suspense>
        </RouteErrorBoundary>
        <Toaster position="top-right" />
        <Suspense fallback={null}>
          <GlobalOperationsBar />
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

