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
 *   BOB_SERVICE_URL         Bob inference-service base URL (RunPod)
 *   INFERENCE_SERVICE_URL   optional fallback Bob URL
 *   INFERENCE_API_KEY       Optional bearer key
 */

import { bobTranslate, bobChat } from '../_shared/bobInfer.ts'
import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'
import { buildBobContext } from '../_shared/bobContext.ts'

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
      context: buildBobContext({
        operation: 'translate-message',
        source: 'shared-translate-helper',
        userId: authResult.user.id,
        organizationId:
          (authResult.user as any)?.user_metadata?.organization_id ||
          (authResult.user as any)?.app_metadata?.organization_id ||
          null,
        context: {
          target_language,
          source_language: source_language ?? null,
          text_length: text.length,
        },
      }),
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
    try {
      // Redundant path: use Bob chat when translate action is unavailable.
      const prompt = [
        `Translate the following text into ${target_language}.`,
        'Return ONLY the translated text with no explanations.',
        source_language ? `Source language hint: ${source_language}.` : '',
        `Text: ${text}`,
      ].filter(Boolean).join('\n')

      const chat = await bobChat({
        message: prompt,
        temperature: 0,
        timeoutMs: 30_000,
        context: buildBobContext({
          operation: 'translate-message',
          source: 'chat-translation-fallback',
          userId: authResult.user.id,
          organizationId:
            (authResult.user as any)?.user_metadata?.organization_id ||
            (authResult.user as any)?.app_metadata?.organization_id ||
            null,
          context: {
            target_language,
            source_language: source_language ?? null,
            text_length: text.length,
          },
        }),
      })

      const translated = String(chat.response ?? '').trim()
      if (!translated) {
        return errorResponse('Empty translation response from fallback chat path', req, 502)
      }

      return jsonResponse(
        {
          translated_text: translated,
          target_language,
          detected_source: source_language ?? null,
          translation_confidence: 0.7,
          confidence_reason: 'Fallback via Bob chat translation prompt.',
          provider: chat.provider,
          model: chat.model,
          fallback: true,
          warning: 'translate action unavailable; used chat fallback',
        },
        req,
      )
    } catch {
      return errorResponse(
        message.includes('OUTBOUND_HOST_NOT_ALLOWED') ? 'Translation host policy blocked request' : 'Translation service unreachable',
        req,
        502,
      )
    }
  }
}))
