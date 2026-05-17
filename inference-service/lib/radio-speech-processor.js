/**
 * radio-speech-processor.js
 *
 * Phase 1 Group D — Radio Speech Pipeline
 *
 * Consumes radio speech lifecycle events forwarded by speech-worker.js and
 * runs the STT/transcript segment pipeline:
 *
 *   1. Receive radio.producer.created event (new speaker transmission)
 *   2. Fetch audio segment from Supabase Storage (populated by recording middleware)
 *      — Phase 2 will stream from the SFU PlainTransport tap; for now it accepts
 *        a storage_path or audio_url in the event payload.
 *   3. Transcribe audio using Whisper-via-Ollama (or heuristic stub when OLLAMA unavailable)
 *   4. Write one or more radio_transcript_segments rows to Supabase as service-role
 *   5. On radio.session.closed: mark final segment and update ended_at on transmission
 *
 * Deliberately not doing file I/O or gRPC — all integration is via HTTPS to
 * Supabase REST and Ollama /api/generate endpoints, matching the existing pattern.
 */

'use strict';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const OLLAMA_BASE_URL = String(process.env.OLLAMA_PTT_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const RAILWAY_STT_BASE_URL = String(
  process.env.FIELDOPS_RAILWAY_STT_URL
  || process.env.RADIO_RAILWAY_STT_URL
  || process.env.WHISPER_SERVICE_URL
  || ''
).replace(/\/+$/, '');
const OLLAMA_GATEWAY_KEY = String(process.env.OLLAMA_GATEWAY_KEY || '');
const WHISPER_MODEL = String(process.env.RADIO_WHISPER_MODEL || process.env.OLLAMA_MODEL || 'qwen2.5:7b');
const PROCESSOR_TIMEOUT_MS = Math.max(5000, parseInt(process.env.RADIO_PROCESSOR_TIMEOUT_MS || '20000', 10));
const PROCESSOR_ENABLED = String(process.env.RADIO_PROCESSOR_ENABLED || 'false').toLowerCase() === 'true';
const AUDIO_FETCH_TIMEOUT_MS = Math.max(3000, parseInt(process.env.RADIO_AUDIO_FETCH_TIMEOUT_MS || '12000', 10));
const AUDIO_MAX_FETCH_BYTES = Math.max(64 * 1024, parseInt(process.env.RADIO_AUDIO_MAX_FETCH_BYTES || String(8 * 1024 * 1024), 10));
const DEFAULT_SEGMENT_DURATION_MS = 800;
const MIN_SEGMENT_DURATION_MS = 250;
const MAX_SEGMENT_TEXT_LENGTH = 120;
const DUB_MODE_ENABLED = String(process.env.RADIO_DUB_MODE_ENABLED || 'true').toLowerCase() === 'true';
const DUB_TARGET_LANGUAGE = String(process.env.RADIO_DUB_TARGET_LANGUAGE || 'en-NZ').trim() || 'en-NZ';
const DUB_PROVIDER = String(process.env.RADIO_DUB_PROVIDER || 'fieldops-dub').trim() || 'fieldops-dub';
const RADIO_INGEST_ENDPOINT_ENABLED = ['1', 'true', 'yes', 'on'].includes(String(process.env.RADIO_TRANSCRIPT_INGEST_ENABLED || 'true').toLowerCase());
const RADIO_INGEST_ENDPOINT_URL = String(
  process.env.RADIO_TRANSCRIPT_INGEST_URL
  || (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/ingest-transcript-segments` : '')
).replace(/\/+$/, '');
const RADIO_INGEST_ENDPOINT_API_KEY = String(process.env.RADIO_TRANSCRIPT_INGEST_API_KEY || SUPABASE_SERVICE_ROLE_KEY || '').trim();
const RADIO_INGEST_TIMEOUT_MS = Math.max(3000, parseInt(process.env.RADIO_TRANSCRIPT_INGEST_TIMEOUT_MS || '10000', 10));

// ─── Supabase REST helpers ────────────────────────────────────────────────────

async function supabaseInsert(table, rows) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('radio-speech-processor: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const body = Array.isArray(rows) ? rows : [rows];
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`supabaseInsert(${table}) failed ${res.status}: ${text}`);
  }
  return res.json();
}

async function supabasePatch(table, id, patch) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('radio-speech-processor: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`supabasePatch(${table}, ${id}) failed ${res.status}: ${text}`);
  }
}

function buildIngestContractPayload({ event, rows, result, processingLatencyMs }) {
  const sourceProvider = event?.provider && typeof event.provider === 'object' ? event.provider : {};
  const normalizedSource = String(event?.source || 'inference-service.radio-speech-processor').trim();

  return {
    orgId: event?.orgId || null,
    channelId: event?.channelId || event?.channel_scope || event?.channelScope || null,
    transmissionId: event?.transmissionId || null,
    source: normalizedSource || 'inference-service.radio-speech-processor',
    provider: {
      name: String(result?.provider || sourceProvider.name || 'unknown').trim() || 'unknown',
      requestId: sourceProvider.requestId || event?.traceId || event?.requestId || null,
      model: sourceProvider.model || null,
      region: sourceProvider.region || null,
      latencyMs: Number.isFinite(Number(sourceProvider.latencyMs)) ? Number(sourceProvider.latencyMs) : processingLatencyMs,
      pipeline: String(sourceProvider.pipeline || 'speech-processor').trim() || 'speech-processor',
    },
    segments: (Array.isArray(rows) ? rows : []).map((row) => ({
      sequenceNum: row.sequence_num,
      segmentStartMs: row.segment_start_ms,
      segmentEndMs: row.segment_end_ms,
      text: row.text,
      language: row.language,
      confidence: row.confidence,
      isFinal: row.is_final,
      source: normalizedSource || 'inference-service.radio-speech-processor',
      provider: result?.provider || sourceProvider.name || 'unknown',
    })),
  };
}

async function emitIngestContractPayload({ event, rows, result, processingLatencyMs }) {
  if (!RADIO_INGEST_ENDPOINT_ENABLED) return { sent: false, reason: 'disabled' };
  if (!RADIO_INGEST_ENDPOINT_URL) return { sent: false, reason: 'missing_url' };
  if (!RADIO_INGEST_ENDPOINT_API_KEY) return { sent: false, reason: 'missing_api_key' };

  const payload = buildIngestContractPayload({ event, rows, result, processingLatencyMs });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), RADIO_INGEST_TIMEOUT_MS);

  try {
    const response = await fetch(RADIO_INGEST_ENDPOINT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: RADIO_INGEST_ENDPOINT_API_KEY,
        Authorization: `Bearer ${RADIO_INGEST_ENDPOINT_API_KEY}`,
        'x-org-id': String(payload.orgId || ''),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => response.statusText);
      throw new Error(`ingest-transcript-segments ${response.status}: ${body}`);
    }

    return { sent: true, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

// ─── STT ─────────────────────────────────────────────────────────────────────

function toBase64AudioFromDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:audio\/[^;]+;base64,(.+)$/i);
  if (!match?.[1]) return null;
  return match[1].trim() || null;
}

function normalizeLanguageTag(value, fallback = 'en') {
  const normalized = String(value || fallback).trim().toLowerCase().replace('_', '-');
  return normalized || fallback;
}

function isEnglishLanguageTag(value) {
  const normalized = normalizeLanguageTag(value, '');
  return normalized === 'en' || normalized.startsWith('en-');
}

async function transcribeWithRailwayStt({ audioData, mimeType = 'audio/webm', task = 'transcribe', language = 'auto' }) {
  if (!RAILWAY_STT_BASE_URL || !audioData) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), PROCESSOR_TIMEOUT_MS);
  try {
    const response = await fetch(`${RAILWAY_STT_BASE_URL}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_base64: audioData,
        mime_type: mimeType,
        task,
        language,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => response.statusText);
      throw new Error(`fieldops-railway-stt ${response.status}: ${body}`);
    }

    const payload = await response.json().catch(() => ({}));
    const text = String(payload?.text || payload?.transcript || '').trim();
    if (!text) return null;

    const confidenceRaw = Number(payload?.confidence ?? payload?.probability ?? payload?.avg_logprob);
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw > 1 ? confidenceRaw / 100 : confidenceRaw))
      : 0.75;

    return {
      text,
      language: normalizeLanguageTag(payload?.language || language || 'auto'),
      confidence,
      provider: 'fieldops-railway-stt',
      isFinal: true,
    };
  } catch (err) {
    console.warn('[radio-speech-processor] railway stt failed:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function splitTranscriptText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const sentenceChunks = normalized
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks = [];
  const inputChunks = sentenceChunks.length ? sentenceChunks : [normalized];

  for (const rawChunk of inputChunks) {
    if (rawChunk.length <= MAX_SEGMENT_TEXT_LENGTH) {
      chunks.push(rawChunk);
      continue;
    }

    // Hard-wrap long fragments so one segment does not dominate UI replay.
    const words = rawChunk.split(' ').filter(Boolean);
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= MAX_SEGMENT_TEXT_LENGTH) {
        current = candidate;
        continue;
      }

      if (current) chunks.push(current);
      current = word;
    }

    if (current) chunks.push(current);
  }

  return chunks.length ? chunks : [normalized];
}

