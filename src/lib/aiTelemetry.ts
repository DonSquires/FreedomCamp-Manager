export type AiTelemetrySurface =
  | 'officer-copilot'
  | 'admin-triage'

export type AiTelemetryStage =
  | 'request'
  | 'response'
  | 'action_suggested'
  | 'action_applied'
  | 'action_dismissed'

export interface AiTelemetryEvent {
  surface: AiTelemetrySurface
  stage: AiTelemetryStage
  success: boolean
  latency_ms?: number | null
  reason?: string
  details?: Record<string, unknown>
}

export function emitAiTelemetry(event: AiTelemetryEvent): void {
  const payload = {
    ...event,
    emitted_at: new Date().toISOString(),
  }

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('ai:metric', { detail: payload }))
  }

  // Temporary sink until backend telemetry pipeline is wired.
  // eslint-disable-next-line no-console
  console.info('[ai-metric]', payload)
}
