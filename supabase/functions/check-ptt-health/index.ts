/**
 * check-ptt-health — PTT transport health endpoint
 *
 * Thin proxy that forwards to check-services-health and normalises the response
 * so the audit script / monitoring tools that call `check-ptt-health` receive a
 * consistent `{ ptt_ws_url, ptt_url, ptt }` envelope without a 404.
 *
 * Required Supabase secrets (inherited from check-services-health):
 *   PTT_SERVER_URL   — base HTTP URL of the PTT signalling server
 *   PTT_WS_URL       — wss:// URL returned to clients (set once TLS proxy is live)
 *
 * Responds 200 with PTT health fields whether PTT is reachable or not.
 */

import { getCorsHeaders } from '../_shared/withCors.ts'

const HEALTH_CHECK_TIMEOUT_MS = 8_000

// Removed hardcoded IP fallback; rely on PTT_SERVER_URL environment variable
const PTT_SERVER_URL = (
  Deno.env.get('PTT_SERVER_URL') ||
  Deno.env.get('PTT_SERVICE_URL') ||
  ''
).replace(/\/+$/, '')

const RAW_WS = (Deno.env.get('PTT_WS_URL') || Deno.env.get('PTT_SIGNALING_WS_URL') || '').trim()

function normalizeWsUrl(raw: string): { url: string | null; warning?: string; error?: string } {
  if (!raw) return { url: null, warning: 'PTT_WS_URL not set; set the secret once TLS proxy is live' }
  if (!raw.startsWith('ws://') && !raw.startsWith('wss://')) {
    return { url: raw, error: 'PTT_WS_URL must start with ws:// or wss://' }
  }
  if (raw.startsWith('ws://')) {
    return { url: raw, warning: 'PTT_WS_URL uses insecure ws://; HTTPS clients may reject mixed content' }
  }
  return { url: raw }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  const wsResult = normalizeWsUrl(RAW_WS)

  // Probe the PTT server health endpoint
  let pttStatus: Record<string, unknown>
  try {
    const res = await fetch(`${PTT_SERVER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    })
    if (res.ok) {
      let body: Record<string, unknown> = { status: 'ok' }
      try { body = await res.json() } catch { /* keep default */ }
      pttStatus = { status: 'ok', ...body }
    } else {
      pttStatus = { status: 'degraded', error: `HTTP ${res.status}` }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    pttStatus = { status: 'offline', error: msg }
  }

  const body: Record<string, unknown> = {
    ptt: pttStatus,
    ptt_url: PTT_SERVER_URL,
    ptt_ws_url: wsResult.url,
    ptt_ws_url_validation: {
      valid: !wsResult.error,
      ...(wsResult.warning ? { warning: wsResult.warning } : {}),
      ...(wsResult.error ? { error: wsResult.error } : {}),
    },
    checked_at: new Date().toISOString(),
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  })
})
