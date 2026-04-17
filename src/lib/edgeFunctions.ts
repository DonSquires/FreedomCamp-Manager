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
const EDGE_FUNCTION_TIMEOUT_MS = 35_000

/** Retrieve the current session's access token, or null if not signed in. */
async function getValidAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return null

  // Proactively refresh when the token is close to expiry.
  const expiresAt = (session.expires_at ?? 0) * 1000
  if (Date.now() + ACCESS_TOKEN_REFRESH_BUFFER_MS >= expiresAt) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    return refreshed.session?.access_token ?? null
  }

  return session.access_token
}

/** Force-refresh the Supabase session and return the new access token, or null on failure. */
async function tryRefreshAccessToken(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.refreshSession()
    if (error || !data.session) return null
    return data.session.access_token
  } catch {
    return null
  }
}

/** Return true when the error is a 401 JWT-related failure from the Supabase gateway. */
async function isJwtAuthError(error: any): Promise<boolean> {
  if (!(error instanceof FunctionsHttpError)) return false
  const status = (error.context as Response | undefined)?.status ?? 0
  return status === 401
}

/**
 * Strip HTML tags and boilerplate from an error body and return a concise
 * human-readable string.  Returns an empty string if nothing useful is found.
 */
function extractUsableMessage(text: string): string {
  if (!text) return ''
  // Strip HTML tags produced by gateway error pages.
  const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
  // Ignore generic gateway pages that contain no actionable information.
  if (
    stripped.toLowerCase().includes('<!doctype') ||
    stripped.toLowerCase().startsWith('bad gateway') ||
    stripped.toLowerCase().startsWith('service unavailable')
  ) {
    return ''
  }
  return stripped.length > 300 ? stripped.slice(0, 300) + '…' : stripped
}

