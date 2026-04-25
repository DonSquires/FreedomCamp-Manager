/**
 * Bob/Ollama inference helper for Supabase Edge Functions.
 *
 * All AI inference routes through Bob on RunPod (no OpenAI, no external AI providers).
 * When INFERENCE_SERVICE_URL is a RunPod serverless endpoint (api.runpod.ai/v2/*),
 * requests are submitted as /runsync jobs.
 */

import { fetchWithRetry } from './fetchWithRetry.ts'

const BOB_INFERENCE_RETRIES = Math.max(0, Number(Deno.env.get('BOB_INFERENCE_RETRIES') ?? '2'))
const BOB_INFERENCE_BACKOFF_MS = Math.max(0, Number(Deno.env.get('BOB_INFERENCE_BACKOFF_MS') ?? '600'))

function isRunpodServerless(url: string): boolean {
  return /api\.runpod\.ai\/v2\/[^/]+(?:\/(?:run|runsync))?\/?$/i.test(url)
}

function normalizeRunpodBase(url: string): string {
  return url.replace(/\/(run|runsync)\/?$/i, '')
}

function normalizeBaseUrl(raw?: string | null): string {
  const trimmed = String(raw ?? '').trim().replace(/\/$/, '')
  if (!trimmed) return ''
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return isRunpodServerless(withScheme) ? normalizeRunpodBase(withScheme) : withScheme
}

function isTruthyEnv(value: string | null | undefined): boolean {
  return String(value ?? '').trim().toLowerCase() === 'true'
}

function getOrigin(url: string): string {
  return new URL(url).origin
}

function getAllowedInferenceOrigins(): string[] {
  const raw = String(Deno.env.get('BOB_ALLOWED_INFERENCE_HOSTS') ?? '').trim()
  if (!raw) return []

  return raw
    .split(',')
    .map((entry) => normalizeBaseUrl(entry))
    .filter(Boolean)
    .map((entry) => getOrigin(entry))
}

function getForbiddenProviderEnvKeys(): string[] {
  const env = Deno.env.toObject()
  return Object.keys(env)
    .filter((key) => /^OPENAI_/i.test(key) || /^AZURE_OPENAI_/i.test(key))
    .filter((key) => String(env[key] ?? '').trim() !== '')
}

function enforceBobOnlyProviderLock(inferenceUrl: string): void {
  const providerLockEnabled = !isTruthyEnv(Deno.env.get('BOB_PROVIDER_LOCK_DISABLED'))
  if (!providerLockEnabled) return

  // Optional compatibility mode: allow provider env vars to exist for reference
  // or migration metadata, while still forcing all runtime calls through Bob.
  const allowReferenceProviderEnv = isTruthyEnv(Deno.env.get('BOB_ALLOW_PROVIDER_REFERENCE_ENV'))

  const forbiddenKeys = getForbiddenProviderEnvKeys()
  if (!allowReferenceProviderEnv && forbiddenKeys.length > 0) {
    throw new Error(`BOB_PROVIDER_LOCK: forbidden provider env vars present (${forbiddenKeys.join(', ')})`)
  }

  const allowedOrigins = getAllowedInferenceOrigins()
  if (allowedOrigins.length === 0) {
    throw new Error('BOB_PROVIDER_LOCK: BOB_ALLOWED_INFERENCE_HOSTS must be configured')
  }

  const targetOrigin = getOrigin(inferenceUrl)
  if (!allowedOrigins.includes(targetOrigin)) {
    throw new Error(`OUTBOUND_HOST_NOT_ALLOWED: ${targetOrigin}`)
  }
}

function getInferenceConfig(): { inferenceUrl: string; apiKey: string } {
  const inferenceUrl = normalizeBaseUrl(Deno.env.get('INFERENCE_SERVICE_URL'))
  const apiKey =
    Deno.env.get('INFERENCE_API_KEY') ||
    Deno.env.get('RUNPOD_ENDPOINT_API_KEY') ||
    Deno.env.get('RUNPOD_API_KEY') ||
    Deno.env.get('BOB_INFERENCE_API_KEY') ||
    ''

  if (!inferenceUrl) {
    throw new Error('INFERENCE_SERVICE_URL is not configured')
  }

  enforceBobOnlyProviderLock(inferenceUrl)
  return { inferenceUrl, apiKey }
}

export interface BobChatOptions {
  message: string
  history?: Array<{ role: string; content: string }>
  systemPrompt?: string
  model?: string
  temperature?: number
  context?: Record<string, unknown>
  timeoutMs?: number
}

export interface BobChatResult {
  response: string
  model: string
  provider: string
}

export interface BobAssessOptions {
  type: 'smoke' | 'biosecurity' | 'noise' | 'ptt' | 'platform' | string
  symptom?: string
  description?: string
  imageDescription?: string
  context?: Record<string, unknown>
  model?: string
  timeoutMs?: number
}

export interface BobAssessResult {
  assessment: unknown
  rawResponse: string
  model: string
  provider: string
}

export interface BobTranslateOptions {
  text: string
  targetLanguage: string
  sourceLanguage?: string
  timeoutMs?: number
}

/**
 * Call Bob AI (Ollama on RunPod) for chat. Automatically uses /runsync for
 * RunPod serverless endpoints, or direct /chat for HTTP inference services.
 */