function buildTranscriptSegments(result, segmentStartMs) {
  const chunks = splitTranscriptText(result?.text || '');
  const normalizedChunks = chunks.length ? chunks : [''];
  const totalChars = normalizedChunks.reduce((sum, chunk) => sum + Math.max(1, chunk.length), 0);
  const estimatedDurationMs = Math.max(
    normalizedChunks.length * DEFAULT_SEGMENT_DURATION_MS,
    Number(result?.durationMs) || 0,
  );

  let cursor = Number(segmentStartMs) || 0;

  return normalizedChunks.map((chunk, index) => {
    const isLast = index === normalizedChunks.length - 1;
    const weightedDuration = Math.max(
      MIN_SEGMENT_DURATION_MS,
      Math.round((Math.max(1, chunk.length) / totalChars) * estimatedDurationMs),
    );
    const nextEnd = isLast
      ? (Number(segmentStartMs) || 0) + estimatedDurationMs
      : cursor + weightedDuration;

    const segment = {
      text: chunk,
      language: result?.language || 'en',
      confidence: result?.confidence ?? null,
      isFinal: isLast ? Boolean(result?.isFinal) : false,
      segmentStartMs: cursor,
      segmentEndMs: Math.max(cursor, nextEnd),
    };

    cursor = segment.segmentEndMs;
    return segment;
  });
}

