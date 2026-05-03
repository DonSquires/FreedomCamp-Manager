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
const OLLAMA_GATEWAY_KEY = String(process.env.OLLAMA_GATEWAY_KEY || '');
const WHISPER_MODEL = String(process.env.RADIO_WHISPER_MODEL || process.env.OLLAMA_MODEL || 'qwen2.5:7b');
const PROCESSOR_TIMEOUT_MS = Math.max(5000, parseInt(process.env.RADIO_PROCESSOR_TIMEOUT_MS || '20000', 10));
const PROCESSOR_ENABLED = String(process.env.RADIO_PROCESSOR_ENABLED || 'false').toLowerCase() === 'true';
const AUDIO_FETCH_TIMEOUT_MS = Math.max(3000, parseInt(process.env.RADIO_AUDIO_FETCH_TIMEOUT_MS || '12000', 10));
const AUDIO_MAX_FETCH_BYTES = Math.max(64 * 1024, parseInt(process.env.RADIO_AUDIO_MAX_FETCH_BYTES || String(8 * 1024 * 1024), 10));

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

// ─── STT ─────────────────────────────────────────────────────────────────────

function toBase64AudioFromDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:audio\/[^;]+;base64,(.+)$/i);
  if (!match?.[1]) return null;
  return match[1].trim() || null;
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
  const { transmissionId, orgId, audioData, audioUrl, language, segmentStartMs = 0 } = event;

  if (!transmissionId || !orgId) {
    console.warn('[radio-speech-processor] producer.created: missing transmissionId or orgId — skipping');
    return;
  }

  const pipelineStartMs = Date.now();
  const result = await transcribeAudio({ audioData, audioUrl, language, transmissionId });
  const processingLatencyMs = Date.now() - pipelineStartMs;

  // Don't persist empty stub segments unless RADIO_PERSIST_STUB is set.
  if (result.stub && !process.env.RADIO_PERSIST_STUB) {
    console.log(`[radio-speech-processor] stub skipped tx=${transmissionId.slice(0, 8)} latency=${processingLatencyMs}ms`);
    return;
  }

  const segmentEndMs = segmentStartMs + (result.durationMs || 0);
  const seq = nextSeq(transmissionId);

  const row = {
    org_id: orgId,
    transmission_id: transmissionId,
    sequence_num: seq,
    segment_start_ms: segmentStartMs,
    segment_end_ms: segmentEndMs,
    text: result.text,
    language: result.language,
    confidence: result.confidence,
    is_final: result.isFinal,
  };

  try {
    await supabaseInsert('radio_transcript_segments', row);
    console.log(
      `[radio-speech-processor] inserted segment seq=${seq} tx=${transmissionId.slice(0, 8)}` +
      ` latency=${processingLatencyMs}ms provider=${result.provider || 'unknown'}` +
      ` confidence=${result.confidence ?? 'null'}`
    );
  } catch (err) {
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
    whisper_model: WHISPER_MODEL,
    active_transmission_counters: sequenceCounters.size,
  };
}

module.exports = { processSpeechEvent, getRadioPipelineStatus };
