/**
 * translate-message
 *
 * Translates chat messages via the Bob inference service.
 * Used by Team Chat for multi-language support and interpreter mode.
 *
 * POST body:
 *   { text: string, target_language: string, source_language?: string }
 *
 * Response:
 *   { translated_text: string, target_language: string, detected_source?: string }
 *
 * Required env vars:
 *   INFERENCE_SERVICE_URL   Bob inference-service base URL (RunPod)
 *   INFERENCE_API_KEY       Optional bearer key
 */

import { bobTranslate } from '../_shared/bobInfer.ts'
import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

Deno.serve(withCors(async (req: Request) => {
  const authResult = await requireAuth(req)
  if (!authResult.user) {
    return errorResponse(authResult.error ?? 'Unauthorized', req, 401)
  }

  const body = await req.json().catch(() => null)
  if (!body) {
    return errorResponse('Request body must be valid JSON', req, 400)
  }

  const { text, target_language, source_language } = body as {
    text?: string
    target_language?: string
    source_language?: string
  }

  if (!text || !text.trim()) {
    return errorResponse('text is required and must not be empty', req, 400)
  }
  if (!target_language) {
    return errorResponse('target_language is required (e.g. "en-NZ")', req, 400)
  }

  try {
    const result = await bobTranslate({
      text,
      targetLanguage: target_language,
      sourceLanguage: source_language,
      timeoutMs: 30_000,
    })

    const translated = String(result.translation ?? '').trim()
    if (!translated) {
      return errorResponse('Empty translation response from inference service', req, 502)
    }

    return jsonResponse(
      {
        translated_text: translated,
        target_language,
        detected_source: source_language ?? null,
        translation_confidence: 0.8,
        confidence_reason: 'Shared Bob translate helper path used.',
        provider: 'ollama',
        model: result.model,
        fallback: false,
        warning: null,
      },
      req,
    )
  } catch (err: any) {
    console.error('translate-message: shared translate helper failed', err)
    const message = String(err?.message ?? err)
    const unavailable =
      message.includes('not configured') ||
      message.includes('failed for all configured endpoints') ||
      message.includes('HTTP 5') ||
      message.includes('OUTBOUND_HOST_NOT_ALLOWED')
    return errorResponse(unavailable ? 'Translation service unreachable' : message, req, unavailable ? 502 : 500)
  }
}))
