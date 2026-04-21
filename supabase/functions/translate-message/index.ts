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

import { fetchWithRetry } from '../_shared/fetchWithRetry.ts'
import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'

const LANGUAGE_NAMES: Record<string, string> = {
  'en-NZ': 'New Zealand English',
  'en-AU': 'Australian English',
  'en-GB': 'British English',
  'en-US': 'American English',
  'hi-IN': 'Hindi',
  'zh-CN': 'Simplified Chinese (Mandarin)',
  'zh-TW': 'Traditional Chinese',
  'pa-IN': 'Punjabi',
  'tl-PH': 'Filipino (Tagalog)',
  'mi-NZ': 'Te Reo Māori',
  'ko-KR': 'Korean',
  'ja-JP': 'Japanese',
  'es-ES': 'Spanish',
  'fr-FR': 'French',
  'de-DE': 'German',
  'ar-SA': 'Arabic',
  'pt-BR': 'Brazilian Portuguese',
  'ru-RU': 'Russian',
  'th-TH': 'Thai',
  'vi-VN': 'Vietnamese',
  'ms-MY': 'Malay',
  'id-ID': 'Indonesian',
  'ur-PK': 'Urdu',
  'bn-BD': 'Bengali',
  'sw-KE': 'Swahili',
  'tl': 'Filipino (Tagalog)',
  'mi': 'Te Reo Māori',
}

function resolveLangName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code
}

Deno.serve(withCors(async (req: Request) => {
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

  const inferenceUrl = Deno.env.get('INFERENCE_SERVICE_URL')
  const inferenceKey = Deno.env.get('INFERENCE_API_KEY')

  if (!inferenceUrl) {
    return errorResponse('Inference service not configured (INFERENCE_SERVICE_URL missing)', req, 503)
  }

  const targetName = resolveLangName(target_language)
  const sourceName = source_language ? resolveLangName(source_language) : null

  const systemPrompt =
    `You are a professional real-time translator for a field operations security platform. ` +
    `Your task is to translate the provided text into ${targetName}. ` +
    `Output ONLY the translated text with no explanations, commentary, or labels. ` +
    `Preserve the original tone and meaning as closely as possible. ` +
    `If the text is already in ${targetName}, return it unchanged.`

  const userPrompt = sourceName
    ? `Translate from ${sourceName} to ${targetName}:\n\n${text}`
    : `Translate to ${targetName}:\n\n${text}`

  let response: Response
  try {
    response = await fetchWithRetry(`${inferenceUrl}/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(inferenceKey ? { Authorization: `Bearer ${inferenceKey}` } : {}),
      },
      body: JSON.stringify({
        text,
        target_language,
        source_language: source_language ?? null,
      }),
    }, {
      retries: 2,
      timeoutMs: 15_000,
      backoffMs: 500,
    })
  } catch (fetchErr: any) {
    console.error('translate-message: inference fetch failed', fetchErr)
    return errorResponse('Translation service unreachable', req, 502)
  }

  if (!response.ok && response.status !== 404) {
    const errText = await response.text().catch(() => '')
    console.error('translate-message: inference service error', response.status, errText)
    return errorResponse(`Translation service returned ${response.status}`, req, 502)
  }

  if (response.status === 404) {
    try {
      response = await fetchWithRetry(`${inferenceUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(inferenceKey ? { Authorization: `Bearer ${inferenceKey}` } : {}),
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      }, {
        retries: 1,
        timeoutMs: 15_000,
        backoffMs: 500,
      })
    } catch (fallbackErr: any) {
      console.error('translate-message: fallback chat fetch failed', fallbackErr)
      return errorResponse('Translation service unreachable', req, 502)
    }

    // If /chat also returns 404 (e.g. RunPod endpoint), try RunPod /runsync format
    if (response.status === 404 && inferenceUrl.includes('runpod.ai')) {
      try {
        response = await fetchWithRetry(`${inferenceUrl}/runsync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(inferenceKey ? { Authorization: `Bearer ${inferenceKey}` } : {}),
          },
          body: JSON.stringify({
            input: {
              action: 'chat',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ],
              stream: false,
            },
          }),
        }, {
          retries: 1,
          timeoutMs: 30_000,
          backoffMs: 1_000,
        })
      } catch (runpodErr: any) {
        console.error('translate-message: RunPod runsync fallback failed', runpodErr)
        return errorResponse('Translation service unreachable', req, 502)
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        console.error('translate-message: RunPod fallback error', response.status, errText)
        return errorResponse(`Translation service returned ${response.status}`, req, 502)
      }

      // RunPod wraps output: { output: { response: "..." } }
      let runpodData: any
      try {
        runpodData = await response.json()
      } catch {
        return errorResponse('Translation service returned invalid JSON', req, 502)
      }
      const translated: string =
        runpodData?.output?.response ||
        runpodData?.output?.translated_text ||
        runpodData?.output?.message?.content ||
        runpodData?.output?.choices?.[0]?.message?.content ||
        ''
      if (!translated.trim()) {
        return errorResponse('Empty translation response from inference service', req, 502)
      }
      return jsonResponse({
        translated_text: translated.trim(),
        target_language,
        detected_source: source_language ?? null,
        translation_confidence: 0.65,
        confidence_reason: 'RunPod inference translation path used.',
        provider: 'runpod-chat',
        fallback: true,
      }, req)
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.error('translate-message: fallback chat error', response.status, errText)
      return errorResponse(`Translation service returned ${response.status}`, req, 502)
    }
  }

  let data: any
  try {
    data = await response.json()
  } catch {
    return errorResponse('Translation service returned invalid JSON', req, 502)
  }

  // Normalise response from multiple inference backends
  const translated: string =
    data?.translated_text ||
    data?.response ||
    data?.message?.content ||
    data?.choices?.[0]?.message?.content ||
    ''

  if (!translated.trim()) {
    return errorResponse('Empty translation response from inference service', req, 502)
  }

  return jsonResponse(
    {
      translated_text: translated.trim(),
      target_language,
      detected_source: source_language ?? null,
      translation_confidence: typeof data?.translation_confidence === 'number' ? data.translation_confidence : 0.65,
      confidence_reason: typeof data?.confidence_reason === 'string'
        ? data.confidence_reason
        : response.url.endsWith('/chat')
          ? 'Legacy chat translation path used.'
          : 'Translation metadata unavailable.',
      provider: data?.provider || (response.url.endsWith('/chat') ? 'chat-fallback' : 'unknown'),
      fallback: data?.fallback === true || response.url.endsWith('/chat'),
    },
    req,
  )
}))
