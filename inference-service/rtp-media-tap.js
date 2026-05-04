/**
 * RTP Media Tap Integration
 *
 * Receives RTP audio streams from mediasoup PlainRTP transport,
 * decodes Opus audio, and feeds to Whisper for STT.
 *
 * Flow:
 * 1. ppt-server sends tap_started event → inference-service HTTP POST
 * 2. Create UDP listener on specified port
 * 3. Decode RTP + Opus payload
 * 4. Accumulate audio frames, convert to WAV
 * 5. Submit to Whisper STT
 * 6. Send transcripts back to ppt-server via HTTP POST
 * 7. On tap_stopped: close UDP listener, finalize
 */

const dgram = require('dgram');
const { EventEmitter } = require('events');
const prism = require('prism-media');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

class RTPMediaTap extends EventEmitter {
  constructor(options = {}) {
    super();

    this.rtpPort = options.rtpPort || 40001;
    this.pptServerUrl = options.pptServerUrl || 'http://localhost:3002';
    this.whisperCliPath = options.whisperCliPath || '/usr/local/bin/whisper';
    this.whisperModel = options.whisperModel || 'base'; // base, small, medium, large
    this.sampleRate = options.sampleRate || 48000; // mediasoup default
    this.channels = options.channels || 1;

    this.taps = new Map(); // Map<tapId, { socket, audioBuffer, startTime, metadata }>
    this.transcriptQueue = []; // Pending transcripts to send back

    this.rtcpSenderReporter = null;
  }

  /**
   * Start RTP listener for a specific tap
   * @param {string} tapId - Unique tap identifier
   * @param {object} config - { rtp_port, metadata: { org_id, channel_id, speaker_id } }
   */
  async startTap(tapId, config) {
    try {
      const { rtp_port, metadata } = config;

      console.log(`[RTPTap] Starting tap ${tapId} on port ${rtp_port}`);

      // Create UDP socket
      const socket = dgram.createSocket('udp4');
      const audioBuffer = [];

      socket.on('message', (msg, rinfo) => {
        this._handleRTPPacket(tapId, msg, rinfo, audioBuffer, metadata);
      });

      socket.on('error', (err) => {
        console.error(`[RTPTap] Socket error for tap ${tapId}:`, err);
        this.emit('tap:error', { tapId, error: err.message });
      });

      socket.bind(rtp_port, '127.0.0.1', () => {
        console.log(`[RTPTap] UDP listener bound on port ${rtp_port}`);
      });

      // Store tap info
      this.taps.set(tapId, {
        socket,
        audioBuffer,
        startTime: Date.now(),
        metadata,
        rtpPort: rtp_port,
      });

      this.emit('tap:started', { tapId, rtp_port });
    } catch (err) {
      console.error(`[RTPTap] Failed to start tap ${tapId}:`, err);
      this.emit('tap:error', { tapId, error: err.message });
    }
  }

  /**
   * Stop tap and finalize audio processing
   * @param {string} tapId
   */
  async stopTap(tapId) {
    try {
      console.log(`[RTPTap] Stopping tap ${tapId}`);

      const tap = this.taps.get(tapId);
      if (!tap) {
        console.warn(`[RTPTap] Tap ${tapId} not found`);
        return;
      }

      // Close UDP socket
      if (tap.socket) {
        tap.socket.close();
      }

      // Process final audio if any
      if (tap.audioBuffer.length > 0) {
        await this._processAudioBuffer(tapId, tap.audioBuffer, tap.metadata);
      }

      // Cleanup
      this.taps.delete(tapId);

      this.emit('tap:stopped', { tapId });
    } catch (err) {
      console.error(`[RTPTap] Failed to stop tap ${tapId}:`, err);
    }
  }

  /**
   * Handle incoming RTP packet
   * @private
   */
  _handleRTPPacket(tapId, msg, rinfo, audioBuffer, metadata) {
    try {
      // Parse RTP header
      const rtpHeader = this._parseRTPHeader(msg);

      if (!rtpHeader) {
        console.warn('[RTPTap] Invalid RTP header');
        return;
      }

      // Extract Opus payload (skip RTP header)
      const payload = msg.slice(rtpHeader.headerLength);

      // Store payload for later batch processing
      audioBuffer.push({
        timestamp: rtpHeader.timestamp,
        sequence: rtpHeader.sequence,
        payload,
        receivedAt: Date.now(),
      });

      // Process audio in batches (every ~5s of audio or when buffer reaches 500 packets)
      if (audioBuffer.length >= 500 || this._shouldProcessBatch(audioBuffer)) {
        this._processBatch(tapId, audioBuffer, metadata);
        audioBuffer.splice(0, audioBuffer.length); // Clear
      }
    } catch (err) {
      console.error('[RTPTap] RTP packet handling error:', err);
    }
  }

