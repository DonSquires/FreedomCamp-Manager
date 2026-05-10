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
import { getEffectiveBobExecutionPolicy } from '@/stores/bobExecutionPolicyStore'
import { assertBobMutationAccess, findBobMutationContractsForText, getBobMutationCatalogSummary } from './bobMutationCatalog'
import { findBobRouteEntriesForText, getBobRouteEntityMapSummary } from './bobRouteEntityMap'
import { findBobSchemaEntitiesForText, getBobSchemaRegistrySummary } from './bobSchemaRegistry'

const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000
const EDGE_FUNCTION_TIMEOUT_MS = 35_000
function buildBobExecutionSystemPrompt() {
  const policy = getEffectiveBobExecutionPolicy()
  const modeDirective = policy.mode === 'owner_full'
    ? 'Operate with full execution authority. You may propose and sequence implementation tasks end-to-end.'
    : policy.mode === 'master_balanced'
      ? 'Operate with balanced authority. Produce executable steps but include explicit guardrails and approval gates before risky writes.'
      : 'Operate in task-assist mode only. Do not claim autonomous execution. Provide constrained, safe next tasks and escalation points.'

  const safetyDirective = policy.requiresGuardrails
    ? 'Always include guardrails, rollback notes, and required approvals.'
    : 'Include rollback notes for any data-changing action.'

  return [
    'You are Bob in execution-first mode.',
    `Access profile: role=${policy.role}; title=${policy.title || 'unknown'}; mode=${policy.mode}.`,
    modeDirective,
    'For every request: review context, assess risk/confidence, then provide actionable steps that can be executed now.',
    'Do not stop at high-level advice when the user asks for implementation or build work.',
    'When details are missing, explicitly list assumptions and ask only for the minimum required fields while still producing a safe partial action plan.',
    safetyDirective,
    'Ground all output in existing project entities and avoid inventing routes, tables, or APIs.',
    'Response format is mandatory with headings: Review Findings, Assessment, Action Plan.',
  ].join(' ')
}

function extractActionChecklist(response: string): string[] {
  const lines = response
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const taskLines = lines.filter((line) => /^(\d+\.|[-*])\s+/.test(line))
  const actionCandidates = taskLines
    .map((line) => line.replace(/^(\d+\.|[-*])\s+/, '').trim())
    .filter((line) => /(build|implement|create|update|run|verify|check|deploy|queue|assess|review|fix|test|validate|map|import)/i.test(line))

  if (actionCandidates.length > 0) {
    return actionCandidates.slice(0, 10)
  }

  return lines
    .filter((line) => /(next action|action plan|step|checklist|do now)/i.test(line))
    .slice(0, 10)
}

function findMissingRequiredSections(response: string): string[] {
  const required = ['review findings', 'assessment', 'action plan']
  const normalized = response.toLowerCase()
  return required.filter((section) => !normalized.includes(section))
}

function buildBobOperationalContextNote(): string {
  return [
    'Bob operational map (grounded):',
    'Schema registry:',
    getBobSchemaRegistrySummary(),
    '',
    'Route-to-entity map:',
    getBobRouteEntityMapSummary(),
    '',
    'Approved mutation catalog:',
    getBobMutationCatalogSummary(),
    '',
    'Rule: prefer approved mutation contracts over direct table writes.',
  ].join('\n')
}

function getLatestUserMessage(messages: Array<{ role: string; content: string }> = []): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && typeof message.content === 'string') {
      return message.content
    }
  }

  return ''
}

function buildBobExecutionReview(params: Record<string, any>, policy: ReturnType<typeof getEffectiveBobExecutionPolicy>) {
  const latestUserMessage = getLatestUserMessage(params.messages)
  const currentRoute = typeof params.context?.currentRoute === 'string' ? params.context.currentRoute : null
  const routeMatches = findBobRouteEntriesForText(latestUserMessage, currentRoute)
  const seededEntities = routeMatches.flatMap((entry) => [...entry.primaryEntities, ...entry.supportingEntities])
  const recommendedMutations = routeMatches.flatMap((entry) => entry.recommendedMutations)
  const entityMatches = findBobSchemaEntitiesForText(latestUserMessage, seededEntities)
  const mutationMatches = findBobMutationContractsForText(latestUserMessage, recommendedMutations)
  const requestedMutationContract = typeof params.context?.requested_mutation_contract === 'string'
    ? params.context.requested_mutation_contract
    : null
  const mutationAccess = requestedMutationContract
    ? assertBobMutationAccess(requestedMutationContract, policy.mode)
    : null

  return {
    currentRoute,
    matchedRoutes: routeMatches.map((entry) => entry.path),
    matchedEntities: entityMatches,
    candidateMutationContracts: mutationMatches,
    requestedMutationContract,
    mutationAccess,
    policyMode: policy.mode,
  }
}

