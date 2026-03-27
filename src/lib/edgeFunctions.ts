/**
 * Edge Functions Library - Type-safe wrappers for all 47 Supabase Edge Functions
 * 
 * This library provides a centralized interface for calling all Edge Functions
 * with proper error handling, type safety, and toast notifications.
 */

import { supabase } from './supabase'
import { toast } from 'sonner'
import { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from '@supabase/supabase-js'
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

  // Treat all 401 responses as potentially recoverable by token refresh.
  // Some Supabase gateway 401 responses vary in body shape/message even when
  // the underlying issue is an expired or transiently rejected token.
  return true
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
 * Try to extract a human-readable message from the raw response text.
 * Edge functions return `{ "error": "..." }` or `{ "message": "..." }`.
 * Falls back to the raw text when it isn't JSON.
 */
function extractUsableMessage(raw: string): string {
  if (!raw || !raw.trim()) return ''

  // If the text looks like HTML (gateway / proxy error page), discard it.
  if (/^\s*<[!a-z]/i.test(raw.trim())) {
    return 'The server returned an HTML error page instead of JSON. This is usually a transient gateway or proxy error — please retry.'
  }

  try {
    const parsed = JSON.parse(raw)
    const candidate: string = parsed?.error ?? parsed?.message ?? ''
    // Guard against whitespace-only messages that occasionally leak from upstream HTML error pages.
    if (candidate && candidate.trim()) return candidate.trim()
    // JSON parsed successfully but the error/message field was empty or whitespace-only.
    // This typically happens when a gateway returns an empty HTML error page whose content
    // was forwarded as the error string. Return a helpful fallback.
    if (parsed && (typeof parsed.error === 'string' || typeof parsed.message === 'string')) {
      return 'The server returned an empty error message. This is usually a transient gateway or proxy error — please retry.'
    }
  } catch {
    // Not JSON — use the raw text as-is, but cap its length for readability.
  }

  const trimmed = raw.trim()
  if (!trimmed) return ''
  return trimmed.length > 300 ? trimmed.slice(0, 300) + '…' : trimmed
}

/**
 * Helper to extract error message from FunctionsHttpError, FunctionsRelayError, or FunctionsFetchError
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

      const usable = extractUsableMessage(textContent)
      return `[Code: ${statusCode}] ${usable || error.message || 'Unknown error'}`
    } catch {
      return error.message || 'Failed to read response'
    }
  }

  // Network-level failures: the browser could not send the request at all.
  // This is commonly caused by the edge function not being deployed, a CORS
  // pre-flight rejection (gateway JWT verify block), or a transient network
  // outage.  Return a clear, actionable message instead of the raw SDK string.
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return 'Unable to reach the Edge Function. The function may not be deployed, or there may be a network connectivity issue. Please try again or contact your administrator.'
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
   * Background enrichment for officer vehicle scans.
   *
   * Called fire-and-forget after the initial fast observation save.
   * Runs: inference → ALPR backup → NZSCV → movement check → compliance.
   * Updates the observation in-place; caller polls for the result.
   */
  processOfficerScan: async (params: {
    observation_id: string
    photo_url: string
    photo_hash?: string | null
  }) => {
    return callEdgeFunction('process-officer-scan', params, { showToast: false })
  },

  /**
   * Process ALPR - Plate Recognizer pipeline
   *
   * UPDATE mode: pass `observation_id` to update an existing observation.
   * CREATE mode: pass identity fields (`officerId`, `organizationId`, `zoneId`,
   *              `idempotencyKey`) to create a new observation.
   */
  processALPR: async (params: {
    photo_url: string
    // GPS coordinates — preferred camelCase names
    gpsLatitude?: number
    gpsLongitude?: number
    gpsAccuracy?: number
    // GPS backward-compat aliases (latitude/longitude/accuracy)
    latitude?: number
    longitude?: number
    accuracy?: number
    // Identity fields for CREATE mode (camelCase, matching alpr-process interface)
    officerId?: string
    organizationId?: string
    zoneId?: string
    idempotencyKey?: string
    // Identity backward-compat aliases (snake_case)
    officer_id?: string
    organization_id?: string
    zone_id?: string
    idempotency_key?: string
    /** UUID of an existing observation being updated (background processing mode) */
    observation_id?: string
    /** Optional incident/case to link this observation to */
    incident_id?: string
    regions?: string[]
    mmc?: boolean
    officerNotes?: string
    recordedAt?: string
  }) => {
    // Destructure backward-compat aliases and map to the field names that
    // alpr-process expects so that both old and new callers work correctly.
    const {
      latitude, longitude, accuracy,
      officer_id, organization_id, zone_id,
      idempotency_key,
      ...rest
    } = params
    return callEdgeFunction('alpr-process', {
      ...rest,
      gpsLatitude: rest.gpsLatitude ?? latitude,
      gpsLongitude: rest.gpsLongitude ?? longitude,
      gpsAccuracy: rest.gpsAccuracy ?? accuracy,
      officerId: rest.officerId ?? officer_id,
      organizationId: rest.organizationId ?? organization_id,
      zoneId: rest.zoneId ?? zone_id,
      idempotencyKey: rest.idempotencyKey ?? idempotency_key,
    })
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
  * This function is independent from legacy observation-table logic.
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
      strict_matrix: false,
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
        breachesDismissed: Number(data.breaches_dismissed ?? 0),
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
   * Supports batched pagination: pass get_total=true first, then iterate with offset/batch_size.
   */
  cleanupAndRecalculate: async (params: {
    phase?: 'all' | 'zone' | 'dedup' | 'compliance'
    zoneIds?: string[]
    zone_ids?: string[]
    dateRangeStart?: string
    date_range_start?: string
    dateRangeEnd?: string
    date_range_end?: string
    offset?: number
    batch_size?: number
    get_total?: boolean
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
   * Run a ParkPow sync action (sync-lots | sync-watchlist | push-violations).
   * Used by ParkingEnforcementPortal admin tab.
   */
  runParkPowSync: async (params: { action: 'sync-lots' | 'sync-watchlist' | 'push-violations' }) => {
    return callEdgeFunction('parkpow-sync', params)
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
    time_window_minutes?: number
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
    photo_url?: string
    photo_hash?: string
    /** Pass to UPDATE an existing observation row instead of creating a new one */
    existing_observation_id?: string
    observation_id?: string
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
    plate?: string | null
    plate_number?: string | null
    confidence?: number | null
    requires_manual_entry?: boolean
    raw_candidates?: string[]
  }) => {
    return callEdgeFunction('vehicle-ingest', params)
  },

  /**
   * @deprecated Use ingestVehicleObservation instead.
   *
   * Legacy wrapper retained for compatibility. Historically this wrapper sent a
   * JSON payload to `orc-ingest`, while that function expects multipart form
   * data (`photo` + `metadata`). To avoid a hard runtime failure for any
   * lingering callers, we now map to the canonical `vehicle-ingest` pipeline.
   */
  orcIngest: async (params: {
    photo_url: string
    latitude: number
    longitude: number
    officer_id: string
    organization_id: string
    zone_id: string
    plate_number?: string
    notes?: string
  }) => {
    return callEdgeFunction('vehicle-ingest', {
      photo_url: params.photo_url,
      gpsLatitude: params.latitude,
      gpsLongitude: params.longitude,
      officerId: params.officer_id,
      organizationId: params.organization_id,
      zoneId: params.zone_id,
      plate: params.plate_number,
      officer_notes: params.notes,
    })
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
   * AI vehicle analysis (make/model/year/colour + NZSCV validation).
   *
   * Accepts both camelCase and snake_case for compatibility and maps to the
   * edge function contract: { plateNumber, photoUrl, vehicleId }.
   */
  analyzeVehiclePhoto: async (params: {
    plateNumber?: string
    plate_number?: string
    photoUrl?: string
    photo_url?: string
    vehicleId?: string
    vehicle_id?: string
  }) => {
    return callEdgeFunction('analyze-vehicle-photo', {
      plateNumber: params.plateNumber ?? params.plate_number,
      photoUrl: params.photoUrl ?? params.photo_url,
      vehicleId: params.vehicleId ?? params.vehicle_id,
    })
  },

  /**
   * AI profile photo selection
   */
  selectBestVehiclePhoto: async (params: {
    plate_number: string
  }) => {
    return callEdgeFunction('select-best-vehicle-photo', params)
  },

  /**
   * Reingest photos — batch reprocess existing observation photos through
   * the vehicle-ingest pipeline, creating new observation records.
   * Toast suppressed here; caller (PhotoReingest.tsx onError) handles it.
   */
  reingestPhotos: async (params: {
    get_total?: boolean
    batch_size?: number
    before_recorded_at?: string
    organization_id?: string
    date_from?: string
    date_to?: string
  }) => {
    return callEdgeFunction('reingest-photos', params, { showToast: false })
  },

  /**
   * Link evidence bucket photos to canonical vehicle records via ALPR.
   * Runs plate recognition on each image in the evidence bucket and sets
   * profile_photo / profile_photo_url on the matching canonical_vehicles row.
   * Toast suppressed here; caller handles it.
   */
  linkEvidencePhotos: async (params: {
    path_prefix?: string
    paths?: string[]
    min_confidence?: number
    force_update?: boolean
    dry_run?: boolean
    limit?: number
  }) => {
    return callEdgeFunction('link-evidence-photos', params, { showToast: false })
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
    file_url?: string
    fileUrl?: string
    file_path?: string
    filePath?: string
    bucket?: string
    storage_bucket?: string
    batch_name?: string
    batchName?: string
    organization_id?: string
    organizationId?: string
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
   * Generate a formal Warning Notice (first step in enforcement escalation ladder).
   * Returns { action_id, warning_number, html }.
   */
  generateWarningNotice: async (params: {
    plate_number: string
    zone_id: string
    breach_type: string
    breach_reason: string
    issued_by: string
    observation_id?: string
    breach_alert_id?: string
    recipient_name?: string
    recipient_email?: string
    additional_notes?: string
    delivery_method?: 'email' | 'physical'
  }) => {
    return callEdgeFunction('generate-warning-notice', params)
  },

  /**
   * Generate printable HTML for a Noise Control Notice (AN / DN / END)
   * Returns { html, notice_number }
   */
  generateNoiseNotice: async (params: {
    noise_notice_id: string
    issued_by: string
  }) => {
    return callEdgeFunction('generate-noise-notice', params)
  },

  /**
   * Generate printable HTML "Receipt for Goods Seized" (RMA s.328)
   * Returns { html, seizure_number }
   */
  generateSeizureReceipt: async (params: {
    noise_seizure_id: string
    issued_by: string
  }) => {
    return callEdgeFunction('generate-seizure-receipt', params)
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
   * Create user with profile & role (admin/master only — sets password directly)
   */
  createUser: async (params: {
    email: string
    password: string
    first_name: string
    last_name: string
    role: string
    organization_id: string
    employer_organization_id?: string
    phone?: string
  }) => {
    return callEdgeFunction('create-user', params)
  },

  /**
   * Set or reset a user's password (admin/master only)
   */
  setUserPassword: async (params: {
    user_id: string
    new_password: string
  }) => {
    return callEdgeFunction('set-user-password', params)
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
   * AI chat for analysis and suggestions.
   *
   * Sends a conversation history as a messages array so the edge function
   * can maintain context across turns. Each message is { role, content }.
   * Pass model/temperature to override the server defaults.
   */
  aiChat: async (params: {
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
    model?: string
    temperature?: number
  }) => {
    // AiAnalysis.tsx renders errors in the chat and shows its own toast, so
    // suppress the automatic toast here to avoid duplicate error notifications.
    return callEdgeFunction('onspace-ai-chat', params, { showToast: false })
  },

  /**
   * Sync canonical_vehicles self-contained status against the NZSCV SCV Excel list.
   *
   * Reads the published SCV list from Supabase Storage, compares every plate in
   * canonical_vehicles, and:
   *   - Sets self_contained = true + calculates expiry for plates in the list
   *   - Sets self_contained = false for plates confirmed absent from the list
   *   - Updates observations.self_contained for newly-confirmed plates
   *   - Resolves pending 'self_contained' breach_alerts for confirmed plates
   *
   * Pass dry_run: true to preview changes without writing to the database.
   */
  syncScvList: async (params: {
    dry_run?: boolean
    file_date?: string
    offset?: number
    batch_size?: number
    include_related_updates?: boolean
    scv_total_in_list?: number
    scv_current_entries?: Array<{
      plate_number: string
      expiry: string | null
    }>
  } = {}) => {
    return callEdgeFunction('sync-scv-list', params, { showToast: false })
  },

  /**
   * Generate an infringement notice (FCA s.20) and save to infringement_notices table.
   */
  generateInfringement: async (params: {
    plate_number: string
    zone_id?: string
    offence_description: string
    legal_basis?: string
    offence_location?: string
    offence_date?: string
    amount_cents?: number
    service_method?: 'hand' | 'post' | 'email'
    recipient_name?: string
    recipient_email?: string
    recipient_address?: string
    vehicle_make?: string
    vehicle_model?: string
    breach_alert_id?: string
    observation_id?: string
  }) => {
    return callEdgeFunction('generate-infringement', params)
  },

  /**
   * Render an existing infringement notice to HTML for printing/preview.
   */
  renderInfringementNotice: async (params: { notice_id: string }) => {
    return callEdgeFunction('render-infringement-notice', params)
  },

  /**
   * Submit a public dispute intake form for review.
   */
  submitDisputeIntake: async (params: {
    notice_number: string
    grounds: string
    full_name: string
    email?: string
    phone?: string
    address?: string
    statement?: string
  }) => {
    return callEdgeFunction('submit-dispute-intake', params, { showToast: false })
  },

  /**
   * Look up a public infringement case by notice number (unauthenticated).
   */
  publicCaseLookup: async (params: { notice_number: string }) => {
    return callEdgeFunction('public-case-lookup', params, { showToast: false })
  },

  /**
   * Send an email invite via the proxy relay.
   */
  sendInviteEmail: async (params: {
    email: string
    first_name?: string
    invite_url: string
  }) => {
    return callEdgeFunction('send-invite-email', params)
  },

  /**
   * Face detection and recognition.
   *
   * Detect mode (default): Accepts a photo URL, detects faces, generates
   * embeddings, and optionally saves to face_records table.
   *
   * Compare mode: Accepts two face embeddings and returns cosine similarity.
   */
  processFaceScan: async (params: {
    /** 'detect' (default), 'detect_and_match', 'compare', 'match', or 'link_poi' */
    action?: 'detect' | 'detect_and_match' | 'compare' | 'match' | 'link_poi'
    /** Photo URL for face detection (detect / detect_and_match mode) */
    photo_url?: string
    /** Embeddings for comparison (compare mode) */
    embedding1?: number[]
    embedding2?: number[]
    /** Face embedding to search POI (match mode) */
    embedding?: number[]
    /** Whether to save detected faces to face_records table (default true) */
    save?: boolean
    /** Optional linked observation ID */
    observation_id?: string
    /** GPS coordinates */
    latitude?: number
    longitude?: number
    zone_id?: string
    notes?: string
    label?: string
    /** Max POI match results (match mode, default 5) */
    max_results?: number
    /** Link POI: face_record_id to link */
    face_record_id?: string
    /** Link POI: person_record_id to link to */
    person_record_id?: string
  }) => {
    return callEdgeFunction('process-face-scan', params, { showToast: false })
  },
}