async function fetchAudioUrlAsBase64(audioUrl) {
  if (!audioUrl) return null;
  const trimmed = String(audioUrl).trim();
  if (!trimmed) return null;

  const fromDataUrl = toBase64AudioFromDataUrl(trimmed);
  if (fromDataUrl) return fromDataUrl;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    console.warn('[radio-speech-processor] invalid audioUrl, skipping fetch');
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    console.warn('[radio-speech-processor] unsupported audioUrl protocol:', parsed.protocol);
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), AUDIO_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), {
      method: 'GET',
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[radio-speech-processor] audioUrl fetch failed ${res.status}`);
      return null;
    }

    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > AUDIO_MAX_FETCH_BYTES) {
      console.warn(`[radio-speech-processor] audioUrl too large (${contentLength} bytes)`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > AUDIO_MAX_FETCH_BYTES) {
      console.warn(`[radio-speech-processor] audio payload exceeds limit (${buffer.length} bytes)`);
      return null;
    }
    return buffer.toString('base64');
  } catch (err) {
    console.warn('[radio-speech-processor] audioUrl fetch error:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Transcribe audio data (base64 or plain URL reference).
 *
 * Phase 1: heuristic stub that acknowledges the event without real STT.
 *   The real STT happens when audio data is piped from the SFU tap (Phase 2).
 *   An event arriving here without audio data is treated as a session-start
 *   heartbeat and produces a zero-length placeholder segment.
 *
 * Phase 2+: audioData will be a base64-encoded Opus/PCM blob from the SFU
 *   PlainTransport tap; this function will POST it to Ollama's Whisper endpoint
 *   (model: whisper / faster-whisper GGUF) when available.
 */
async function transcribeAudio({ audioData, audioUrl, language, transmissionId }) {
  const resolvedAudioData = audioData || await fetchAudioUrlAsBase64(audioUrl);

  if (resolvedAudioData) {
    const sourceResult = await transcribeWithRailwayStt({
      audioData: resolvedAudioData,
      mimeType: 'audio/webm',
      task: 'transcribe',
      language: language || 'auto',
    });

    if (sourceResult?.text) {
      const sourceLanguage = normalizeLanguageTag(sourceResult.language || language || 'auto');
      if (!isEnglishLanguageTag(sourceLanguage)) {
        const translatedResult = await transcribeWithRailwayStt({
          audioData: resolvedAudioData,
          mimeType: 'audio/webm',
          task: 'translate',
          language: sourceLanguage,
        });

        if (translatedResult?.text) {
          return {
            text: translatedResult.text,
            language: 'en',
            sourceLanguage,
            confidence: translatedResult.confidence ?? sourceResult.confidence ?? 0.72,
            provider: 'fieldops-railway-stt:whisper-translate',
            isFinal: true,
          };
        }
      }

      return {
        text: sourceResult.text,
        language: sourceLanguage,
        sourceLanguage,
        confidence: sourceResult.confidence ?? 0.8,
        provider: sourceResult.provider || 'fieldops-railway-stt',
        isFinal: true,
      };
    }
  }

  // Phase 2: real Whisper path (requires whisper model pulled into Ollama instance).
  if (resolvedAudioData && OLLAMA_BASE_URL) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), PROCESSOR_TIMEOUT_MS);
    try {
      const ollamaHeaders = { 'Content-Type': 'application/json' };
      if (OLLAMA_GATEWAY_KEY) ollamaHeaders.Authorization = `Bearer ${OLLAMA_GATEWAY_KEY}`;

      const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
        method: 'POST',
        headers: ollamaHeaders,
        body: JSON.stringify({
          model: WHISPER_MODEL,
          stream: false,
          format: 'json',
          prompt: `Transcribe the following audio for NZ field operations context. Return JSON: {\"text\":\"...\",\"language\":\"...\",\"confidence\":0.9}. Audio (base64 Opus): ${resolvedAudioData}`,
        }),
        signal: controller.signal,
      });

      if (res.ok) {
        const payload = await res.json().catch(() => ({}));
        const content = String(payload?.response || '').trim();
        if (content) {
          let parsed;
          try { parsed = JSON.parse(content); } catch { parsed = null; }
          if (parsed?.text) {
            return {
              text: String(parsed.text).trim(),
              language: String(parsed.language || language || 'en').trim(),
              confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.8)),
              provider: 'ollama-whisper',
              isFinal: true,
            };
          }
        }
      }
    } catch (err) {
      console.warn('[radio-speech-processor] ollama transcription failed:', err.message);
    } finally {
      clearTimeout(timer);
    }
  }

  // Phase 1 stub: placeholder segment so the db row exists for the transmission.
  return {
    text: '',
    language: language || 'en',
    confidence: null,
    provider: 'stub',
    isFinal: false,
    stub: true,
  };
}