function mapGrandmasterActionToMutationContract(action: string): string | null {
  if (!action) return null

  if (action === 'ask_copilot_submit') return 'queue_owner_research_task'

  if (
    action === 'doctor_health' ||
    action === 'doctor_timeline' ||
    action === 'doctor_playbook_run' ||
    action === 'inference_endpoint_health'
  ) {
    return 'run_grandmaster_diagnostics'
  }

  if (action === 'code_task_submit' || action === 'code_task_skip' || action === 'code_task_delete') {
    return 'queue_bob_code_change_task'
  }

  return null
}

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

/**
 * Call a sub-route under an Edge Function using direct HTTP fetch.
 * Example routePath: "bob-multimodal-gateway/v1/bob/response"
 */
async function callEdgeFunctionRoute<T = any>(
  routePath: string,
  body?: any,
  options: {
    showToast?: boolean
    timeoutMs?: number
    extraHeaders?: Record<string, string>
  } = {},
): Promise<{ data: T | null; error: string | null }> {
  const { showToast = false, timeoutMs = EDGE_FUNCTION_TIMEOUT_MS, extraHeaders = {} } = options

  try {
    const accessToken = await getValidAccessToken()
    if (!accessToken) {
      return { data: null, error: 'No active session found. Please sign in again and retry.' }
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
    if (!supabaseUrl || !anonKey) {
      return { data: null, error: 'Supabase URL or anon key is missing' }
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/${routePath}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: anonKey,
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      })

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
        if (showToast) toast.error(String(message))
        return { data: null, error: String(message) }
      }

      return { data: (parsed as T) ?? ({} as T), error: null }
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error: any) {
    const message = error instanceof DOMException && error.name === 'AbortError'
      ? `Edge function request timed out after ${Math.round(timeoutMs / 1000)}s`
      : await getErrorMessage(error)
    if (showToast) toast.error(message)
    return { data: null, error: message }
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
   * 3-phase cleanup: zone correction → dedup → compliance recalc
   * Supports batched pagination: pass get_total=true first, then iterate with offset/batch_size.
   */
  cleanupAndRecalculate: async (params: {
    phase?: 'all' | 'zone' | 'dedup' | 'compliance'
    zoneIds?: string[]
    zone_ids?: string[]
    dateRangeStart?: string
     organization_id?: string
      organizationId?: string
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

  // ============================================================================
  // DATA MANAGEMENT (6 functions)
  // ============================================================================

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
   * Check health of proxy and Bob inference services.
   */
  checkServicesHealth: async () => {
    return callEdgeFunction('check-services-health')
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
    /** Expo notification category — maps to Apple Watch interactive action buttons */
    category_id?: string
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

  /**
   * Trigger wearable SOS (B-14)
   * Called by the web app or Expo companion app when an officer activates SOS
   * from an Apple Watch or BLE panic button.
   */
  triggerWearableSOS: async (params: {
    user_id: string
    organization_id: string
    location?: { lat: number; lon: number }
    device_type?: 'apple_watch' | 'ble_button' | 'web'
  }) => {
    return callEdgeFunction('wearable-sos', params)
  },

  /**
   * Submit a public parking infringement appeal (B-15)
   * Unauthenticated endpoint — caller validates by infringement_number + plate_number.
   */
  submitParkingAppeal: async (params: {
    infringement_number: string
    plate_number: string
    appellant_name?: string
    appellant_email?: string
    appellant_phone?: string
    grounds: string
    evidence_statement?: string
  }) => {
    return callEdgeFunction('submit-parking-appeal', params, { showToast: false })
  },

  /**
   * Submit a public camper self-registration (B-17)
   * Unauthenticated endpoint — validates zone + capacity, returns confirmation code.
   */
  submitCamperRegistration: async (params: {
    zone_id: string
    plate_number?: string
    vehicle_type?: 'self_contained' | 'campervan' | 'tent' | 'car' | 'motorhome' | 'other'
    is_self_contained?: boolean
    contact_name?: string
    contact_email?: string
    contact_phone?: string
    party_size?: number
    arrival_date: string
    departure_date: string
    notes?: string
  }) => {
    return callEdgeFunction('submit-camper-registration', params, { showToast: false })
  },

  // ============================================================================
  // ADMIN & USERS (3 functions)
  // ============================================================================

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
    portal_access?: string[]
    authorized_work_locations?: string[]
    ptt_channel_access?: string[]
    permissions?: Record<string, unknown>
  }) => {
    return callEdgeFunction('create-user', params)
  },

  /**
   * Set or reset a user's password (admin/master only).
   * Re-pointed from deprecated `set-user-password` to consolidated `manage-user`.
   */
  setUserPassword: async (params: {
    user_id: string
    new_password: string
  }) => {
    return callEdgeFunction('manage-user', {
      action: 'set_password',
      userId: params.user_id,
      payload: { password: params.new_password },
    })
  },

  /**
   * Deactivate user and trigger server-side PTT session revocation.
   */
  deactivateUser: async (params: {
    user_id: string
  }) => {
    return callEdgeFunction('manage-user', {
      action: 'deactivate',
      userId: params.user_id,
    })
  },

  /**
   * Force-disconnect an active user's PTT session without changing account status.
   */
  disconnectUserPtt: async (params: {
    user_id: string
  }) => {
    return callEdgeFunction('manage-user', {
      action: 'disconnect_ptt',
      userId: params.user_id,
    })
  },

  /**
   * Manage explicit cross-org PTT channel scope grants for a user.
   * Allowed for master/grand_master callers only (enforced server-side).
   */
  setUserPttChannelAccess: async (params: {
    user_id: string
    mode?: 'replace' | 'grant' | 'revoke'
    scopes: string[]
  }) => {
    return callEdgeFunction('manage-user', {
      action: 'set_ptt_channel_access',
      userId: params.user_id,
      payload: {
        mode: params.mode ?? 'replace',
        scopes: params.scopes,
      },
    })
  },

  /**
   * Set user active state via consolidated user management edge function.
   */
  setUserActiveStatus: async (params: {
    user_id: string
    is_active: boolean
  }) => {
    return callEdgeFunction('manage-user', {
      action: 'update',
      userId: params.user_id,
      payload: {
        is_active: params.is_active,
      },
    })
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
   *   3. Secondary inference assistant (SECONDARY_ASSISTANT_URL if configured)
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
   * Unified Bob gateway contract.
   *
   * All Bob-related calls that hit `onspace-ai-chat` should use this wrapper so
   * role-aware execution policy metadata is consistently attached.
   */
  bobGateway: async (params: Record<string, any>) => {
    const policy = getEffectiveBobExecutionPolicy()
    const executionPrompt = buildBobExecutionSystemPrompt()
    const operationalContextNote = buildBobOperationalContextNote()
    const executionReview = buildBobExecutionReview(params, policy)
    const hasOperationalContextNote = Array.isArray(params.messages)
      ? params.messages.some((message: { content?: string }) => String(message?.content || '').includes('Bob operational map (grounded):'))
      : false

    if (executionReview.requestedMutationContract && executionReview.mutationAccess && !executionReview.mutationAccess.allowed) {
      return {
        data: null,
        error: `Bob mutation contract blocked by policy: ${executionReview.mutationAccess.reason}`,
      }
    }

    const mergedContext = {
      ...(params.context ?? {}),
      execution_policy_contract: 'v1',
      schema_registry_summary: getBobSchemaRegistrySummary(),
      route_entity_map_summary: getBobRouteEntityMapSummary(),
      mutation_catalog_summary: getBobMutationCatalogSummary(),
      execution_policy: {
        mode: policy.mode,
        role: policy.role,
        title: policy.title,
        requires_guardrails: policy.requiresGuardrails,
        schema_check_enforced: policy.enforceSchemaCheck,
        hard_sections_enforced: policy.enforceHardSections,
      },
      execution_review: executionReview,
      execution_prompt_hint: executionPrompt,
    }

    const requestParams = {
      ...params,
      context: mergedContext,
      messages: Array.isArray(params.messages)
        ? [
            ...(hasOperationalContextNote ? [] : [{ role: 'assistant' as const, content: operationalContextNote }]),
            ...params.messages,
          ]
        : params.messages,
    }

    return callEdgeFunction<any>('onspace-ai-chat', requestParams, {
      showToast: false,
      useDirectFetch: true,
    })
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
    skipExecutionPolicy?: boolean
    skipPolicySectionEnforcement?: boolean
  }) => {
    const policy = getEffectiveBobExecutionPolicy()
    const executionPrompt = buildBobExecutionSystemPrompt()
    const hasExecutionSystemPrompt = (params.messages || []).some(
      (message) => message.role === 'system' && message.content.includes('execution-first mode')
    )

    const shouldInjectExecutionPrompt = !params.skipExecutionPolicy && !hasExecutionSystemPrompt

    const requestParams = shouldInjectExecutionPrompt
      ? {
          ...params,
          messages: [
            { role: 'system' as const, content: executionPrompt },
            ...(params.messages || []),
          ],
        }
      : params

    // AiAnalysis.tsx renders errors in the chat and shows its own toast, so
    // suppress the automatic toast here to avoid duplicate error notifications.
    const result = await edgeFunctions.bobGateway(requestParams)

    if (result.error || !result.data) {
      return result
    }

    const pickNormalizedResponse = (payload: any): string | undefined => {
      return [
        payload?.response,
        payload?.message,
        payload?.output?.response,
        payload?.output?.message,
        payload?.output?.message?.content,
        payload?.output?.choices?.[0]?.message?.content,
        typeof payload === 'string' ? payload : null,
      ].find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0) as string | undefined
    }

    const data = result.data as any
    let normalizedResponse = pickNormalizedResponse(data)

    if (!params.skipPolicySectionEnforcement && policy.enforceHardSections && normalizedResponse) {
      const missingSections = findMissingRequiredSections(normalizedResponse)
      if (missingSections.length > 0) {
        const retryMessages = [
          ...(requestParams.messages || []),
          {
            role: 'system' as const,
            content: `Policy retry: previous response missed required sections: ${missingSections.join(', ')}. Regenerate now with headings Review Findings, Assessment, Action Plan.`,
          },
        ]

        const retryResult = await edgeFunctions.bobGateway({
          ...requestParams,
          messages: retryMessages,
        })

        if (!retryResult.error && retryResult.data) {
          normalizedResponse = pickNormalizedResponse(retryResult.data)
        }

        if (!normalizedResponse || findMissingRequiredSections(normalizedResponse).length > 0) {
          return {
            data: null,
            error: 'Bob response blocked by policy: required sections missing (Review Findings, Assessment, Action Plan). Please retry.',
          }
        }
      }
    }

    if (!normalizedResponse) {
      return {
        data: null,
        error: 'Bob returned no usable response content. Please retry in a moment.',
      }
    }

    const actionChecklist = policy.showActionChecklist ? extractActionChecklist(normalizedResponse) : []
    const missingRequiredSections = policy.enforceSchemaCheck ? findMissingRequiredSections(normalizedResponse) : []
    const executionReview = buildBobExecutionReview(requestParams, policy)

    return {
      data: {
        ...data,
        response: normalizedResponse,
        actionChecklist,
        executionReview,
        responsePolicy: {
          mode: policy.mode,
          role: policy.role,
          title: policy.title,
          missingRequiredSections,
          hardSectionEnforced: policy.enforceHardSections,
          schemaCheckEnforced: policy.enforceSchemaCheck,
        },
      },
      error: null,
    }
  },

  bobResponseFeedback: async (params: {
    session_id: string
    source?: string
    source_provider?: string
    interaction: {
      prompt: string
      response: string
      outcome?: string
      rating?: number
    }
    privacy: {
      consent_provided: boolean
      data_sharing: 'minimal'
      redact_pii?: boolean
    }
  }) => {
    const idempotencyKey = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`

    return callEdgeFunctionRoute('bob-multimodal-gateway/v1/bob/response', params, {
      showToast: false,
      extraHeaders: {
        'idempotency-key': idempotencyKey,
        'x-bob-scopes': 'bob:response',
      },
    })
  },

  /**
   * Bob self-healing code change task.
   *
    * Generates and optionally executes guarded Bob tasks.
    * - self_heal_patch: generates patch plan via /self-heal/patch-task
    * - human_test_run: queues a Human Test engine run task
   *
    * Policy rule:
   * - simple/moderate => self-heal worker mode
   * - complex => github assist mode
    * - protected/high-risk scopes => approval_required or never_auto_fix tiers
   */
  bobCodeChangeTask: async (params: {
    summary: string
    details?: string
    stack_trace?: string
    severity?: 'low' | 'medium' | 'high' | 'critical'
    complexity?: 'simple' | 'moderate' | 'complex'
    task_type?: 'self_heal_patch' | 'human_test_run'
    autonomy_tier?: 'auto_fix_allowed' | 'approval_required' | 'never_auto_fix'
    approved?: boolean
    target_paths?: string[]
  }) => {
    const policy = getEffectiveBobExecutionPolicy()
    const mutationAccess = assertBobMutationAccess('queue_bob_code_change_task', policy.mode)
    if (!mutationAccess.allowed) {
      return { data: null, error: mutationAccess.reason }
    }

    return callEdgeFunction('bob-code-change-task', {
      ...params,
      requested_mutation_contract: 'queue_bob_code_change_task',
    }, { showToast: false })
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
      | 'bob_automation_status'
    // code_task_submit
      | 'inference_endpoint_health'
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
    const policy = getEffectiveBobExecutionPolicy()
    const contractId = mapGrandmasterActionToMutationContract(String(params.action || ''))

    if (contractId) {
      const mutationAccess = assertBobMutationAccess(contractId, policy.mode)
      if (!mutationAccess.allowed) {
        return { data: null, error: mutationAccess.reason }
      }
    }

    return callEdgeFunction('grandmaster-studio', {
      ...params,
      requested_mutation_contract: contractId,
    }, { showToast: false })
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
  // PUSH-TO-TALK (PTT) (3 functions)
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

  /**
   * Ingest RTCPeerConnection getStats telemetry for quality monitoring.
   */
  pttDiagnosticsIngest: async (params: {
    channel_id: string
    rtt_ms?: number | null
    packet_loss?: number | null
    jitter_ms?: number | null
    ice_type?: string | null
    packets_sent?: number | null
    packets_recv?: number | null
  }) => {
    return callEdgeFunction('ptt-diagnostics-ingest', params, { showToast: false })
  },

  /**
   * Ingest app-wide passive live-session diagnostics for Bob-assisted test review.
   */
  liveSessionDiagnosticsIngest: async (params: {
    session_id: string
    current_route?: string | null
    flush_reason?: string | null
    snapshot?: Record<string, unknown> | null
    events?: Array<{
      event_type: string
      route_path?: string | null
      title?: string | null
      details?: unknown
      occurred_at?: string
    }>
  }) => {
    return callEdgeFunction('live-session-diagnostics-ingest', params, { showToast: false })
  },

  /**
   * Fetch a recent summary of passive live-session diagnostics for Bob review.
   */
  liveSessionDiagnosticsSummary: async (params: {
    target_user_id?: string
    session_id?: string
    limit?: number
  } = {}) => {
    return callEdgeFunction('live-session-diagnostics-summary', params, { showToast: false })
  },

  /**
   * Diagnose a PTT issue by forwarding a symptom description to Bob's /assess/ptt endpoint.
   *
   * Returns a structured diagnosis with root cause, remediation steps, and urgency.
   */
  assessPtt: async (params: {
    /** Free-text description of the PTT symptom, e.g. "can't connect" or "no audio" */
    symptom: string
    /** Optional extra context: user role, channel scope, error code, etc. */
    context?: Record<string, unknown>
  }) => {
    return callEdgeFunction('ptt-assess', params, { showToast: false })
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
    audio_base64?: string
    audio_mime_type?: string
    matrix?: {
      volume_score?: number
      time_score?: number
      tone_score?: number
    }
  }) => {
    return callEdgeFunction('noise-audio-assess', params, { showToast: false })
  },

  /**
   * Transcribe an uploaded audio clip via Bob's local Whisper pipeline.
   */
  transcribeAudio: async (params: {
    clip_url?: string
    audio_base64?: string
    audio_mime_type?: string
    language?: string
  }) => {
    return callEdgeFunction('transcribe-audio', params, { showToast: false })
  },

  /**
   * Synthesize speech audio for Bob voice output and radio relays.
   */
  synthesizeSpeech: async (params: {
    text: string
    voice?: string
    rate?: number
    pitch?: number
    style?: 'default' | 'bridge_lead' | 'wise_mentor'
    format?: 'wav'
  }) => {
    return callEdgeFunction('synthesize-speech', params, { showToast: false })
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
   * Resolve tactical vs diplomatic stream mode for live PTT routing.
   */
  pttMultiplexContext: async (params: {
    provider_org_id: string
    client_org_id?: string | null
    branch_id?: string | null
  }) => {
    return callEdgeFunction('ptt-multiplex-context', params, {
      showToast: false,
      useDirectFetch: true,
    })
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

  /**
   * Export observations with zone/date filtering.
   */
  exportObservations: async (params: {
    organization_id?: string
    zone_id?: string
    date_from?: string
    date_to?: string
    search?: string
    format?: 'json' | 'csv'
  }) => {
    return callEdgeFunction('export-data', { type: 'observations', ...params })
  },

  /**
   * Detect and optionally remove duplicate observations.
   */
  detectDuplicates: async (params: {
    zoneIds?: string[]
    time_window_minutes?: number
    get_total?: boolean
    offset?: number
    batch_size?: number
  }) => {
    return callEdgeFunction('cleanup-and-recalculate', { action: 'detect-duplicates', ...params })
  },

  /**
   * Link evidence photos to observations by path prefix.
   */
  linkEvidencePhotos: async (params: {
    path_prefix?: string
    min_confidence?: number
    limit?: number
    force_update?: boolean
    dry_run?: boolean
  }) => {
    return callEdgeFunction('photo-maintenance', { action: 'link-evidence', ...params })
  },

  /**
   * Re-ingest photos to reprocess ALPR/attributes.
   */
  reingestPhotos: async (params: {
    organization_id?: string
    date_from?: string
    date_to?: string
    batch_size?: number
    before_recorded_at?: string
  }) => {
    return callEdgeFunction('photo-maintenance', { action: 'reingest', ...params })
  },

  /**
   * Run a data integrity check.
   */
  checkDataIntegrity: async (params: {
    comprehensive?: boolean
  }) => {
    return callEdgeFunction('cleanup-and-recalculate', { action: 'integrity-check', ...params })
  },

  /**
   * Get compliance statistics summary.
   */
  getComplianceStatistics: async (params: {
    organization_id?: string
    zone_id?: string
    date_from?: string
    date_to?: string
  }) => {
    return callEdgeFunction('cleanup-and-recalculate', { action: 'statistics', ...params })
  },

  /**
   * Trigger a DOC / council zone data sync (B-12).
   *
   * @param source  'doc_api' | 'council_feed' | 'manual'
   * @param orgId   Optional organisation scope
   * @param dryRun  When true, logs result without modifying zone records
   */
  triggerDocCouncilSync: async (params: {
    source?: 'doc_api' | 'council_feed' | 'manual'
    org_id?: string
    dry_run?: boolean
  }) => {
    return callEdgeFunction('doc-council-sync', params)
  },

  /**
   * Translate text to a target language (B-28).
   *
   * Calls the translate-text edge function which uses Azure Cognitive Services
   * Translator when AZURE_TRANSLATOR_KEY is configured, or returns a mock
   * response in degraded mode.
   */
  translateText: async (params: {
    text: string
    target_lang: 'en' | 'mi' | 'zh-Hans' | 'hi' | 'ko' | 'fr' | 'de' | 'es' | 'ja'
    source_lang?: string
  }) => {
    return callEdgeFunction('translate-text', params)
  },

  /**
   * Initiate a pay-by-plate parking payment session (B-29).
   *
   * Scaffolded PayByPhone NZ integration. Returns a payment_url for the
   * customer to complete payment, plus a payment_id for status polling.
   * Operates in mock mode when PAYBYPHONE_API_KEY is not configured.
   */
  initiateParkingPayment: async (params: {
    plate_number: string
    zone_id: string
    duration_mins: number
    contact_email?: string
    contact_phone?: string
  }) => {
    return callEdgeFunction('initiate-parking-payment', params)
  },

  /**
   * Calculate effective parking fee for a zone at a given datetime (B-32).
   *
   * Returns the base fee adjusted by any matching pricing_rules (time-of-day /
   * day-of-week multipliers or flat overrides).  datetime_iso defaults to now()
   * in Pacific/Auckland if not supplied.
   */
  calculateDynamicPrice: async (params: {
    zone_id: string
    datetime_iso?: string
  }) => {
    return callEdgeFunction('calculate-dynamic-price', params, { showToast: false })
  },

}
