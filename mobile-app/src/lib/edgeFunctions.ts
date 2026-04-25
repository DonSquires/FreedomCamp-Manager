import { supabase } from './supabase'

async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

async function getFunctionErrorMessage(err: any, fallback: string) {
  const baseMessage = err?.message || fallback
  const context = err?.context
  if (!context || typeof context.clone !== 'function') return baseMessage
  try {
    const payload = await context.clone().json()
    return payload?.error || payload?.message || baseMessage
  } catch {
    return baseMessage
  }
}

async function getValidAccessToken() {
  try {
    const { data, error } = await withTimeout(
      supabase.auth.refreshSession(),
      6000,
      'Auth refresh timed out',
    )
    if (!error && data.session?.access_token) {
      return data.session.access_token
    }
  } catch {
    // Fall back to current session lookup if refresh stalls.
  }

  const { data: { session } } = await withTimeout(
    supabase.auth.getSession(),
    4000,
    'Session lookup timed out',
  )
  if (session?.access_token) return session.access_token

  throw new Error('Session expired. Please sign in again.')
}

async function callEdgeFunction<T = any>(
  functionName: string,
  body?: any,
  fallbackMessage = 'Edge function request failed',
): Promise<{ data: T | null; error: string | null }> {
  const token = await getValidAccessToken()
  let result = await supabase.functions.invoke(functionName, {
    body,
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!result.error) {
    return { data: result.data as T, error: null }
  }

  const message = await getFunctionErrorMessage(result.error, fallbackMessage)
  if (!/invalid jwt|http\s*401|401\b/i.test(message)) {
    return { data: null, error: message }
  }

  const { data, error } = await supabase.auth.refreshSession()
  if (error || !data.session?.access_token) {
    return { data: null, error: 'Session expired. Please sign in again.' }
  }

  result = await supabase.functions.invoke(functionName, {
    body,
    headers: { Authorization: `Bearer ${data.session.access_token}` },
  })

  if (result.error) {
    return { data: null, error: await getFunctionErrorMessage(result.error, fallbackMessage) }
  }

  return { data: result.data as T, error: null }
}

async function callEdgeFunctionHttp<T = any>(
  functionName: string,
  body: any,
  fallbackMessage: string,
  timeoutMs = 15000,
): Promise<T> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    throw new Error('Missing Supabase environment configuration')
  }

  const send = async (token: string) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${payload?.error || payload?.message || fallbackMessage}`)
      }

      return payload as T
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('Ticket generation timed out. Please try again.')
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    const token = await getValidAccessToken()
    return await send(token)
  } catch (error: any) {
    const message = String(error?.message || fallbackMessage)
    if (!/invalid jwt|http\s*401|401\b/i.test(message)) {
      throw new Error(message || fallbackMessage)
    }
  }

  const { data, error: refreshError } = await withTimeout(
    supabase.auth.refreshSession(),
    6000,
    'Auth refresh timed out',
  )
  if (refreshError || !data.session?.access_token) {
    throw new Error('Session expired. Please sign in again.')
  }

  return await send(data.session.access_token)
}

export const edgeFunctions = {
  processALPR: async (params: any) => callEdgeFunction('alpr-process', params, 'ALPR request failed'),
  ingestVehicleObservation: async (params: any) => callEdgeFunction('vehicle-ingest', params, 'Vehicle ingest failed'),
  listObservations: async (params: any) => callEdgeFunction('observations-list', params, 'Failed to fetch observations'),
  renderInfringementNotice: async (params: { notice_id: string }) => callEdgeFunction('render-infringement-notice', params, 'Failed to load printable notice'),
  generateInfringement: async (params: any) => callEdgeFunctionHttp('generate-infringement', params, 'Failed to issue notice'),
  pttSignalingToken: async (params: { channelScope: string }) => callEdgeFunction('ptt-signaling-token', params, 'Failed to mint PTT token'),
  transcribeAudio: async (params: { clip_url: string; language?: string }) => callEdgeFunction('transcribe-audio', params, 'Failed to transcribe audio'),
}

export { withTimeout }