  /**
   * Parse RTP header
   * @private
   */
  _parseRTPHeader(msg) {
    if (msg.length < 12) return null;

    const byte0 = msg[0];
    const version = (byte0 >> 6) & 0x03;

    if (version !== 2) {
      return null; // Not RTP v2
    }

    const hasPadding = (byte0 & 0x20) !== 0;
    const hasExtension = (byte0 & 0x10) !== 0;
    const csrcCount = byte0 & 0x0f;

    const byte1 = msg[1];
    const hasMarker = (byte1 & 0x80) !== 0;
    const payloadType = byte1 & 0x7f;

    const sequence = msg.readUInt16BE(2);
    const timestamp = msg.readUInt32BE(4);
    const ssrc = msg.readUInt32BE(8);

    let headerLength = 12 + csrcCount * 4;

    if (hasExtension && msg.length >= headerLength + 4) {
      const extLength = msg.readUInt16BE(headerLength + 2) * 4 + 4;
      headerLength += extLength;
    }

    return {
      version,
      padding: hasPadding,
      extension: hasExtension,
      csrcCount,
      marker: hasMarker,
      payloadType,
      sequence,
      timestamp,
      ssrc,
      headerLength,
    };
  }

  /**
   * Check if audio batch should be processed
   * @private
   */
  _shouldProcessBatch(audioBuffer) {
    if (audioBuffer.length === 0) return false;

    const now = Date.now();
    const oldestPacket = audioBuffer[0];

    // Process if oldest packet is older than 5 seconds
    return now - oldestPacket.receivedAt > 5000;
  }

  /**
   * Process audio batch
   * @private
   */
  async _processBatch(tapId, audioBuffer, metadata) {
    try {
      // Sort by sequence number
      audioBuffer.sort((a, b) => a.sequence - b.sequence);

      // Decode Opus + convert to WAV
      const wavPath = await this._decodeAudioBatch(tapId, audioBuffer);

      if (!wavPath) {
        console.warn(`[RTPTap] Failed to decode audio for tap ${tapId}`);
        return;
      }

      // Transcribe with Whisper
      const transcript = await this._transcribeAudio(wavPath);

      if (transcript) {
        // Queue transcript for delivery back to ppt-server
        this.transcriptQueue.push({
          tap_id: tapId,
          transcript: {
            text: transcript.text,
            confidence: transcript.confidence,
            language: transcript.language,
            startTime: Date.now(),
            duration: audioBuffer.length * 20, // ms (assuming Opus 20ms frames)
          },
        });

        this.emit('transcript:queued', { tapId, transcript: transcript.text });
      }

      // Cleanup
      if (fs.existsSync(wavPath)) {
        fs.unlinkSync(wavPath);
      }
    } catch (err) {
      console.error(`[RTPTap] Batch processing error for tap ${tapId}:`, err);
    }
  }

  /**
   * Decode Opus audio batch → WAV file
   * @private
   */
  async _decodeAudioBatch(tapId, audioBuffer) {
    try {
      const tmpDir = os.tmpdir();
      const wavPath = path.join(tmpDir, `tap-${tapId}-${Date.now()}.wav`);

      // Combine Opus payloads
      const opusBuffers = audioBuffer.map((p) => p.payload);
      const opusData = Buffer.concat(opusBuffers);

      // Use ffmpeg to decode Opus → WAV
      const opusPath = path.join(tmpDir, `tap-${tapId}-${Date.now()}.opus`);
      fs.writeFileSync(opusPath, opusData);

      await execFileAsync('ffmpeg', [
        '-i',
        opusPath,
        '-acodec',
        'pcm_s16le',
        '-ar',
        this.sampleRate.toString(),
        '-ac',
        this.channels.toString(),
        wavPath,
      ]);

      // Cleanup opus file
      if (fs.existsSync(opusPath)) {
        fs.unlinkSync(opusPath);
      }

      return wavPath;
    } catch (err) {
      console.error('[RTPTap] Audio decode error:', err.message);
      return null;
    }
  }

  /**
   * Transcribe audio file with Whisper
   * @private
   */
  async _transcribeAudio(wavPath) {
    try {
      const { stderr, stdout } = await execFileAsync(this.whisperCliPath, [
        '--model_dir=/models/whisper',
        '--model',
        this.whisperModel,
        '--language',
        'en',
        '--output_format',
        'json',
        '--output_dir=/tmp',
        wavPath,
      ]);

      // Parse JSON output
      const jsonPath = wavPath.replace(/\.wav$/, '.json');
      if (fs.existsSync(jsonPath)) {
        const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        return {
          text: json.text,
          confidence: json.segments ? Math.random() : 0.95, // TODO: calculate real confidence
          language: 'en',
        };
      }

      return null;
    } catch (err) {
      console.error('[RTPTap] Whisper transcription error:', err.message);
      return null;
    }
  }

  /**
   * Process full audio buffer
   * @private
   */
  async _processAudioBuffer(tapId, audioBuffer, metadata) {
    // Similar to _processBatch but for finalization
    if (audioBuffer.length > 0) {
      await this._processBatch(tapId, audioBuffer, metadata);
    }
  }

  /**
   * Send queued transcripts back to ppt-server
   */
  async sendTranscripts() {
    while (this.transcriptQueue.length > 0) {
      const item = this.transcriptQueue.shift();

      try {
        const response = await fetch(`${this.pptServerUrl}/mediatap/transcript`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        });

        if (!response.ok) {
          console.warn(`[RTPTap] Failed to send transcript to ppt-server: ${response.status}`);
        }
      } catch (err) {
        console.error('[RTPTap] Transcript delivery error:', err.message);
      }
    }
  }

  /**
   * Get active taps
   */
  getActiveTaps() {
    return Array.from(this.taps.keys());
  }
}

module.exports = { RTPMediaTap };
