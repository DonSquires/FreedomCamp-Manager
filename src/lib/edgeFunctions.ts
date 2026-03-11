/**
 * Edge Functions Library - Type-safe wrappers for all 47 Supabase Edge Functions
 * 
 * This library provides a centralized interface for calling all Edge Functions
 * with proper error handling, type safety, and toast notifications.
 */

import { supabase } from './supabase'
import { toast } from 'sonner'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { useSessionLockStore } from '@/stores/sessionLockStore'

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000

async function readFunctionsErrorText(error: FunctionsHttpError): Promise<string> {
  try {
    const response = error.context as Response | undefined
    if (!response) return ''

    // Clone to avoid consuming the original body stream for other handlers.
    const readable = typeof response.clone === 'function' ? response.clone() : response
    return await readable.text()
  } catch {
    return ''
  }
}

async function isJwtAuthError(error: unknown): Promise<boolean> {
  if (!(error instanceof FunctionsHttpError)) return false

  const statusCode = error.context?.status ?? 0
  if (statusCode !== 401) return false

  const textContent = await readFunctionsErrorText(error)
  if (!textContent) return false

  try {
    const parsed = JSON.parse(textContent)
    const gatewayMsg: string = parsed?.message || ''
    return gatewayMsg === 'Invalid JWT' || gatewayMsg === 'JWT expired'
  } catch {
    return false
  }
}

async function tryRefreshAccessToken(): Promise<string | null> {
  const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError || !refreshData.session) {
    return null
  }
  return refreshData.session.access_token
}

async function getValidAccessToken(): Promise<string | null> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError) {
    throw new Error(sessionError.message || 'Unable to read current session')
  }

  if (!sessionData.session) {
    // Recover from transient client state where refresh token exists but active
    // session has not been rehydrated yet.
    return tryRefreshAccessToken()
  }

  const session = sessionData.session
  const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0

  // Refresh when: expiry is unknown (0), token has already expired, or expiry is within buffer window
  const shouldRefresh = expiresAtMs === 0 || (expiresAtMs - Date.now()) < ACCESS_TOKEN_REFRESH_BUFFER_MS

  if (shouldRefresh) {
    const refreshedAccessToken = await tryRefreshAccessToken()
    if (refreshedAccessToken) {
      return refreshedAccessToken
    }

    // Graceful fallback: if current token is still technically valid, allow one attempt.
    if (expiresAtMs > Date.now()) {
      return session.access_token
    }

    throw new Error('Session refresh failed. Please retry. If the problem continues, sign in again.')
  }

  return session.access_token
}

/**
 * Helper to extract error message from FunctionsHttpError
 */
async function getErrorMessage(error: any): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const statusCode = error.context?.status ?? 500
      const textContent = await readFunctionsErrorText(error)

      if (statusCode === 401 && textContent) {
        try {
          const parsed = JSON.parse(textContent)
          // Supabase gateway returns {"message":"Invalid JWT"} or {"message":"JWT expired"}
          const gatewayMsg: string = parsed?.message || ''
          if (gatewayMsg === 'Invalid JWT' || gatewayMsg === 'JWT expired') {
            return 'Session expired. Please sign in again.'
          }
        } catch {
          // Keep raw response when body is not JSON.
        }
      }

      return `[Code: ${statusCode}] ${textContent || error.message || 'Unknown error'}`
    } catch {
      return error.message || 'Failed to read response'
    }
  }
  return error.message || 'Unknown error'
}

/**
 * Generic Edge Function caller with error handling
 */