export async function bobChat(options: BobChatOptions): Promise<BobChatResult> {
  const { inferenceUrl, apiKey } = getInferenceConfig()
  const timeoutMs = options.timeoutMs ?? 130_000

  let res: Response

  if (isRunpodServerless(inferenceUrl)) {
    res = await fetchWithRetry(
      `${inferenceUrl}/runsync`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          executionTimeout: 120000,
          input: {
            action: 'chat',
            message: options.message,
            history: options.history ?? [],
            system_prompt: options.systemPrompt,
            model: options.model,
            temperature: options.temperature ?? 0.7,
            context: options.context,
          },
        }),
      },
      {
        retries: BOB_INFERENCE_RETRIES,
        timeoutMs,
        backoffMs: BOB_INFERENCE_BACKOFF_MS,
      },
    )
  } else {
    res = await fetchWithRetry(
      `${inferenceUrl}/chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey
            ? {
                'x-inference-api-key': apiKey,
                'Authorization': `Bearer ${apiKey}`,
              }
            : {}),
        },
        body: JSON.stringify({
          message: options.message,
          history: options.history ?? [],
          model: options.model,
          temperature: options.temperature ?? 0.7,
          context: options.context,
        }),
      },
      {
        retries: BOB_INFERENCE_RETRIES,
        timeoutMs,
        backoffMs: BOB_INFERENCE_BACKOFF_MS,
      },
    )
  }

  const text = await res.text()
  if (!res.ok) throw new Error(`Bob inference HTTP ${res.status}: ${text.slice(0, 300)}`)

  let data: any
  try { data = JSON.parse(text) } catch { throw new Error(`Bob returned non-JSON: ${text.slice(0, 200)}`) }

  // Unwrap RunPod /runsync envelope: { status, output: { ... } }
  const output = data?.output ?? data
  if (output?.success === false) throw new Error(`Bob worker error: ${output?.error ?? 'unknown'}`)

  const responseText = output?.response || output?.message || output?.content || ''
  if (!responseText) throw new Error('Bob returned empty response')

  return {
    response: responseText,
    model: output?.model ?? 'ollama',
    provider: output?.provider ?? 'ollama',
  }
}

/**
 * Call Bob AI for structured assessment (smoke, biosecurity, noise, ptt, etc.)
 */
export async function bobAssess(options: BobAssessOptions): Promise<BobAssessResult> {
  const { inferenceUrl, apiKey } = getInferenceConfig()
  const timeoutMs = options.timeoutMs ?? 130_000

  let res: Response

  if (isRunpodServerless(inferenceUrl)) {
    res = await fetchWithRetry(
      `${inferenceUrl}/runsync`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          executionTimeout: 120000,
          input: {
            action: 'assess',
            type: options.type,
            symptom: options.symptom,
            description: options.description,
            image_description: options.imageDescription,
            context: options.context,
            model: options.model,
          },
        }),
      },
      {
        retries: BOB_INFERENCE_RETRIES,
        timeoutMs,
        backoffMs: BOB_INFERENCE_BACKOFF_MS,
      },
    )
  } else {
    res = await fetchWithRetry(
      `${inferenceUrl}/assess/${options.type}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey
            ? {
                'x-inference-api-key': apiKey,
                'Authorization': `Bearer ${apiKey}`,
              }
            : {}),
        },
        body: JSON.stringify({
          symptom: options.symptom,
          description: options.description,
          context: options.context,
        }),
      },
      {
        retries: BOB_INFERENCE_RETRIES,
        timeoutMs,
        backoffMs: BOB_INFERENCE_BACKOFF_MS,
      },
    )
  }

  const text = await res.text()
  if (!res.ok) throw new Error(`Bob assess HTTP ${res.status}: ${text.slice(0, 300)}`)

  let data: any
  try { data = JSON.parse(text) } catch { throw new Error(`Bob returned non-JSON: ${text.slice(0, 200)}`) }

  const output = data?.output ?? data
  if (output?.success === false) throw new Error(`Bob worker error: ${output?.error ?? 'unknown'}`)

  return {
    assessment: output?.assessment ?? output,
    rawResponse: output?.raw_response ?? text,
    model: output?.model ?? 'ollama',
    provider: output?.provider ?? 'ollama',
  }
}

/**
 * Translate text via Bob/Ollama on RunPod.
 */
export async function bobTranslate(options: BobTranslateOptions): Promise<{ translation: string; model: string }> {
  const { inferenceUrl, apiKey } = getInferenceConfig()
  const timeoutMs = options.timeoutMs ?? 60_000

  let res: Response

  if (isRunpodServerless(inferenceUrl)) {
    res = await fetchWithRetry(
      `${inferenceUrl}/runsync`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          executionTimeout: 120000,
          input: {
            action: 'translate',
            text: options.text,
            target_language: options.targetLanguage,
            source_language: options.sourceLanguage,
          },
        }),
      },
      {
        retries: BOB_INFERENCE_RETRIES,
        timeoutMs,
        backoffMs: BOB_INFERENCE_BACKOFF_MS,
      },
    )
  } else {
    res = await fetchWithRetry(
      `${inferenceUrl}/translate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey
            ? {
                'x-inference-api-key': apiKey,
                'Authorization': `Bearer ${apiKey}`,
              }
            : {}),
        },
        body: JSON.stringify({ text: options.text, target_language: options.targetLanguage }),
      },
      {
        retries: BOB_INFERENCE_RETRIES,
        timeoutMs,
        backoffMs: BOB_INFERENCE_BACKOFF_MS,
      },
    )
  }

  const text = await res.text()
  if (!res.ok) throw new Error(`Bob translate HTTP ${res.status}: ${text.slice(0, 300)}`)

  let data: any
  try { data = JSON.parse(text) } catch { throw new Error(`Bob returned non-JSON: ${text.slice(0, 200)}`) }

  const output = data?.output ?? data
  const translation = output?.translation || output?.translated_text || ''
  if (!translation) throw new Error('Bob translate returned empty result')

  return { translation, model: output?.model ?? 'ollama' }
}
