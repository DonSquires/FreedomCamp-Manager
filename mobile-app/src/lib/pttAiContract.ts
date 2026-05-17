export type PTTAiStage = 'transcribe' | 'translate' | 'synthesize' | 'assist'

export interface PTTTranscriptionContract {
  transcript: string
  text: string
  source_language: string | null
  confidence: number | null
  provider: string | null
  fallback: boolean
  latency_ms: number | null
  raw: Record<string, any>
}

export interface PTTTranslationContract {
  translated_text: string
  target_language: string
  detected_source: string | null
  detected_language: string | null
  translation_confidence: number | null
  confidence_reason: string | null
  provider: string | null
  model: string | null
  fallback: boolean
  latency_ms: number | null
  raw: Record<string, any>
}

export interface PTTAiTelemetryEvent {
  surface: 'web' | 'mobile'
  stage: PTTAiStage
  success: boolean
  latency_ms: number | null
  reason?: string
  details?: Record<string, any>
}

export interface PTTAiTelemetryRecord extends PTTAiTelemetryEvent {
  emitted_at: string
}

export interface DailyAssistLaneSummary {
  date: string
  requests: number
  successes: number
  failures: number
  avg_latency_ms: number | null
  lanes: Record<string, {
    requests: number
    successes: number
    failures: number
    avg_latency_ms: number | null
  }>
}

const TELEMETRY_BUFFER_MAX = 1000
const telemetryBuffer: PTTAiTelemetryRecord[] = []

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, any>
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toConfidence(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const normalized = parsed > 1 ? parsed / 100 : parsed
  if (!Number.isFinite(normalized)) return null
  return Math.max(0, Math.min(1, normalized))
}

function toLatency(value: unknown, fallbackMs?: number): number | null {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed)
  if (Number.isFinite(fallbackMs) && (fallbackMs as number) >= 0) return Math.round(fallbackMs as number)
  return null
}

export function normalizePTTTranscriptionPayload(payload: unknown, latencyMs?: number): PTTTranscriptionContract {
  const raw = asRecord(payload)
  const transcript =
    asNonEmptyString(raw.transcript)
    || asNonEmptyString(raw.text)
    || asNonEmptyString(raw.spoken_text)
    || ''

  const sourceLanguage =
    asNonEmptyString(raw.source_language)
    || asNonEmptyString(raw.detected_language)
    || asNonEmptyString(raw.source_lang)
    || asNonEmptyString(raw.language)

  const confidence =
    toConfidence(raw.confidence)
    ?? toConfidence(raw.transcription_confidence)
    ?? toConfidence(raw.asr_confidence)

  return {
    transcript,
    text: transcript,
    source_language: sourceLanguage,
    confidence,
    provider: asNonEmptyString(raw.provider) || asNonEmptyString(raw.engine),
    fallback: raw.fallback === true,
    latency_ms: toLatency(raw.latency_ms ?? raw.latencyMs, latencyMs),
    raw,
  }
}

export function normalizePTTTranslationPayload(
  payload: unknown,
  options: { targetLanguage?: string; latencyMs?: number } = {},
): PTTTranslationContract {
  const raw = asRecord(payload)
  const translatedText =
    asNonEmptyString(raw.translated_text)
    || asNonEmptyString(raw.translation)
    || asNonEmptyString(raw.text)
    || ''

  const detectedSource =
    asNonEmptyString(raw.detected_source)
    || asNonEmptyString(raw.source_language)
    || asNonEmptyString(raw.source_lang)
    || asNonEmptyString(raw.detected_language)

  const targetLanguage =
    asNonEmptyString(raw.target_language)
    || asNonEmptyString(raw.target_lang)
    || options.targetLanguage
    || 'en'

  const translationConfidence =
    toConfidence(raw.translation_confidence)
    ?? toConfidence(raw.confidence)

  return {
    translated_text: translatedText,
    target_language: targetLanguage,
    detected_source: detectedSource,
    detected_language: detectedSource,
    translation_confidence: translationConfidence,
    confidence_reason: asNonEmptyString(raw.confidence_reason) || asNonEmptyString(raw.reason),
    provider: asNonEmptyString(raw.provider),
    model: asNonEmptyString(raw.model) || asNonEmptyString(raw.model_name),
    fallback: raw.fallback === true,
    latency_ms: toLatency(raw.latency_ms ?? raw.latencyMs, options.latencyMs),
    raw,
  }
}

export function emitPTTAiTelemetry(event: PTTAiTelemetryEvent): void {
  const payload = {
    ...event,
    emitted_at: new Date().toISOString(),
  }

  telemetryBuffer.push(payload)
  if (telemetryBuffer.length > TELEMETRY_BUFFER_MAX) {
    telemetryBuffer.shift()
  }

  // Lightweight hook for log collectors until a backend sink is wired.
  // eslint-disable-next-line no-console
  console.info('[ptt-ai-metric]', payload)
}

export function getPTTAiTelemetryBuffer(): PTTAiTelemetryRecord[] {
  return [...telemetryBuffer]
}

export function summarizeDailyAssistTelemetry(
  records: PTTAiTelemetryRecord[],
  date: string = new Date().toISOString().split('T')[0],
): DailyAssistLaneSummary {
  const totals = {
    requests: 0,
    successes: 0,
    failures: 0,
    latencyTotal: 0,
    latencyCount: 0,
  }

  const laneTotals: Record<string, {
    requests: number
    successes: number
    failures: number
    latencyTotal: number
    latencyCount: number
  }> = {}

  for (const record of records) {
    if (record.stage !== 'assist') continue
    if (!record.emitted_at?.startsWith(date)) continue

    const lane = typeof record.details?.lane === 'string' && record.details.lane.trim()
      ? String(record.details.lane)
      : 'unknown'

    if (!laneTotals[lane]) {
      laneTotals[lane] = {
        requests: 0,
        successes: 0,
        failures: 0,
        latencyTotal: 0,
        latencyCount: 0,
      }
    }

    const laneBucket = laneTotals[lane]
    const isRequest = record.reason === 'assist_request'

    if (isRequest) {
      totals.requests += 1
      laneBucket.requests += 1
      continue
    }

    if (record.success) {
      totals.successes += 1
      laneBucket.successes += 1
    } else {
      totals.failures += 1
      laneBucket.failures += 1
    }

    if (typeof record.latency_ms === 'number' && record.latency_ms >= 0) {
      totals.latencyTotal += record.latency_ms
      totals.latencyCount += 1
      laneBucket.latencyTotal += record.latency_ms
      laneBucket.latencyCount += 1
    }
  }

  const lanes: DailyAssistLaneSummary['lanes'] = {}
  for (const [lane, bucket] of Object.entries(laneTotals)) {
    lanes[lane] = {
      requests: bucket.requests,
      successes: bucket.successes,
      failures: bucket.failures,
      avg_latency_ms: bucket.latencyCount > 0 ? Math.round(bucket.latencyTotal / bucket.latencyCount) : null,
    }
  }

  return {
    date,
    requests: totals.requests,
    successes: totals.successes,
    failures: totals.failures,
    avg_latency_ms: totals.latencyCount > 0 ? Math.round(totals.latencyTotal / totals.latencyCount) : null,
    lanes,
  }
}