async function callEdgeFunction<T = any>(
  functionName: string,
  body?: any,
  options: { showToast?: boolean } = { showToast: true }
): Promise<{ data: T | null; error: string | null }> {
  const { lock, unlock } = useSessionLockStore.getState()

  try {
    const accessToken = await getValidAccessToken()
    if (!accessToken) {
      const errorMessage = 'No active session found. Please sign in again and retry.'
      lock('Session Lockout', 'Your session is no longer active. Log back in to unlock this workspace.')
      if (options.showToast) {
        toast.error(errorMessage)
      }
      return { data: null, error: errorMessage }
    }

    const { data, error } = await supabase.functions.invoke(functionName, {
      body: body || {},
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (error) {
      // Retry once after forced refresh for transient JWT invalid/expired responses.
      if (await isJwtAuthError(error)) {
        const refreshedAccessToken = await tryRefreshAccessToken()
        if (refreshedAccessToken) {
          const retryResult = await supabase.functions.invoke(functionName, {
            body: body || {},
            headers: {
              Authorization: `Bearer ${refreshedAccessToken}`,
            },
          })

          if (!retryResult.error) {
            unlock()
            return { data: retryResult.data as T, error: null }
          }
        }

        const authErrorMessage = 'Session expired during request. Please retry once or sign in again.'
        lock('Session Timed Out', 'Your session expired while this task was running. Log back in to continue safely.')
        if (options.showToast) {
          toast.error(authErrorMessage)
        }
        return { data: null, error: authErrorMessage }
      }

      const errorMessage = await getErrorMessage(error)
      if (options.showToast) {
        toast.error(errorMessage)
      }
      return { data: null, error: errorMessage }
    }

    unlock()
    return { data, error: null }
  } catch (error: any) {
    const errorMessage = await getErrorMessage(error)
    if (errorMessage.toLowerCase().includes('session')) {
      lock('Session Lockout', 'Your session could not be refreshed. Log back in to unlock this workspace.')
    }
    if (options.showToast) {
      toast.error(errorMessage)
    }
    return { data: null, error: errorMessage }
  }
}

// ============================================================================
// COMPLIANCE & BREACH MANAGEMENT (9 functions)
// ============================================================================

export const edgeFunctions = {
  /**
   * Process ALPR - Plate Recognizer pipeline
   */
  processALPR: async (params: {
    photo_url: string
    latitude: number
    longitude: number
    accuracy?: number
    officer_id?: string
    organization_id?: string
    zone_id?: string
    /** UUID of an existing observation being updated (background processing mode) */
    observation_id?: string
    /** Optional incident/case to link this observation to */
    incident_id?: string
    /** Previous observation in the same incident for movement comparison */
    previous_observation_id?: string
  }) => {
    return callEdgeFunction('alpr-process', params)
  },

  /**
   * Retry ALPR processing on incident evidence
   */
  retryALPR: async (params: {
    incident_id: string
  }) => {
    return callEdgeFunction('alpr-retry', params)
  },

  /**
   * Check almost breaches (predict overnight violations)
   */
  checkAlmostBreaches: async (params: {
    organization_id?: string
    zone_id?: string
  }) => {
    return callEdgeFunction('check-almost-breaches', params)
  },

  /**
   * Scan all vehicles for compliance breaches
   */
  scanBreaches: async (params: {
    organization_id?: string
    zone_id?: string
  }) => {
    return callEdgeFunction('scan-breaches', params)
  },

  /**
   * Bulk compliance recalculation (v2 schema – observations table, BATCH_SIZE=150).
   * Accepts both legacy and structured parameter formats.
   * Toast display is suppressed here — callers are responsible for error feedback.
   */
  recalculateCompliance: async (params: {
    // Legacy params
    organization_id?: string
    zone_id?: string
    observation_id?: string
    observation_ids?: string[]
    date_from?: string
    date_to?: string
    // Structured params
    scope_type?: 'ZONE' | 'ORG' | 'BUILD'
    zone_ids?: string[]
    organization_ids?: string[]
    date_range_start?: string
    date_range_end?: string
  }) => {
    return callEdgeFunction('recalculate-compliance', params, { showToast: false })
  },

  /**
   * Strict zone-based compliance recalculation.
   *
   * Canonical runtime now routes through recalculate-compliance-v3 while
   * preserving the v2 parameter/response shape expected by existing UI.
   */
  recalculateComplianceV2: async (params: {
    zone_id?: string
    zone_ids?: string[]
    date_from?: string
    date_to?: string
    get_total?: boolean
    offset?: number
    batch_size?: number
  }) => {
    const zoneIds = params.zone_ids && params.zone_ids.length > 0
      ? params.zone_ids
      : params.zone_id
        ? [params.zone_id]
        : []

    const v3Response = await callEdgeFunction('recalculate-compliance-v3', {
      zone_ids: zoneIds,
      date_from: params.date_from,
      date_to: params.date_to,
      get_total: params.get_total,
      offset: params.offset,
      limit: params.batch_size,
      apply: true,
    })

    if (v3Response.error || !v3Response.data) {
      return v3Response
    }

    const data: any = v3Response.data
    if (params.get_total) {
      return {
        data: {
          total: Number(data.total ?? 0),
        },
        error: null,
      }
    }

    return {
      data: {
        processed: Number(data.processed ?? 0),
        complianceChanged: Number(data.compliance_changed ?? 0),
        breachesCreated: Number(data.breaches_created ?? 0),
        skippedNoRules: Number(data.skipped_no_rules ?? 0),
      },
      error: null,
    }
  },

  /**
   * Fresh compliance recalculation path for current observations schema.
   * This function is independent from legacy vehicle_observations_v2 logic.
   */
  recalculateComplianceV3: async (params: {
    zone_id?: string
    zone_ids?: string[]
    organization_id?: string
    date_from?: string
    date_to?: string
    limit?: number
    offset?: number
    apply?: boolean
    get_total?: boolean
  }) => {
    return callEdgeFunction('recalculate-compliance-v3', params)
  },

  /**
   * UI-pinned compliance recalculation invoker.
   *
   * This keeps Admin UI flows locked to recalculate-compliance-v3 and returns
   * stable fields expected by the Compliance Recalculation page.
   */
  recalculateComplianceUIPinned: async (params: {
    zone_id?: string
    zone_ids?: string[]
    date_from?: string
    date_to?: string
    get_total?: boolean
    offset?: number
    batch_size?: number
  }) => {
    const zoneIds = params.zone_ids && params.zone_ids.length > 0
      ? params.zone_ids
      : params.zone_id
        ? [params.zone_id]
        : []

    const v3Response = await callEdgeFunction('recalculate-compliance-v3', {
      zone_ids: zoneIds,
      date_from: params.date_from,
      date_to: params.date_to,
      get_total: params.get_total,
      offset: params.offset,
      limit: params.batch_size,
      apply: true,
    })

    if (v3Response.error || !v3Response.data) {
      return v3Response
    }

    const data: any = v3Response.data
    if (params.get_total) {
      return {
        data: {
          total: Number(data.total ?? 0),
        },
        error: null,
      }
    }

    return {
      data: {
        processed: Number(data.processed ?? 0),
        complianceChanged: Number(data.compliance_changed ?? 0),
        breachesCreated: Number(data.breaches_created ?? 0),
        skippedNoRules: Number(data.skipped_no_rules ?? 0),
      },
      error: null,
    }
  },

  /**
   * Test observations against zone compliance matrix and populate
   * observation compliance fields (is_compliant, breach_type, breach_reason).
   */
  testComplianceMatrix: async (params: {
    organization_id?: string
    zone_id?: string
    observation_id?: string
    limit?: number
    offset?: number
    apply?: boolean
    date_from?: string
    date_to?: string
  }) => {
    return callEdgeFunction('test-compliance-matrix', params)
  },

  /**
   * 3-phase cleanup: zone correction → dedup → compliance recalc
   */
  cleanupAndRecalculate: async (params: {
    organization_id?: string
  }) => {
    return callEdgeFunction('cleanup-and-recalculate', params)
  },

  /**
   * Match observations with ParkPow sessions and sync photos into storage.
   */
  syncParkPowPhotos: async (params: {
    date_from?: string
    date_to?: string
    window_minutes?: number
    limit?: number
    apply?: boolean
    require_empty_photo?: boolean
    target_bucket?: string
    parkpow_base_url?: string
    max_session_pages?: number
  }) => {
    return callEdgeFunction('parkpow-photo-sync', params)
  },

  /**
   * Recover deleted observation photos using ParkPow as source-of-truth.
   */
  recoverObservationPhotos: async (params: {
    organization_id?: string
    date_from?: string
    date_to?: string
    window_minutes?: number
    limit?: number
    apply?: boolean
    target_bucket?: string
    parkpow_base_url?: string
    require_empty_photo?: boolean
    include_stale_signed_urls?: boolean
    max_session_pages?: number
  }) => {
    return callEdgeFunction('photo-recovery', params)
  },

  /**
   * Find and remove duplicate observations
   */
  detectDuplicates: async (params: {
    zoneIds?: string[]
    dateRangeStart?: string
    dateRangeEnd?: string
    offset?: number
    batch_size?: number
    get_total?: boolean
  }) => {
    return callEdgeFunction('duplicate-detection', params)
  },

  // ============================================================================
  // VEHICLE & OBSERVATION MANAGEMENT (8 functions)
  // ============================================================================

  /**
   * Production vehicle observation pipeline
   */
  ingestVehicleObservation: async (params: {
    image?: string
    photo_base64?: string
    photoDataUrl?: string
    gpsLatitude?: number
    gps_latitude?: number
    gps?: { lat: number; lng: number; accuracy?: number }
    gpsLongitude?: number
    gps_longitude?: number
    gpsAccuracy?: number
    gps_accuracy?: number
    recordedAt?: string
    recorded_at?: string
    officerId?: string
    officer_id?: string
    recorded_by?: string
    organizationId?: string
    organization_id?: string
    zoneId?: string
    zone_id?: string
    idempotencyKey?: string
    idempotency_key?: string
    notes?: string
    officer_notes?: string
    weather?: string
    weather_conditions?: string
    plate?: string | null
    confidence?: number | null
    requires_manual_entry?: boolean
    raw_candidates?: string[]
  }) => {
    return callEdgeFunction('vehicle-ingest', params)
  },

  /**
   * Unified ORC/AI pipeline with fallbacks
   */
  orcIngest: async (params: {
    photo_url: string
    latitude: number
    longitude: number
    officer_id: string
    organization_id: string
    zone_id: string
  }) => {
    return callEdgeFunction('orc-ingest', params)
  },

  /**
   * List observations with filters
   */
  listObservations: async (params: {
    organization_id?: string
    zone_id?: string
    date_from?: string
    date_to?: string
    plate_number?: string
    page?: number
    limit?: number
  }) => {
    return callEdgeFunction('observations-list', params)
  },

  /**
   * Get observations within GPS bounds (for map)
   */
  observationsInBounds: async (params: {
    north: number
    south: number
    east: number
    west: number
    organization_id?: string
  }) => {
    return callEdgeFunction('observations-in-bounds', params)
  },

  /**
   * Export observations to CSV
   */
  exportObservations: async (params: {
    organization_id?: string
    zone_id?: string
    date_from?: string
    date_to?: string
  }) => {
    return callEdgeFunction('observations-export', params)
  },

  /**
   * AI vehicle analysis (make/model/year/colour)
   */
  analyzeVehiclePhoto: async (params: {
    photo_url: string
  }) => {
    return callEdgeFunction('analyze-vehicle-photo', params)
  },

  /**
   * AI profile photo selection
   */
  selectBestVehiclePhoto: async (params: {
    plate_number: string
  }) => {
    return callEdgeFunction('select-best-vehicle-photo', params)
  },

  // ============================================================================
  // DATA MANAGEMENT (6 functions)
  // ============================================================================

  /**
   * Check data integrity (duplicates, orphans, invalid plates)
   */
  checkDataIntegrity: async () => {
    return callEdgeFunction('check-data-integrity')
  },

  /**
   * Validate GPS vs zone geofence
   */
  checkZoneCorrections: async (params: {
    organization_id?: string
  }) => {
    return callEdgeFunction('check-zone-corrections', params)
  },

  /**
   * Batch zone correction (GPS-based)
   */
  correctZoneAssignments: async (params: {
    organization_id?: string
    dry_run?: boolean
  }) => {
    return callEdgeFunction('correct-zone-assignments', params)
  },

  /**
   * Zone correction with "Other Location" fallback
   */
  zoneCorrection: async (params: {
    observation_id: string
  }) => {
    return callEdgeFunction('zone-correction', params)
  },

  /**
   * AI-powered file import
   */
  importData: async (params: {
    file_url: string
    file_type: string
  }) => {
    return callEdgeFunction('import-data', params)
  },

  /**
   * Excel import with zone fuzzy matching
   */
  importHistoricalData: async (params: {
    file_url: string
  }) => {
    return callEdgeFunction('import-historical-data', params)
  },

  // ============================================================================
  // REPORTING & PDF (6 functions)
  // ============================================================================

  /**
   * Generate court-ready incident PDF
   */
  generateIncidentPDF: async (params: {
    incident_id: string
  }) => {
    return callEdgeFunction('generate-incident-pdf', params)
  },

  /**
   * Generate vehicle evidence report
   */
  generateVehicleReport: async (params: {
    plate_number: string
  }) => {
    return callEdgeFunction('generate-vehicle-report', params)
  },

  /**
   * Generate dashboard statistics report.
   * Errors are surfaced to the caller (showToast: false) so the Reports page
   * mutation can handle the error toast once rather than showing it twice.
   */
  generateDashboardReport: async (params: {
    report_type?: string
    organization_id?: string
    zone_id?: string
    date_from?: string
    date_to?: string
    start_date?: string
    end_date?: string
  }) => {
    return callEdgeFunction('generate-dashboard-report', params, { showToast: false })
  },

  /**
   * Generate leadership pack (executive summary).
   * Errors are surfaced to the caller so the Reports page mutation handles the
   * error toast once rather than showing it twice.
   */
  generateLeadershipPack: async (params: {
    organization_id?: string
    date_from?: string
    date_to?: string
  }) => {
    return callEdgeFunction('generate-leadership-pack', params, { showToast: false })
  },

  /**
   * Send a dashboard report to an email address via SMTP.
   * Defaults to the authenticated user's own email if recipient_email is omitted.
   * Errors are surfaced to the caller (showToast: false) so the UI can handle the toast once.
   */
  sendReportEmail: async (params: {
    report_type?: string
    recipient_email?: string
    organization_id?: string
    zone_id?: string
    date_from?: string
    date_to?: string
  }) => {
    return callEdgeFunction('send-report-email', params, { showToast: false })
  },

  /**
   * Generate legal Notice to Vacate
   */
  generateNoticeToVacate: async (params: {
    breach_alert_id: string
  }) => {
    return callEdgeFunction('generate-notice-to-vacate', params)
  },

  /**
   * Get real-time compliance statistics
   */
  getComplianceStatistics: async (params: {
    organization_id?: string
    zone_id?: string
  }) => {
    return callEdgeFunction('get-compliance-statistics', params)
  },

  // ============================================================================
  // LOCATION & INTEGRATIONS (7 functions)
  // ============================================================================

  /**
   * Get GPS heatmap clustering data
   */
  getHotspotData: async (params: {
    organization_id?: string
    zone_id?: string
    date_from?: string
    date_to?: string
  }) => {
    return callEdgeFunction('hotspot-data', params)
  },

  /**
   * Check NZSCV self-contained status
   */
  checkNZSCVStatus: async (params: {
    plate_number: string
  }) => {
    return callEdgeFunction('check-nzscv-status', params)
  },

  /**
   * Enrich vehicle from MotorWeb
   */
  enrichFromMotorWeb: async (params: {
    plate_number: string
  }) => {
    return callEdgeFunction('enrich-from-motorweb', params)
  },

  /**
   * Get weather at GPS coordinates
   */
  getWeather: async (params: {
    latitude: number
    longitude: number
  }) => {
    return callEdgeFunction('get-weather', params)
  },

  /**
   * Suggest new zone via Nominatim
   */
  suggestNewZone: async (params: {
    latitude: number
    longitude: number
  }) => {
    return callEdgeFunction('suggest-new-zone', params)
  },

  /**
   * Stream webhook (Plate Recognizer Stream)
   */
  streamWebhook: async (params: any) => {
    return callEdgeFunction('stream-webhook', params, { showToast: false })
  },

  // ============================================================================
  // NOTIFICATIONS (2 functions)
  // ============================================================================

  /**
   * Send push notification
   */
  sendPushNotification: async (params: {
    user_id: string
    title: string
    body: string
    data?: any
  }) => {
    return callEdgeFunction('send-push-notification', params)
  },

  /**
   * Monitor officer welfare
   */
  monitorOfficerWelfare: async (params: {
    officer_id: string
  }) => {
    return callEdgeFunction('monitor-officer-welfare', params)
  },

  // ============================================================================
  // ADMIN & USERS (3 functions)
  // ============================================================================

  /**
   * Admin incident operations (legal hold, bulk updates)
   */
  adminIncidentOps: async (params: {
    operation: string
    incident_ids?: string[]
    legal_hold?: boolean
  }) => {
    return callEdgeFunction('admin-incident-ops', params)
  },

  /**
   * Create user with profile & role
   */
  createUser: async (params: {
    email: string
    password: string
    first_name: string
    last_name: string
    role: string
    organization_id: string
  }) => {
    return callEdgeFunction('create-user', params)
  },

  /**
   * Update compliance policy
   */
  updateCompliancePolicy: async (params: {
    zone_id: string
    policy: any
  }) => {
    return callEdgeFunction('update-compliance-policy', params)
  },

  // ============================================================================
  // DOCUMENT PROCESSING (3 functions)
  // ============================================================================

  /**
   * Process credential document (COA/Warrant)
   */
  processCredentialDocument: async (params: {
    file_url: string
    document_type: 'coa' | 'warrant'
  }) => {
    return callEdgeFunction('process-credential-document', params)
  },

  /**
   * Process homeless data
   */
  processHomelessData: async (params: {
    file_url: string
  }) => {
    return callEdgeFunction('process-homeless-data', params)
  },

  /**
   * Process investigation document
   */
  processInvestigationDocument: async (params: {
    file_url: string
  }) => {
    return callEdgeFunction('process-investigation-document', params)
  },

  // ============================================================================
  // UTILITIES (2 functions)
  // ============================================================================

  /**
   * Upload file to Supabase Storage
   */
  uploadFile: async (params: {
    bucket: string
    path: string
    file: File
  }) => {
    return callEdgeFunction('upload-file', params)
  },

  /**
   * AI chat for bug analysis
   */
  onspaceAIChat: async (params: {
    message: string
    context?: any
  }) => {
    return callEdgeFunction('onspace-ai-chat', params)
  },
}
