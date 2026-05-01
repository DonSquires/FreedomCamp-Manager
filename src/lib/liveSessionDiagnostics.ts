import type { Json } from '@/types/database'
import { getPTTDiagnostics } from '@/lib/ptt'

export type LiveSessionDiagnosticEvent = {
  event_type: string
  route_path?: string | null
  title?: string | null
  details: Json
  occurred_at: string
}

const MAX_QUEUE_SIZE = 200
const queue: LiveSessionDiagnosticEvent[] = []

const sessionId = (() => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `live-session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
})()

function sanitizeJson(value: unknown): Json {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeJson(item))
  }

  if (typeof value === 'object') {
    const out: Record<string, Json> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[key] = sanitizeJson(entry)
    }
    return out
  }

  return String(value)
}

export function getLiveSessionDiagnosticsSessionId(): string {
  return sessionId
}

export function recordLiveSessionDiagnostic(
  eventType: string,
  details: unknown = {},
  routePath?: string | null,
  title?: string | null,
): void {
  const normalizedType = String(eventType || '').trim().slice(0, 80)
  if (!normalizedType) return

  queue.push({
    event_type: normalizedType,
    route_path: routePath ? String(routePath).slice(0, 300) : null,
    title: title ? String(title).slice(0, 160) : null,
    details: sanitizeJson(details),
    occurred_at: new Date().toISOString(),
  })

  if (queue.length > MAX_QUEUE_SIZE) {
    queue.splice(0, queue.length - MAX_QUEUE_SIZE)
  }
}

export function drainLiveSessionDiagnostics(limit = 60): LiveSessionDiagnosticEvent[] {
  if (limit <= 0) return []
  return queue.splice(0, limit)
}

export function getLiveSessionPttSnapshot(): Json | null {
  try {
    return sanitizeJson(getPTTDiagnostics())
  } catch {
    return null
  }
}