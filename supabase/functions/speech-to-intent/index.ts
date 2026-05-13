/**
 * speech-to-intent
 *
 * Supabase edge shim for the self-hosted speech stack.
 *
 * Responsibilities:
 *   1. Authenticate the caller via Supabase JWT
 *   2. Attach user_id from session
 *   3. Forward to hPanel speech-router (SPEECH_ROUTER_URL)
 *   4. Persist an audit event to `speech_audit_events`
 *   5. Return the speech-router response to the client
 *
 * Required secrets (Supabase):
 *   SPEECH_ROUTER_URL   — base URL of hPanel speech-router (no trailing slash)
 *   SPEECH_ROUTER_KEY   — ROUTER_API_KEY set on the speech-router service
 *
 * Optional secrets:
 *   SPEECH_ROUTER_TIMEOUT_MS — default 45000
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'
import { bobChat } from '../_shared/bobInfer.ts'

const SPEECH_ROUTER_URL = (Deno.env.get('SPEECH_ROUTER_URL') ?? '').trim().replace(/\/+$/, '')
const SPEECH_ROUTER_FALLBACK_URL = (Deno.env.get('SPEECH_ROUTER_FALLBACK_URL') ?? '').trim().replace(/\/+$/, '')
const SPEECH_ROUTER_KEY = (Deno.env.get('SPEECH_ROUTER_KEY') ?? '').trim()
const TIMEOUT_MS = parseInt(Deno.env.get('SPEECH_ROUTER_TIMEOUT_MS') ?? '45000', 10)
const BACKUP_STT_URL = (Deno.env.get('TRANSCRIPTION_SERVICE_URL') || Deno.env.get('RAILWAY_STT_URL') || '').trim().replace(/\/+$/, '')
const BACKUP_STT_KEY = (Deno.env.get('INFERENCE_API_KEY') || Deno.env.get('BOB_INFERENCE_API_KEY') || '').trim()

function buildSpeechRouterPool(): string[] {
  const urls = [SPEECH_ROUTER_URL]
  if (SPEECH_ROUTER_FALLBACK_URL && SPEECH_ROUTER_FALLBACK_URL !== SPEECH_ROUTER_URL) {
    urls.push(SPEECH_ROUTER_FALLBACK_URL)
  }
  return urls.filter(Boolean)
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

function buildServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )
}

async function persistAuditEvent(
  supabase: ReturnType<typeof buildServiceClient>,
  fields: {
    user_id: string
    org_id: string | null
    transcript: string
    intent_name: string | null
    confidence: number | null
    needs_confirmation: boolean
    provider_stt: string
    provider_intent: string
    redacted: boolean
    error_message: string | null
  },
): Promise<void> {
  try {
    await supabase.from('speech_audit_events').insert({
      ...fields,
      created_at: new Date().toISOString(),
    })
  } catch {
    // Non-fatal — audit failure must not block the user response
  }
}

Deno.serve(withCors(async (req: Request) => {
  // 1. Authenticate
  const authResult = await requireAuth(req)
  if (!authResult.user) {
    return errorResponse(authResult.error ?? 'Unauthorized', req, 401)
  }
  const userId = authResult.user.id

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', req, 405)
  }

  const routerUrls = buildSpeechRouterPool()
  if (!routerUrls.length) {
    return errorResponse('SPEECH_ROUTER_URL is not configured', req, 503)
  }

  // 2. Parse body
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return errorResponse('Invalid JSON body', req, 400)
  }

  if (!body.audio_base64 || typeof body.audio_base64 !== 'string') {
    return errorResponse('audio_base64 is required', req, 400)
  }

  // 3. Forward to speech-router (user-scoped only; no org restrictions)
  const orgId = typeof body.org_id === 'string' && body.org_id.trim().length > 0
    ? body.org_id.trim()
    : null
  const routerPayload = {
    audio_base64: body.audio_base64,
    language: typeof body.language === 'string' ? body.language : 'en',
    wake_phrase: typeof body.wake_phrase === 'string' ? body.wake_phrase : null,
    org_id: orgId,
    user_id: userId,
    context: typeof body.context === 'object' && body.context !== null ? body.context : {},
  }

  const supabase = buildServiceClient()
  let lastErrorMessage: string | null = null

  try {
    for (const routerUrl of routerUrls) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        const routerRes = await fetch(`${routerUrl}/v1/speech-to-intent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(SPEECH_ROUTER_KEY ? { Authorization: `Bearer ${SPEECH_ROUTER_KEY}` } : {}),
          },
          body: JSON.stringify(routerPayload),
          signal: controller.signal,
        })
        clearTimeout(timeout)

        const routerBody = await routerRes.json().catch(() => ({})) as Record<string, unknown>
        if (!routerRes.ok) {
          lastErrorMessage = (routerBody.detail as string) ?? `speech-router HTTP ${routerRes.status}`
          continue
        }

        // 5. Persist audit event
        const intent = routerBody.intent as Record<string, unknown> | undefined
        const provider = routerBody.provider as Record<string, string> | undefined
        await persistAuditEvent(supabase, {
          user_id: userId,
          org_id: orgId,
          transcript: typeof routerBody.transcript === 'string' ? routerBody.transcript : '',
          intent_name: typeof intent?.intent === 'string' ? intent.intent : null,
          confidence: typeof intent?.confidence === 'number' ? intent.confidence : null,
          needs_confirmation: intent?.needs_confirmation === true,
          provider_stt: provider?.stt ?? 'unknown',
          provider_intent: provider?.intent ?? 'unknown',
          redacted: false,
          error_message: null,
        })

        return jsonResponse(routerBody, req)
      } catch (routerErr: unknown) {
        clearTimeout(timeout)
        const msg = routerErr instanceof Error ? routerErr.message : String(routerErr)
        lastErrorMessage = msg
        continue
      }
    }

    if (BACKUP_STT_URL) {
      try {
        const directUrl = /\/transcribe\/?$/i.test(BACKUP_STT_URL) ? BACKUP_STT_URL : `${BACKUP_STT_URL}/transcribe`
        const backupSttRes = await fetch(directUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(BACKUP_STT_KEY ? { Authorization: `Bearer ${BACKUP_STT_KEY}` } : {}),
          },
          body: JSON.stringify({
            audio_base64: body.audio_base64,
            language: typeof body.language === 'string' ? body.language : 'en',
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })

        if (backupSttRes.ok) {
          const sttBody = await backupSttRes.json().catch(() => ({})) as Record<string, unknown>
          const transcript = String(sttBody.transcript ?? sttBody.text ?? '').trim()

          if (transcript) {
            const intentPrompt = [
              'Classify the transcript into a patrol intent.',
              'Return strict JSON only: {"intent":"...","confidence":0.0,"needs_confirmation":false}.',
              `Transcript: ${transcript}`,
            ].join('\n')

            const intentReply = await bobChat({ message: intentPrompt, temperature: 0, timeoutMs: 25_000 })
            const parsed = parseJsonObject(intentReply.response) ?? {}

            const backupResponse = {
              transcript,
              intent: {
                intent: typeof parsed.intent === 'string' ? parsed.intent : 'unknown',
                confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
                needs_confirmation: parsed.needs_confirmation === true,
              },
              provider: {
                stt: 'backup_stt',
                intent: intentReply.provider || 'ollama',
              },
              warning: 'primary speech-router unavailable; backup pipeline used',
            }

            await persistAuditEvent(supabase, {
              user_id: userId,
              org_id: orgId,
              transcript,
              intent_name: backupResponse.intent.intent,
              confidence: backupResponse.intent.confidence,
              needs_confirmation: backupResponse.intent.needs_confirmation,
              provider_stt: 'backup_stt',
              provider_intent: intentReply.provider || 'ollama',
              redacted: false,
              error_message: lastErrorMessage ?? 'Speech router unavailable; backup pipeline used',
            })

            return jsonResponse(backupResponse, req)
          }
        }
      } catch {
        // Continue to hard failure after backup attempt.
      }
    }

    await persistAuditEvent(supabase, {
      user_id: userId,
      org_id: orgId,
      transcript: '',
      intent_name: null,
      confidence: null,
      needs_confirmation: true,
      provider_stt: '',
      provider_intent: '',
      redacted: false,
      error_message: lastErrorMessage ?? 'Speech router error',
    })

    return errorResponse(lastErrorMessage ?? 'Speech router unavailable', req, 502)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'

    await persistAuditEvent(supabase, {
      user_id: userId,
      org_id: orgId,
      transcript: '',
      intent_name: null,
      confidence: null,
      needs_confirmation: true,
      provider_stt: '',
      provider_intent: '',
      redacted: false,
      error_message: msg,
    })

    return errorResponse(
      `Speech router error: ${msg}`,
      req,
      502,
    )
  }
}))
