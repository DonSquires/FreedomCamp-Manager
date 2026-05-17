/**
 * translate-text — B-28 Real-time Translation
 *
 * Translates a text snippet into the requested target language.
 * Supports: en, mi (Māori), zh (Mandarin), hi (Hindi), ko (Korean).
 *
 * When AZURE_TRANSLATOR_KEY and AZURE_TRANSLATOR_REGION are configured,
 * the function calls the Azure Cognitive Services Translator REST API.
 * When keys are absent it returns a mock response so the UI can render
 * the translate-button affordance without blocking deployment.
 *
 * POST body (application/json):
 * {
 *   text:        string   — text to translate (max 5 000 chars)
 *   target_lang: string   — BCP-47 language code ("mi" | "zh-Hans" | "hi" | "ko" | "en")
 *   source_lang?: string  — optional source language hint (default: auto-detect)
 * }
 *
 * Response:
 * { translated_text: string, detected_language?: string, provider: string }
 *
 * Required env (optional — function degrades gracefully when absent):
 *   AZURE_TRANSLATOR_KEY
 *   AZURE_TRANSLATOR_REGION
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 */

import { corsHeaders } from '../_shared/cors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

const AZURE_ENDPOINT = 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0'

// Supported BCP-47 language codes
const SUPPORTED_TARGETS = new Set(['en', 'mi', 'zh-Hans', 'hi', 'ko', 'fr', 'de', 'es', 'ja'])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authResult = await requireAuth(req)
    if (!authResult.user) {
      return new Response(JSON.stringify({ error: authResult.error ?? 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const { text, target_lang, source_lang } = body as {
      text?: string
      target_lang?: string
      source_lang?: string
    }

    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'text is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!target_lang || !SUPPORTED_TARGETS.has(target_lang)) {
      return new Response(JSON.stringify({ error: `target_lang must be one of: ${[...SUPPORTED_TARGETS].join(', ')}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const truncatedText = text.slice(0, 5000)

    const azureKey = Deno.env.get('AZURE_TRANSLATOR_KEY')
    const azureRegion = Deno.env.get('AZURE_TRANSLATOR_REGION')

    // --- Live translation via Azure Cognitive Services ---
    if (azureKey && azureRegion) {
      const params = new URLSearchParams({ 'api-version': '3.0', to: target_lang })
      if (source_lang) params.set('from', source_lang)

      const azureRes = await fetch(`${AZURE_ENDPOINT.split('?')[0]}?${params.toString()}`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureKey,
          'Ocp-Apim-Subscription-Region': azureRegion,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{ text: truncatedText }]),
      })

      if (!azureRes.ok) {
        const errBody = await azureRes.text()
        console.error('Azure translator error:', azureRes.status, errBody)
        return new Response(JSON.stringify({ error: 'Translation service error', detail: errBody }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const azureData = await azureRes.json() as Array<{
        translations: Array<{ text: string; to: string }>
        detectedLanguage?: { language: string; score: number }
      }>

      const translated_text = azureData[0]?.translations[0]?.text ?? truncatedText
      const detected_language = azureData[0]?.detectedLanguage?.language

      return new Response(JSON.stringify({ translated_text, detected_language, provider: 'azure' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // --- Degraded mode: return mock response ---
    const mockTranslations: Record<string, string> = {
      'mi':      `[Māori] ${truncatedText}`,
      'zh-Hans': `[中文] ${truncatedText}`,
      'hi':      `[हिन्दी] ${truncatedText}`,
      'ko':      `[한국어] ${truncatedText}`,
      'en':      truncatedText,
    }
    const translated_text = mockTranslations[target_lang] ?? `[${target_lang}] ${truncatedText}`

    return new Response(JSON.stringify({ translated_text, provider: 'mock' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('translate-text error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