// ─── Sequence counter ─────────────────────────────────────────────────────────
// Per-transmission sequence tracking (in-memory; sufficient for single-process).
const sequenceCounters = new Map();
const pipelineMetrics = {
  processed_events: 0,
  failed_events: 0,
  last_processed_at: null,
  last_latency_ms: null,
  last_error: null,
};

function nextSeq(transmissionId) {
  const next = (sequenceCounters.get(transmissionId) || 0) + 1;
  sequenceCounters.set(transmissionId, next);
  return next;
}

function clearSeq(transmissionId) {
  sequenceCounters.delete(transmissionId);
}

// ─── Event handlers ───────────────────────────────────────────────────────────

/**
 * Handle radio.producer.created — a speaker has started transmitting.
 * Writes an initial transcript segment row (stub if no audio data yet).
 */
async function handleProducerCreated(event) {
  const { transmissionId, orgId, audioData, audioUrl, language, segmentStartMs = 0, voiceMetadata } = event;

  if (!transmissionId || !orgId) {
    console.warn('[radio-speech-processor] producer.created: missing transmissionId or orgId — skipping');
    return;
  }

  const pipelineStartMs = Date.now();
  const result = await transcribeAudio({ audioData, audioUrl, language, transmissionId });
  const processingLatencyMs = Date.now() - pipelineStartMs;

  // Don't persist empty stub segments unless RADIO_PERSIST_STUB is set.
  if (result.stub && !process.env.RADIO_PERSIST_STUB) {
    pipelineMetrics.processed_events += 1;
    pipelineMetrics.last_processed_at = new Date().toISOString();
    pipelineMetrics.last_latency_ms = processingLatencyMs;
    pipelineMetrics.last_error = null;
    console.log(`[radio-speech-processor] stub skipped tx=${transmissionId.slice(0, 8)} latency=${processingLatencyMs}ms`);
    return;
  }

  const segments = buildTranscriptSegments(result, segmentStartMs);
  const rows = segments.map((segment) => ({
    org_id: orgId,
    transmission_id: transmissionId,
    sequence_num: nextSeq(transmissionId),
    segment_start_ms: segment.segmentStartMs,
    segment_end_ms: segment.segmentEndMs,
    text: segment.text,
    language: segment.language,
    confidence: segment.confidence,
    is_final: segment.isFinal,
  }));

  try {
    const insertedTranscriptRows = await supabaseInsert('radio_transcript_segments', rows);
    try {
      await emitIngestContractPayload({ event, rows, result, processingLatencyMs });
    } catch (ingestErr) {
      console.warn('[radio-speech-processor] ingest endpoint emit failed:', ingestErr.message);
    }

    pipelineMetrics.processed_events += 1;
    pipelineMetrics.last_processed_at = new Date().toISOString();
    pipelineMetrics.last_latency_ms = processingLatencyMs;
    pipelineMetrics.last_error = null;
    console.log(
      `[radio-speech-processor] inserted ${rows.length} segment(s) tx=${transmissionId.slice(0, 8)}` +
      ` latency=${processingLatencyMs}ms provider=${result.provider || 'unknown'}` +
      ` confidence=${result.confidence ?? 'null'}`
    );

    const transcriptRows = Array.isArray(insertedTranscriptRows) ? insertedTranscriptRows : [];
    const translationRows = transcriptRows
      .filter((row) => String(row?.text || '').trim().length > 0)
      .map((row) => ({
        org_id: orgId,
        transcript_segment_id: row.id,
        target_language: DUB_TARGET_LANGUAGE,
        text: String(row.text || '').trim(),
        confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : result.confidence ?? null,
        provider: result.provider || 'fieldops-railway-stt',
      }));

    if (translationRows.length > 0) {
      try {
        const insertedTranslationRows = await supabaseInsert('radio_translation_segments', translationRows);
        if (DUB_MODE_ENABLED) {
          const translationInserts = Array.isArray(insertedTranslationRows) ? insertedTranslationRows : [];
          const pitchHint = Number.isFinite(Number(voiceMetadata?.pitch)) ? Number(voiceMetadata.pitch) : null;
          const rateHint = Number.isFinite(Number(voiceMetadata?.rate)) ? Number(voiceMetadata.rate) : null;

          if (translationInserts.length > 0) {
            const dubRows = translationInserts.map((row) => ({
              org_id: orgId,
              translation_segment_id: row.id,
              target_language: DUB_TARGET_LANGUAGE,
              provider: `${DUB_PROVIDER}${pitchHint != null || rateHint != null ? ':voice-match' : ''}`,
              is_synthetic: true,
              duration_ms: Math.max(400, Math.round(String(row.text || '').length * 48)),
              render_latency_ms: processingLatencyMs,
              storage_path: null,
            }));
            await supabaseInsert('radio_tts_renders', dubRows);
          }
        }
      } catch (translationErr) {
        console.warn('[radio-speech-processor] translation/dub insert skipped:', translationErr.message);
      }
    }
  } catch (err) {
    pipelineMetrics.failed_events += 1;
    pipelineMetrics.last_error = err.message;
    console.error('[radio-speech-processor] insert failed:', err.message);
    throw err;
  }
}

