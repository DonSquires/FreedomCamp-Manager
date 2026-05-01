/**
 * PTT Bridge Service — Audio Translation Pipeline
 *
 * Orchestrates real-time translation of PTT (Push-to-Talk) audio streams:
 * 1. ASR (Automatic Speech Recognition): Whisper v3 for transcription
 * 2. MT (Machine Translation): Seamless or GPT-4o for language translation
 * 3. TTS (Text-to-Speech): Piper for synthesis of translated text back to audio
 *
 * Exposes:
 * - /health: Service status
 * - /translate-audio: Full pipeline (audio → transcription → translation → synthesis)
 * - /transcribe-only: ASR only (audio → text)
 * - /translate-text: MT only (text → translated text)
 * - /synthesize-only: TTS only (text → audio)
 *
 * Configuration:
 * Required secrets:
 *   OLLAMA_PTT_BASE_URL   Base URL for Ollama models (e.g. http://ollama:11434)
 *   BOB_SERVICE_URL       Optional RunPod Bob service for backup translation
 *
 * Optional:
 *   PORT                  Server port (default 8273)
 *   LOG_LEVEL             Logging verbosity (debug|info|warn|error)
 *   ENABLE_CACHING        Cache translation results (default true)
 *   MAX_AUDIO_SIZE_MB     Max audio file size in MB (default 50)
 */

import express from 'express'
import multer from 'multer'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─────────────────────────────────────────────────────────────────────────
// CONFIG & ENV
// ─────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT || '8273')
const OLLAMA_PTT_BASE_URL = String(process.env.OLLAMA_PTT_BASE_URL || '').trim().replace(/\/$/, '')
const BOB_SERVICE_URL = String(process.env.BOB_SERVICE_URL || '').trim().replace(/\/$/, '')
const BOB_API_KEY = String(process.env.BOB_API_KEY || '').trim()
const LOG_LEVEL = String(process.env.LOG_LEVEL || 'info').toLowerCase()
const ENABLE_CACHING = process.env.ENABLE_CACHING !== 'false'
const MAX_AUDIO_SIZE_MB = Number(process.env.MAX_AUDIO_SIZE_MB || '50')

// Model names (overridable per environment)
const WHISPER_MODEL = process.env.WHISPER_MODEL || 'whisper-small'
const SEAMLESS_MODEL = process.env.SEAMLESS_MODEL || 'seamless-smoll'
const PIPER_VOICE = process.env.PIPER_VOICE || 'en_NZ-fiona-medium'

// In-memory cache for translation mappings (language pairs → translated text)
const translationCache = new Map()

// Logger utility
const logger = {
  debug: (msg, data) => {
    if (['debug'].includes(LOG_LEVEL)) {
      console.log(`[DEBUG] ${msg}`, data ?? '')
    }
  },
  info: (msg, data) => {
    if (['debug', 'info'].includes(LOG_LEVEL)) {
      console.log(`[INFO] ${msg}`, data ?? '')
    }
  },
  warn: (msg, data) => {
    console.warn(`[WARN] ${msg}`, data ?? '')
  },
  error: (msg, err) => {
    console.error(`[ERROR] ${msg}`, err?.message ?? err ?? '')
  },
}

// ─────────────────────────────────────────────────────────────────────────
// UTILITY: Health & Readiness
// ─────────────────────────────────────────────────────────────────────────

async function checkInferenceHealth() {
  const health = {
    ollama_online: false,
    whisper_available: false,
    seamless_available: false,
    piper_available: false,
    bob_online: undefined,
  }

  // Check Ollama health
  if (OLLAMA_PTT_BASE_URL) {
    try {
      const res = await axios.get(`${OLLAMA_PTT_BASE_URL}/api/tags`, { timeout: 3000 })
      health.ollama_online = res.status === 200

      const models = res.data?.models || []
      const modelNames = models.map((m) => m.name || '')

      health.whisper_available = modelNames.some((name) => name.includes('whisper'))
      health.seamless_available = modelNames.some((name) => name.includes('seamless'))
      health.piper_available = modelNames.some((name) => name.includes('piper'))

      logger.debug('Ollama health check', {
        available_models: modelNames.slice(0, 5),
        total: models.length,
      })
    } catch (err) {
      logger.error('Ollama health check failed', err)
    }
  }

  // Check Bob backup service health
  if (BOB_SERVICE_URL) {
    try {
      const res = await axios.get(`${BOB_SERVICE_URL}/health`, { timeout: 3000 })
      health.bob_online = res.status === 200
    } catch (err) {
      logger.debug('Bob service health check failed (non-critical)', err?.message)
      health.bob_online = false
    }
  }

  return health
}

