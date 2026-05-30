/**
 * External Services Integration
 *
 * Typed clients for proxy (NZSCV/MotorWeb) and
 * Bob inference service (RunPod — vehicle ALPR + embeddings).
 * All calls route through Supabase Edge Functions; secrets stay server-side.
 */

import { supabase } from './supabase'
import { edgeFunctions } from './edgeFunctions'

type ServicesHealth = { proxy: boolean; inference: boolean }

// Dev-only URL hints (not used in production — Edge Function secrets take priority)
const PROXY_SERVER_URL = import.meta.env.VITE_PROXY_SERVER_URL
const INFERENCE_SERVICE_URL = import.meta.env.VITE_INFERENCE_SERVICE_URL
const INFERENCE_API_KEY = import.meta.env.VITE_INFERENCE_API_KEY
const SERVICES_HEALTH_CACHE_TTL_MS = 20_000
const SERVICES_HEALTH_ERROR_BACKOFF_MS = 45_000

let servicesHealthCache: { value: ServicesHealth; expiresAt: number } | null = null
let servicesHealthInFlight: Promise<ServicesHealth> | null = null

/**
 * Check NZSCV (Self-Contained Vehicle) status via proxy server
 * 
 * @param plateNumber - Vehicle registration plate
 * @returns NZSCV warrant details if found
 */
export async function checkNZSCVStatus(plateNumber: string) {
  const { data, error } = await edgeFunctions.checkNZSCVStatus({
    plate_number: plateNumber,
  })

  if (error) throw error
  return data
}

/**
 * Enrich vehicle data from MotorWeb via proxy server
 * 
 * @param plateNumber - Vehicle registration plate
 * @returns Vehicle details (make, model, year, etc.)
 */
export async function enrichFromMotorWeb(plateNumber: string) {
  const { data, error } = await edgeFunctions.enrichFromMotorWeb({
    plate_number: plateNumber,
  })

  if (error) throw error
  return data
}

/**
 * Analyze vehicle photo using inference service
 * 
 * @param photoUrl - Public URL of the vehicle photo
 * @returns Vehicle detection results + 384-D embedding
 */
export async function analyzeVehiclePhoto(photoUrl: string) {
  const { data, error } = await edgeFunctions.analyzeVehiclePhoto({
    photoUrl,
  })

  if (error) throw error
  return data
}

/**
 * Select best vehicle photo from multiple candidates
 * 
 * @param photoUrls - Array of photo URLs to compare
 * @returns Best photo URL + quality score
 */
export async function selectBestVehiclePhoto(photoUrls: string[]) {
  const { data, error } = await edgeFunctions.selectBestVehiclePhoto({
    photoUrls,
  })

  if (error) throw error
  return data
}

/**
 * Health check for external services (proxy + Bob inference)
 * Calls the check-services-health Edge Function which has access to service URLs.
 */
export async function checkServicesHealth() {
  const now = Date.now()

  if (servicesHealthCache && servicesHealthCache.expiresAt > now) {
    return servicesHealthCache.value
  }

  if (servicesHealthInFlight) {
    return servicesHealthInFlight
  }

  servicesHealthInFlight = (async () => {
    try {
      const { data, error } = await edgeFunctions.checkServicesHealth()

      if (error) {
        const msg = String(error).toLowerCase()
        const isTransientEdgeFailure =
          msg.includes('timed out') ||
          msg.includes('unable to reach the edge function') ||
          msg.includes('failed to fetch')

        if (!msg.includes('no active session') && !isTransientEdgeFailure) {
          console.error('Services health check failed:', error)
        }

        const fallback = { proxy: false, inference: false }
        servicesHealthCache = {
          value: fallback,
          expiresAt: Date.now() + SERVICES_HEALTH_ERROR_BACKOFF_MS,
        }
        return fallback
      }

      // Proxy is optional in RunPod-first deployments. Treat "not configured"
      // as neutral so global health doesn't stay amber when proxy isn't used.
      const proxyStatus = String(data?.proxy?.status || '').toLowerCase()
      const proxyError = String(data?.proxy?.error || '').toLowerCase()
      const proxyNotConfigured =
        proxyStatus === 'not_configured' ||
        proxyError.includes('not configured') ||
        proxyError.includes('proxy_server_url')
      const proxyOk =
        proxyNotConfigured ||
        proxyStatus === 'ok' ||
        proxyStatus === 'healthy'
      const inferenceOk = data?.inference?.status === 'ok' || data?.inference?.status === 'healthy'
      const result = { proxy: proxyOk, inference: inferenceOk }

      servicesHealthCache = {
        value: result,
        expiresAt: Date.now() + SERVICES_HEALTH_CACHE_TTL_MS,
      }

      return result
    } catch (error) {
      console.error('Services health check error:', error)
      const fallback = { proxy: false, inference: false }
      servicesHealthCache = {
        value: fallback,
        expiresAt: Date.now() + SERVICES_HEALTH_ERROR_BACKOFF_MS,
      }
      return fallback
    } finally {
      servicesHealthInFlight = null
    }
  })()

  return servicesHealthInFlight
}

/**
 * Run Bob agent loop through inference-service with ledger-backed context.
 */
export async function runBobAgentLoop(params: {
  prompt: string
  session_id?: string
  user_id?: string
  current_route?: string
  query_embedding?: number[]
  context?: Record<string, unknown>
  system_prompt?: string
}) {
  if (!INFERENCE_SERVICE_URL) {
    throw new Error('VITE_INFERENCE_SERVICE_URL not configured')
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  try {
    const { data } = await supabase.auth.getSession()
    const accessToken = data?.session?.access_token
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`
    } else if (INFERENCE_API_KEY) {
      headers['x-inference-api-key'] = INFERENCE_API_KEY
    }
  } catch {
    if (INFERENCE_API_KEY) {
      headers['x-inference-api-key'] = INFERENCE_API_KEY
    }
  }

  const response = await fetch(`${INFERENCE_SERVICE_URL}/bob/agent-loop`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || data?.message || `Bob agent loop failed (${response.status})`)
  }

  return data
}