/**
 * Handle radio.session.closed — transmission ended.
 * Marks the last segment as final and closes the transmission audit row.
 */
async function handleSessionClosed(event) {
  const { transmissionId, orgId } = event;
  if (!transmissionId) return;

  const seq = sequenceCounters.get(transmissionId);
  if (seq) {
    // Phase 2: mark the last written segment as final via PATCH.
    // For now we update the transmission row itself.
  }
  clearSeq(transmissionId);

  if (!orgId) return;

  try {
    await supabasePatch('radio_transmissions', transmissionId, {
      ended_at: new Date().toISOString(),
    });
    console.log(`[radio-speech-processor] closed transmission ${transmissionId.slice(0, 8)}`);
  } catch (err) {
    // ended_at patch is best-effort; don't re-throw so the worker ACKs the event.
    console.warn('[radio-speech-processor] ended_at patch failed:', err.message);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Process an incoming radio speech event.
 * Returns true if the event was handled, false if it was ignored.
 */
async function processSpeechEvent(event) {
  if (!PROCESSOR_ENABLED) return false;

  const type = String(event?.type || '');

  if (type === 'radio.producer.created') {
    await handleProducerCreated(event);
    return true;
  }
  if (type === 'radio.session.closed') {
    await handleSessionClosed(event);
    return true;
  }
  // radio.producer.closed — no action needed at this stage
  return false;
}

/**
 * Returns a lightweight status snapshot for the /health endpoint.
 * Safe to call at any time; never throws.
 */
function getRadioPipelineStatus() {
  const whisperEnabled = String(process.env.RADIO_PROCESSOR_ENABLED || 'false').toLowerCase() === 'true';
  const ollaPttConfigured = !!(process.env.OLLAMA_PTT_BASE_URL || process.env.OLLAMA_BASE_URL);
  return {
    processor_enabled: PROCESSOR_ENABLED,
    processor_mode: whisperEnabled && ollaPttConfigured ? 'whisper' : 'stub',
    ollama_ptt_configured: ollaPttConfigured,
    railway_stt_configured: !!RAILWAY_STT_BASE_URL,
    dub_mode_enabled: DUB_MODE_ENABLED,
    dub_target_language: DUB_TARGET_LANGUAGE,
    whisper_model: WHISPER_MODEL,
    active_transmission_counters: sequenceCounters.size,
    metrics: {
      ...pipelineMetrics,
    },
  };
}

module.exports = {
  processSpeechEvent,
  getRadioPipelineStatus,
  __test: {
    buildIngestContractPayload,
  },
};