async function readFunctionsErrorText(error: FunctionsHttpError): Promise<string> {
  try {
    const response = error.context as Response | undefined
    if (!response) return ''

    // Clone to avoid consuming the original body stream for other handlers.
    const readable = typeof response.clone === 'function' ? response.clone() : response
    const raw = await (readable as Response).text()

    // Attempt JSON parse — the gateway often returns {"error":"…"} or {"message":"…"}.
    try {
      const parsed = JSON.parse(raw)
      const parsedMessage =
        (typeof parsed?.error === 'string' && parsed.error.trim()) ||
        (typeof parsed?.message === 'string' && parsed.message.trim()) ||
        ''
      const parsedDetails = typeof parsed?.details === 'string' ? parsed.details.trim() : ''
      if (parsedMessage) {
        const combined = parsedDetails && !parsedMessage.includes(parsedDetails)
          ? `${parsedMessage}: ${parsedDetails}`
          : parsedMessage
        return combined.length > 300 ? combined.slice(0, 300) + '…' : combined
      }
    } catch {
      // Not JSON — use the raw text as-is, but cap its length for readability.
    }

    const trimmed = raw.trim()
    if (!trimmed) return ''
    return trimmed.length > 300 ? trimmed.slice(0, 300) + '…' : trimmed
  } catch {
    return ''
  }
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
  options: { showToast?: boolean; useDirectFetch?: boolean } = { showToast: true }
): Promise<{ data: T | null; error: string | null }> {
  const { lock, unlock } = useSessionLockStore.getState()
  const invokeTimeoutMs = EDGE_FUNCTION_TIMEOUT_MS

  const invokeWithTimeout = async (
    fn: string,
    payload: any
  ): Promise<{ data: any; error: any }> => {
    return await Promise.race([
      supabase.functions.invoke(fn, { body: payload || {} }),
      new Promise<{ data: null; error: Error }>((resolve) => {
        setTimeout(() => {
          resolve({
            data: null,
            error: new Error(`Edge function request timed out after ${invokeTimeoutMs / 1000}s`),
          })
        }, invokeTimeoutMs)
      }),
    ])
  }

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

    const directEdgeInvoke = async (jwt: string): Promise<{ data: T | null; error: any | null }> => {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

      if (!supabaseUrl || !anonKey) {
        return { data: null, error: new Error('Supabase URL or anon key is missing') }
      }

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), invokeTimeoutMs)

        const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${jwt}`,
            apikey: anonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body || {}),
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        const text = await response.text()
        const parsed = (() => {
          try {
            return JSON.parse(text)
          } catch {
            return null
          }
        })()

        if (!response.ok) {
          const message = parsed?.error || parsed?.message || text || `Edge function returned ${response.status}`
          return { data: null, error: new Error(String(message)) }
        }

        return { data: (parsed as T) ?? ({} as T), error: null }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          return {
            data: null,
            error: new Error(`Edge function request timed out after ${invokeTimeoutMs / 1000}s`),
          }
        }
        return { data: null, error: e }
      }
    }

    // When useDirectFetch is set, bypass supabase.functions.invoke entirely.
    // This avoids sending global client headers (e.g. x-client-timezone) that
    // may be blocked by CORS preflight on functions that don't allow them.
    if (options.useDirectFetch) {
      const directResult = await directEdgeInvoke(accessToken)
      if (!directResult.error) {
        unlock()
        return { data: directResult.data as T, error: null }
      }
      const errorMessage = directResult.error?.message || 'Edge function call failed'
      if (options.showToast) toast.error(errorMessage)
      return { data: null, error: errorMessage }
    }

    const { data, error: initialError } = await invokeWithTimeout(functionName, body)

    let error = initialError

    // Some browsers/networks intermittently fail edge invokes at the fetch/relay
    // layer. Retry once immediately on network-level failures.
    if (
      error &&
      (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError)
    ) {
      const fallbackResult = await invokeWithTimeout(functionName, body)

      if (!fallbackResult.error) {
        unlock()
        return { data: fallbackResult.data as T, error: null }
      }

      error = fallbackResult.error

      // Final fallback: bypass SDK invoke relay and call edge function directly.
      // This helps when browser/network policies intermittently break relay fetches.
      const directResult = await directEdgeInvoke(accessToken)
      if (!directResult.error) {
        unlock()
        return { data: directResult.data as T, error: null }
      }
    }

    if (error) {
      // Retry once after forced refresh for transient JWT invalid/expired responses.
      if (await isJwtAuthError(error)) {
        const refreshedAccessToken = await tryRefreshAccessToken()
        if (refreshedAccessToken) {
          const retryResult = await invokeWithTimeout(functionName, body)

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
    * @deprecated No current app callers remain; keep only for compatibility until legacy consumers are retired.
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
    * @deprecated No current app callers remain; keep only for compatibility until legacy consumers are retired.
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
    search?: string
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
    plate_number?: string
    plateNumber?: string
    photoUrls?: string[]
    photo_urls?: string[]
    forceUpdate?: boolean
    force_update?: boolean
  }) => {
    return callEdgeFunction('select-best-vehicle-photo', {
      plateNumber: params.plateNumber ?? params.plate_number,
      photoUrls: params.photoUrls ?? params.photo_urls,
      forceUpdate: params.forceUpdate ?? params.force_update,
    })
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
  checkDataIntegrity: async (params?: {
    comprehensive?: boolean
  }) => {
    return callEdgeFunction('check-data-integrity', params)
  },

  /**
   * Run the nightly privacy cleanup task on demand.
   */
  nightlyPrivacyCleanup: async (params?: {
    dryRun?: boolean
    dry_run?: boolean
  }) => {
    return callEdgeFunction('nightly-privacy-cleanup', params)
  },

  /**
   * Sync spatial layers and derived jurisdiction metadata.
   */
  syncSpatialLayers: async () => {
    return callEdgeFunction('sync-spatial-layers')
  },

  /**
   * Check health of Railway-backed proxy and inference services.
   */
  checkRailwayHealth: async () => {
    return callEdgeFunction('check-railway-health')
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
    file_url?: string
    fileUrl?: string
    fileContent?: string
    fileName?: string
    file_name?: string
    file_type?: string
    isImage?: boolean
    is_image?: boolean
    recordDate?: string
    record_date?: string
    importType?: string
    import_type?: string
    organizationId?: string
    organization_id?: string
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
    fileName?: string
    file_name?: string
    fileContent?: string
    file_content?: string
  }) => {
    return callEdgeFunction('import-historical-data', params)
  },

  /**
   * Scrape candidate vehicle photos from external listing sources.
   */
  scrapeVehiclePhotos: async (params: {
    plate_number?: string
    plateNumber?: string
    force_update?: boolean
    forceUpdate?: boolean
  }) => {
    return callEdgeFunction('scrape-vehicle-photos', params)
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
    zoneId?: string
    zone_id?: string
    plateNumber?: string
    plate_number?: string
    nightsStayed?: number
    nights_stayed?: number
    breachDetails?: any
    breachDate?: string
    issuedBy?: string
    issued_by?: string
    deliveryMethod?: string
    delivery_method?: string
    deliverToEmail?: string
    deliver_to_email?: string
    breachAlertId?: string
    breach_alert_id?: string
    vehicleId?: string
    vehicle_id?: string
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
    type?: string
    priority?: 'low' | 'normal' | 'high' | 'urgent'
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
    organization_id?: string | null
    extra_organization_ids?: string[]
    employer_organization_id?: string
    phone?: string
    job_title?: string | null
    requires_driver_license?: boolean
    authorized_work_locations?: string[]
    permissions?: Record<string, unknown>
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

  /**
   * Analyse a tender/RFP/RFIP document with Bob, extract structured data,
   * auto-create a CRM client organisation if needed, and persist the assessment.
   * Pass reference_ids (from the References tab checkbox panel) to include
   * org-wide reference materials as context for Bob's analysis.
   */
  processTenderDocument: async (params: {
    document_id: string
    extracted_text?: string
    force_enrich?: boolean
    reference_ids?: string[]
  }) => {
    return callEdgeFunction('process-tender-document', params, { showToast: false })
  },

  /**
   * Generate tender application or response sections using Bob + Ollama.
   * Fully self-hosted — no cloud AI. Cascade:
   *   1. Ollama primary model (OLLAMA_MODEL)
   *   2. Ollama writing specialist (OLLAMA_MODEL_WRITING if different)
   *   3. Secondary Railway-hosted assistant (SECONDARY_ASSISTANT_URL if configured)
   *   4. Enriched heuristic template (always available)
   *
   * Returns: { sections, provider, model_used, references_used }
   *
   * When trigger_training=true (on approval/rejection), sends outcome to Bob for
   * self-learning instead of generating new sections.
   * For rejections: pass rejection_reason (required) and rejection_category.
   */
  generateTenderSections: async (params: {
    document_id: string
    generation_type: 'application' | 'response'
    organization_context?: {
      name?: string
      psa_licence?: string
      nzbn?: string
    }
    reference_ids?: string[]
    trigger_training?: boolean
    outcome?: 'approved' | 'rejected' | 'shortlisted'
    outcome_notes?: string
    rejection_reason?: string
    rejection_category?: 'pricing' | 'scope' | 'qualifications' | 'compliance' | 'formatting' | 'other'
  }) => {
    return callEdgeFunction('generate-tender-sections', params, { showToast: false })
  },

  /**
   * Trigger server-side text extraction for a tender reference material file.
   * Call after uploading the file to Supabase Storage and inserting the
   * tender_reference_materials row. Updates extraction_status on completion.
   */
  processReferenceMaterial: async (params: {
    reference_material_id: string
  }) => {
    return callEdgeFunction('process-reference-material', params, { showToast: false })
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
    provider?: 'auto' | 'ollama' | 'inference'
  }) => {
    // AiAnalysis.tsx renders errors in the chat and shows its own toast, so
    // suppress the automatic toast here to avoid duplicate error notifications.
    return callEdgeFunction('onspace-ai-chat', params, { showToast: false, useDirectFetch: true })
  },

  /**
   * Bob self-healing code change task.
   *
   * Generates an executable patch task payload from the inference-service
   * /self-heal/patch-task endpoint.
   *
   * Routing rule:
   * - simple/moderate => self-heal worker mode
   * - complex => github assist mode
   */
  bobCodeChangeTask: async (params: {
    summary: string
    details?: string
    stack_trace?: string
    severity?: 'low' | 'medium' | 'high' | 'critical'
    complexity?: 'simple' | 'moderate' | 'complex'
    target_paths?: string[]
  }) => {
    return callEdgeFunction('bob-code-change-task', params, { showToast: false })
  },

  /**
   * Grandmaster Coding Studio — proxy to Bob's code-task and knowledge endpoints.
   *
   * All actions require an authenticated grand_master session. The edge function
   * validates role server-side before proxying to the inference service.
   *
   * Actions:
   *  code_task_submit  — queue a new Bob code task (POST /code/task)
   *  code_tasks_list   — list tasks with optional ?status filter
   *  code_task_get     — fetch a single task by id
   *  code_task_skip    — skip a pending task
   *  code_task_delete  — delete a task
   *  code_patterns     — retrieve all codebase pattern templates
   *  code_conventions  — retrieve naming conventions + TS config
   *  code_tech_stack   — retrieve full tech stack reference
   *  code_assist       — natural language coding question → structured answer
   *  ask_copilot_submit — queue a knowledge question for Copilot to research
   *  ask_copilot_list  — list all knowledge requests
   *  health_check      — Bob health + config booleans (no secret values)
   */
  grandmasterStudio: async (params: {
    action:
      | 'code_task_submit'
      | 'code_tasks_list'
      | 'code_task_get'
      | 'code_task_skip'
      | 'code_task_delete'
      | 'code_patterns'
      | 'code_conventions'
      | 'code_tech_stack'
      | 'code_assist'
      | 'ask_copilot_submit'
      | 'ask_copilot_list'
      | 'health_check'
      | 'doctor_health'
      | 'doctor_timeline'
      | 'doctor_playbook_run'
      | 'intel_bulletin_submit'
      | 'intel_state'
    // code_task_submit
    task?: string
    context?: string
    target_files?: string[]
    priority?: 'high' | 'normal'
    // code_task_get / skip / delete
    task_id?: string
    // code_tasks_list / ask_copilot_list
    status?: string
    // code_assist / ask_copilot_submit
    question?: string
    // ask_copilot_submit
    category?: string
    // doctor_playbook_run
    playbook?: 'ollama_recovery' | 'ptt_token_path_repair' | 'edge_auth_alignment'
    dry_run?: boolean
    // doctor_timeline
    limit?: number
    // intel_bulletin_submit
    title?: string
    summary?: string
    type?: string
    source?: string
    metadata?: Record<string, unknown>
  }) => {
    return callEdgeFunction('grandmaster-studio', params, { showToast: false })
  },

  /**
   * Auto-analyse a newly-submitted bug report.
   *
   * Called fire-and-forget from FeedbackModal immediately after the bug_reports
   * row is inserted.  The function fetches the report, checks GitHub Actions CI
   * status (when GITHUB_TOKEN is configured), and persists an AI-generated
   * diagnosis + fix suggestion back to the row automatically — no grand-master
   * action required.
   */
  autoAnalyseReport: async (params: { report_id: string }) => {
    return callEdgeFunction('auto-analyse-report', params, { showToast: false })
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
    notice_number?: string
    source_type?: string
    source_reference?: string
    plate_number?: string
    grounds?: string
    full_name?: string
    claimant_name?: string
    email?: string
    claimant_email?: string
    phone?: string
    claimant_phone?: string
    address?: string
    statement?: string
    message?: string
    request_homeless_review?: boolean
    hardship_context?: string
    evidence_statement?: string
  }) => {
    return callEdgeFunction('submit-dispute-intake', params, { showToast: false })
  },

  /**
   * Look up a public infringement case by notice number (unauthenticated).
   */
  publicCaseLookup: async (params: {
    notice_number?: string
    reference?: string
    plate_number?: string
  }) => {
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
    organization_id?: string
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

  // ============================================================================
  // PUSH-TO-TALK (PTT) (1 function)
  // ============================================================================

  /**
   * Get PTT signaling token for channel access.
   *
   * Returns a short-lived JWT for connecting to the PTT WebSocket server,
   * along with ICE server configuration for WebRTC.
   */
  pttSignalingToken: async (params: {
    /** Channel scope: 'org:<uuid>', 'incident:<uuid>', or 'direct:<uuid>' */
    channelScope: string
  }) => {
    return callEdgeFunction('ptt-signaling-token', params, { showToast: false })
  },

  // ============================================================================
  // BIOSECURITY (2 functions)
  // ============================================================================

  /**
   * Run Bob AI image analysis on a biosecurity site photo.
   * Returns species identification, density category, infestation stage,
   * checklist prefill, and weather summary.
   */
  biosecurityAssess: async (params: {
    job_id?: string | null
    image_base64: string
    gps_lat?: number | null
    gps_lng?: number | null
    address?: string
  }) => {
    return callEdgeFunction('biosecurity-assess', params, { showToast: false })
  },

  /**
   * Render a statutory Biosecurity notice to printable HTML.
   * The notice record must already exist in `biosecurity_notices`.
   *
   * @param biosecurity_notice_id  UUID of the `biosecurity_notices` row.
   * @param issued_by              UUID of the issuing officer.
   */
  biosecurityNotice: async (params: {
    biosecurity_notice_id: string
    issued_by: string
  }) => {
    return callEdgeFunction('biosecurity-notice', params)
  },

  // ============================================================================
  // SMOKE COMPLAINT OOH (2 functions)
  // ============================================================================

  /**
   * Run Bob AI image analysis on a smoke complaint photo.
   * Returns smoke opacity, colour, prohibited materials, offensive rating,
   * checklist prefill, and weather summary.
   */
  smokeAssess: async (params: {
    job_id?: string | null
    image_base64: string
    gps_lat?: number | null
    gps_lng?: number | null
    address?: string
    complaint_time?: string
    duration_reported?: number
  }) => {
    return callEdgeFunction('smoke-assess', params, { showToast: false })
  },

  /**
   * Render an RMA smoke/fire nuisance notice to printable HTML.
   * The notice record must already exist in `smoke_notices`.
   *
   * @param smoke_notice_id  UUID of the `smoke_notices` row.
   * @param issued_by        UUID of the issuing officer.
   */
  smokeNotice: async (params: {
    smoke_notice_id: string
    issued_by: string
  }) => {
    return callEdgeFunction('smoke-notice', params)
  },

  /**
   * Run Bob field-audio noise assessment to prefill matrix/action values.
   * Uses transcript + optional dB observation from street-side assessment.
   */
  noiseAudioAssess: async (params: {
    transcript?: string
    observed_db?: number | null
    time_category?: 'day' | 'evening' | 'night'
    location_context?: string
    complaint_address?: string
    matrix?: {
      volume_score?: number
      time_score?: number
      tone_score?: number
    }
  }) => {
    return callEdgeFunction('noise-audio-assess', params, { showToast: false })
  },

  // ============================================================================
  // UTILITIES (2 functions)
  // ============================================================================

  /**
   * Translate a text string to a target language via the Bob inference service.
   * Used by Team Chat for multilingual message support.
   */
  translateMessage: async (params: {
    text: string
    target_language: string
    source_language?: string
  }) => {
    return callEdgeFunction('translate-message', params, { showToast: false })
  },

  /**
   * Bulk-export observations, breaches, or notices to JSON or CSV.
   */
  exportData: async (params: {
    type: 'observations' | 'breaches' | 'notices'
    format?: 'json' | 'csv'
    organizationId: string
    from?: string
    to?: string
  }) => {
    return callEdgeFunction('export-data', params)
  },
}
