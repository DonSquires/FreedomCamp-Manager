/**
 * Media Tap Integration
 *
 * Connects active speaker audio to inference-service for:
 * - Real-time Speech-to-Text (Whisper)
 * - Language detection
 * - Semantic extraction for AI processing
 *
 * Flow:
 * 1. When floor is granted, create PlainRTP consumer tap on producer
 * 2. RTP packets flow to inference-service via localhost:40001 (configurable)
 * 3. Inference service processes audio, returns transcripts + metadata
 * 4. Store transcripts in radio_transcripts table
 * 5. Publish to Redis for real-time display + Bob integration
 * 6. When floor is released, close tap
 *
 * Per ADR 004 (SFU Platform) + PHASE0_SCHEMA_VALIDATION
 */

const dgram = require('dgram');
const { EventEmitter } = require('events');

class MediaTapManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.inferencService = {
      baseUrl: process.env.INFERENCE_SERVICE_URL || 'http://localhost:5003',
      timeout: parseInt(process.env.INFERENCE_SERVICE_TIMEOUT) || 30000,
    };

    this.taps = new Map(); // Map<tapId, { producer, consumer, transport, session }>
    this.transcriptBuffer = new Map(); // Map<tapId, AccumulatingTranscript>

    this.redisClient = options.redisClient;
    this.supabase = options.supabase;
  }

  /**
   * Start media tap: connect PlainRTP consumer to inference
   * @param {string} tapId - Unique tap identifier
   * @param {Producer} producer - Active speaker producer
   * @param {Consumer} consumer - PlainRTP consumer
   * @param {Object} tuple - RTP output tuple { localIp, localPort }
   * @param {Object} metadata - { org_id, channel_id, speaker_id, transmission_id }
   * @returns {Promise<void>}
   */
  async startTap(tapId, producer, consumer, tuple, metadata) {
    try {
      console.log(`[MediaTap] Starting tap ${tapId} for speaker ${metadata.speaker_id}`);

      // Initialize transcript accumulator
      this.transcriptBuffer.set(tapId, {
        segments: [],
        language: null,
        startTime: Date.now(),
        metadata,
      });

      // Store tap references
      this.taps.set(tapId, {
        producer,
        consumer,
        tuple,
        metadata,
        session: 'active',
      });

      // Notify inference service: tap started
      await this._notifyInferenceService('tap_started', {
        tap_id: tapId,
        rtp_port: tuple.localPort,
        metadata,
      });

      // Start polling for transcripts (inference service posts back via /mediatap/transcript)
      this._startTranscriptPoller(tapId);

      this.emit('tap:started', { tapId, metadata });
    } catch (err) {
      console.error(`[MediaTap] Failed to start tap ${tapId}:`, err);
      this.emit('tap:error', { tapId, error: err.message });
      throw err;
    }
  }

  /**
   * Stop media tap
   * @param {string} tapId
   * @returns {Promise<void>}
   */
  async stopTap(tapId) {
    try {
      console.log(`[MediaTap] Stopping tap ${tapId}`);

      const tap = this.taps.get(tapId);
      if (!tap) {
        console.warn(`[MediaTap] Tap ${tapId} not found`);
        return;
      }

      // Notify inference service
      await this._notifyInferenceService('tap_stopped', { tap_id: tapId });

      // Finalize transcript
      const buffer = this.transcriptBuffer.get(tapId);
      if (buffer && buffer.segments.length > 0) {
        await this._persistTranscript(tapId, buffer);
      }

      // Cleanup
      this.taps.delete(tapId);
      this.transcriptBuffer.delete(tapId);

      // Close mediasoup consumer
      if (tap.consumer && !tap.consumer.closed) {
        tap.consumer.close();
      }

      this.emit('tap:stopped', { tapId });
    } catch (err) {
      console.error(`[MediaTap] Failed to stop tap ${tapId}:`, err);
      this.emit('tap:error', { tapId, error: err.message });
    }
  }

  /**
   * Handle incoming transcript from inference service
   * Called by POST /mediatap/transcript endpoint
   * @param {string} tapId
   * @param {Object} transcript - { text, confidence, language, startTime, duration }
   */
  async onTranscriptReceived(tapId, transcript) {
    try {
      const buffer = this.transcriptBuffer.get(tapId);
      if (!buffer) {
        console.warn(`[MediaTap] Buffer not found for tap ${tapId}`);
        return;
      }

      // Add segment
      buffer.segments.push({
        text: transcript.text,
        confidence: transcript.confidence,
        language: transcript.language,
        startOffset: transcript.startTime - buffer.startTime,
        duration: transcript.duration,
      });

      if (transcript.language && !buffer.language) {
        buffer.language = transcript.language;
      }

      // Publish to Redis for real-time display
      const tap = this.taps.get(tapId);
      if (tap) {
        await this.redisClient.publish(
          `radio:org:${tap.metadata.org_id}:${tap.metadata.channel_id}:transcript`,
          JSON.stringify({
            event: 'transcript_segment',
            speaker_id: tap.metadata.speaker_id,
            text: transcript.text,
            confidence: transcript.confidence,
            timestamp: Date.now(),
          })
        );
      }

      this.emit('transcript:received', { tapId, segment: transcript });
    } catch (err) {
      console.error(`[MediaTap] Failed to handle transcript for tap ${tapId}:`, err);
    }
  }

  /**
   * Persist transcript to database
   * @private
   */
  async _persistTranscript(tapId, buffer) {
    try {
      const tap = this.taps.get(tapId);
      if (!tap) return;

      const { org_id, channel_id, speaker_id, transmission_id } = tap.metadata;

      // Store in radio_transcripts table
      const { error } = await this.supabase
        .from('radio_transcripts')
        .insert([
          {
            transmission_id,
            org_id,
            channel_id,
            speaker_id,
            text: buffer.segments.map((s) => s.text).join(' '),
            language: buffer.language,
            segments: buffer.segments,
            confidence: buffer.segments.length > 0
              ? buffer.segments.reduce((sum, s) => sum + (s.confidence || 0), 0) /
                buffer.segments.length
              : 0,
            duration_ms: Date.now() - buffer.startTime,
            status: 'final',
            created_at: new Date().toISOString(),
          },
        ]);

      if (error) {
        console.error(`[MediaTap] Failed to store transcript:`, error);
      } else {
        console.log(`[MediaTap] Transcript persisted for transmission ${transmission_id}`);
      }
    } catch (err) {
      console.error(`[MediaTap] Persist transcript exception:`, err);
    }
  }

  /**
   * Notify inference service of tap events
   * @private
   */
  async _notifyInferenceService(event, payload) {
    try {
      const response = await fetch(`${this.inferencService.baseUrl}/mediatap/${event}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: this.inferencService.timeout,
      });

      if (!response.ok) {
        console.warn(
          `[MediaTap] Inference service returned ${response.status} for ${event}`
        );
      }
    } catch (err) {
      console.error(`[MediaTap] Failed to notify inference service:`, err.message);
    }
  }

  /**
   * Start polling for transcripts
   * @private
   */
  _startTranscriptPoller(tapId) {
    const pollInterval = setInterval(async () => {
      if (!this.taps.has(tapId)) {
        clearInterval(pollInterval);
        return;
      }

      // In production, pull pending transcripts from inference service
      // For MVP: inference service is responsible for pushing via POST /mediatap/transcript
    }, 5000);
  }

  /**
   * Get active taps for channel
   */
  getChannelTaps(orgId, channelId) {
    const taps = [];
    for (const [tapId, tap] of this.taps) {
      if (tap.metadata.org_id === orgId && tap.metadata.channel_id === channelId) {
        taps.push({ tapId, ...tap.metadata });
      }
    }
    return taps;
  }

  /**
   * Get tap info
   */
  getTap(tapId) {
    return this.taps.get(tapId);
  }
}

module.exports = { MediaTapManager };