// ─────────────────────────────────────────────────────────────────────────
// STEP 1: TRANSCRIBE (Whisper ASR)
// ─────────────────────────────────────────────────────────────────────────

async function transcribeAudio(audioBase64, audioMimeType, sourceLang = 'en') {
  if (!OLLAMA_PTT_BASE_URL) {
    throw new Error('OLLAMA_PTT_BASE_URL is not configured for transcription')
  }

  try {
    const payload = {
      model: WHISPER_MODEL,
      audio_base64: audioBase64,
      audio_mime: audioMimeType,
      language: sourceLang,
      temperature: 0,
    }

    logger.debug('Calling Whisper transcriber', { model: WHISPER_MODEL, language: sourceLang })

    const res = await axios.post(`${OLLAMA_PTT_BASE_URL}/api/transcribe`, payload, {
      timeout: 60_000,
    })

    const transcript = res.data?.transcript || ''
    const language = res.data?.language || sourceLang

    logger.info('Transcription complete', { length: transcript.length, language })

    return {
      transcript,
      language,
      confidence: res.data?.confidence,
    }
  } catch (err) {
    logger.error('Whisper transcription failed', err)
    throw new Error(`Transcription failed: ${err?.message || String(err)}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// STEP 2: TRANSLATE (Seamless / GPT-4o)
// ─────────────────────────────────────────────────────────────────────────

async function translateText(text, sourceLang, targetLang) {
  // Check cache first
  const cacheKey = `${sourceLang}→${targetLang}:${text.substring(0, 50)}`
  if (ENABLE_CACHING && translationCache.has(cacheKey)) {
    logger.debug('Cache hit for translation', { cacheKey })
    const cachedValue = translationCache.get(cacheKey)
    return {
      translated_text: cachedValue,
      source_lang: sourceLang,
      target_lang: targetLang,
    }
  }

  // Try Ollama Seamless first
  if (OLLAMA_PTT_BASE_URL) {
    try {
      const payload = {
        model: SEAMLESS_MODEL,
        text,
        source_lang: sourceLang,
        target_lang: targetLang,
        temperature: 0.1,
      }

      logger.debug('Calling Seamless translator', {
        model: SEAMLESS_MODEL,
        source: sourceLang,
        target: targetLang,
      })

      const res = await axios.post(`${OLLAMA_PTT_BASE_URL}/api/translate`, payload, {
        timeout: 30_000,
      })

      const translatedText = res.data?.translated_text || text

      // Cache for future use
      if (ENABLE_CACHING) {
        translationCache.set(cacheKey, translatedText)
      }

      logger.info('Translation complete', { source: sourceLang, target: targetLang })

      return {
        translated_text: translatedText,
        source_lang: sourceLang,
        target_lang: targetLang,
      }
    } catch (err) {
      logger.warn('Seamless translation failed (trying Bob)', err?.message)
    }
  }

  // Fallback to Bob service if available
  if (BOB_SERVICE_URL && BOB_API_KEY) {
    try {
      const payload = {
        text,
        source_lang: sourceLang,
        target_lang: targetLang,
      }

      const res = await axios.post(`${BOB_SERVICE_URL}/translate`, payload, {
        headers: {
          'Authorization': `Bearer ${BOB_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 20_000,
      })

      const translatedText = res.data?.translated_text || res.data?.text || text

      if (ENABLE_CACHING) {
        translationCache.set(cacheKey, translatedText)
      }

      logger.info('Translation complete via Bob backup', { source: sourceLang, target: targetLang })

      return {
        translated_text: translatedText,
        source_lang: sourceLang,
        target_lang: targetLang,
      }
    } catch (err) {
      logger.error('Bob translation backup failed', err)
    }
  }

  // Last resort: return original text with warning
  logger.warn('Translation unavailable, returning original text', { source: sourceLang, target: targetLang })
  return {
    translated_text: text,
    source_lang: sourceLang,
    target_lang: targetLang,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// STEP 3: SYNTHESIZE (Piper TTS)
// ─────────────────────────────────────────────────────────────────────────

async function synthesizeAudio(text, targetLang) {
  if (!OLLAMA_PTT_BASE_URL) {
    throw new Error('OLLAMA_PTT_BASE_URL is not configured for synthesis')
  }

  try {
    const voice = PIPER_VOICE.includes(targetLang) ? PIPER_VOICE : `${targetLang}-default`

    const payload = {
      model: 'piper',
      text,
      voice,
      language: targetLang,
      format: 'wav',
    }

    logger.debug('Calling Piper synthesizer', { voice, language: targetLang })

    const res = await axios.post(`${OLLAMA_PTT_BASE_URL}/api/synthesize`, payload, {
      timeout: 30_000,
    })

    const audioBase64 = res.data?.audio_base64 || res.data?.audio || ''
    if (!audioBase64) {
      throw new Error('No audio produced by synthesis')
    }

    logger.info('Synthesis complete', { voice, format: 'wav' })

    return {
      audio_base64: audioBase64,
      audio_mime_type: 'audio/wav',
      format: 'wav',
    }
  } catch (err) {
    logger.error('Piper synthesis failed', err)
    throw new Error(`Synthesis failed: ${err?.message || String(err)}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// FULL PIPELINE: translate-audio
// ─────────────────────────────────────────────────────────────────────────

async function fullTranslationPipeline(audioBase64, audioMimeType, sourceLang, targetLang) {
  const pipelineId = uuidv4()
  const startTime = Date.now()

  logger.info('Starting translation pipeline', {
    pipelineId,
    source_lang: sourceLang,
    target_lang: targetLang,
    audio_size_bytes: audioBase64.length,
  })

  try {
    // Step 1: Transcribe
    const transcribeStart = Date.now()
    const transcription = await transcribeAudio(audioBase64, audioMimeType, sourceLang)
    const transcribe_ms = Date.now() - transcribeStart

    logger.debug('Step 1 complete: transcription', {
      pipelineId,
      transcript_length: transcription.transcript.length,
      time_ms: transcribe_ms,
    })

    // Step 2: Translate
    const translateStart = Date.now()
    const translation = await translateText(transcription.transcript, sourceLang, targetLang)
    const translate_ms = Date.now() - translateStart

    logger.debug('Step 2 complete: translation', {
      pipelineId,
      translated_length: translation.translated_text.length,
      time_ms: translate_ms,
    })

    // Step 3: Synthesize
    const synthesizeStart = Date.now()
    const synthesis = await synthesizeAudio(translation.translated_text, targetLang)
    const synthesize_ms = Date.now() - synthesizeStart

    logger.debug('Step 3 complete: synthesis', {
      pipelineId,
      audio_size_bytes: synthesis.audio_base64.length,
      time_ms: synthesize_ms,
    })

    const total_ms = Date.now() - startTime

    logger.info('Pipeline complete', {
      pipelineId,
      total_ms,
      breakdown: { transcribe_ms, translate_ms, synthesize_ms },
    })

    return {
      original_transcript: transcription.transcript,
      translated_text: translation.translated_text,
      synthesized_audio_base64: synthesis.audio_base64,
      audio_mime_type: synthesis.audio_mime_type,
      pipeline_id: pipelineId,
      timing: {
        transcribe_ms,
        translate_ms,
        synthesize_ms,
        total_ms,
      },
    }
  } catch (err) {
    logger.error('Pipeline failed', { pipelineId, error: err?.message })
    throw err
  }
}

// ─────────────────────────────────────────────────────────────────────────
// EXPRESS SERVER
// ─────────────────────────────────────────────────────────────────────────

const app = express()
app.use(express.json({ limit: '100mb' }))

// Setup multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_AUDIO_SIZE_MB * 1024 * 1024,
  },
})

// ─────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /health
 * Returns service readiness and model availability
 */
app.get('/health', async (req, res) => {
  try {
    const health = await checkInferenceHealth()
    const ready = health.ollama_online && (health.whisper_available || health.seamless_available)

    res.json({
      status: ready ? 'ready' : 'degraded',
      timestamp: new Date().toISOString(),
      ...health,
    })
  } catch (err) {
    res.status(503).json({
      status: 'error',
      error: err?.message || String(err),
    })
  }
})

/**
 * POST /translate-audio
 * Full pipeline: audio → transcript → translation → synthesized audio
 *
 * Request body:
 *   {
 *     "audio_base64": "...",              // base64-encoded audio
 *     "audio_mime_type": "audio/wav",     // or audio/webm, audio/mp3
 *     "source_lang": "en",                // BCP-47 language code
 *     "target_lang": "mi"                 // BCP-47 language code
 *   }
 */
app.post('/translate-audio', async (req, res) => {
  try {
    const { audio_base64, audio_mime_type, source_lang, target_lang } = req.body

    if (!audio_base64) {
      return res.status(400).json({ error: 'audio_base64 is required' })
    }

    if (!source_lang || !target_lang) {
      return res.status(400).json({ error: 'source_lang and target_lang are required' })
    }

    const mimeType = audio_mime_type || 'audio/wav'

    const result = await fullTranslationPipeline(
      audio_base64,
      mimeType,
      source_lang,
      target_lang,
    )

    res.json(result)
  } catch (err) {
    logger.error('POST /translate-audio failed', err)
    res.status(500).json({
      error: 'Translation pipeline failed',
      message: err?.message || String(err),
    })
  }
})

/**
 * POST /transcribe-only
 * ASR only: audio → transcript
 */
app.post('/transcribe-only', async (req, res) => {
  try {
    const { audio_base64, audio_mime_type, source_lang } = req.body

    if (!audio_base64) {
      return res.status(400).json({ error: 'audio_base64 is required' })
    }

    const result = await transcribeAudio(
      audio_base64,
      audio_mime_type || 'audio/wav',
      source_lang || 'en',
    )

    res.json(result)
  } catch (err) {
    logger.error('POST /transcribe-only failed', err)
    res.status(500).json({
      error: 'Transcription failed',
      message: err?.message || String(err),
    })
  }
})

/**
 * POST /translate-text
 * MT only: text → translated text
 */
app.post('/translate-text', async (req, res) => {
  try {
    const { text, source_lang, target_lang } = req.body

    if (!text) {
      return res.status(400).json({ error: 'text is required' })
    }

    if (!source_lang || !target_lang) {
      return res.status(400).json({ error: 'source_lang and target_lang are required' })
    }

    const result = await translateText(text, source_lang, target_lang)

    res.json(result)
  } catch (err) {
    logger.error('POST /translate-text failed', err)
    res.status(500).json({
      error: 'Translation failed',
      message: err?.message || String(err),
    })
  }
})

/**
 * POST /synthesize-only
 * TTS only: text → audio
 */
app.post('/synthesize-only', async (req, res) => {
  try {
    const { text, target_lang } = req.body

    if (!text) {
      return res.status(400).json({ error: 'text is required' })
    }

    const result = await synthesizeAudio(text, target_lang || 'en')

    res.json(result)
  } catch (err) {
    logger.error('POST /synthesize-only failed', err)
    res.status(500).json({
      error: 'Synthesis failed',
      message: err?.message || String(err),
    })
  }
})

/**
 * GET /config
 * Returns current service configuration (for admin/debugging)
 */
app.get('/config', (req, res) => {
  res.json({
    port: PORT,
    ollama_ptt_base_url: OLLAMA_PTT_BASE_URL || '(not configured)',
    bob_service_url: BOB_SERVICE_URL || '(not configured)',
    models: {
      whisper: WHISPER_MODEL,
      seamless: SEAMLESS_MODEL,
      piper_voice: PIPER_VOICE,
    },
    features: {
      caching_enabled: ENABLE_CACHING,
      max_audio_size_mb: MAX_AUDIO_SIZE_MB,
    },
    log_level: LOG_LEVEL,
    timestamp: new Date().toISOString(),
  })
})

// Catch-all 404
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
    method: req.method,
    available_endpoints: [
      'GET /health',
      'GET /config',
      'POST /translate-audio',
      'POST /transcribe-only',
      'POST /translate-text',
      'POST /synthesize-only',
    ],
  })
})

// ─────────────────────────────────────────────────────────────────────────
// ERROR HANDLER
// ─────────────────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  logger.error('Express error handler', err)
  res.status(500).json({
    error: 'Internal server error',
    message: err?.message || String(err),
  })
})

// ─────────────────────────────────────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info(`PTT Bridge service started`, {
    port: PORT,
    ollama_configured: !!OLLAMA_PTT_BASE_URL,
    bob_configured: !!BOB_SERVICE_URL,
  })
})
