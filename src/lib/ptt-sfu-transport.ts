/**
 * PTT SFU Transport Layer (C1)
 *
 * Extracted WebRTC transport logic for SFU (mediasoup) backend.
 * This is a pure transport abstraction that can be swapped with P2P transport.
 *
 * Main responsibility:
 * - Manage WebRTC Transport lifecycle (create, connect, produce, consume)
 * - Handle DTLS parameter exchange
 * - Coordinate with ppt-server via REST API
 * - Feed audio packets to/from mediasoup
 *
 * Usage:
 *   const sfuTransport = await createSFUTransport({
 *     pptServerUrl: 'http://localhost:3002',
 *     token: 'jwt-token',
 *     localStream: mediaStream,
 *     onRemoteAudio: (audioTrack) => { ... },
 *     onFloorState: (state) => { ... }
 *   });
 *
 *   // When speaking:
 *   await sfuTransport.requestFloor();
 *   await sfuTransport.startProducing();
 *
 *   // When done:
 *   await sfuTransport.stopProducing();
 *   await sfuTransport.releaseFloor();
 */

export interface SFUTransportConfig {
  pptServerUrl: string;
  token: string;
  channelId: string;
  localStream: MediaStream;
  voiceMetadata?: {
    pitch?: number;
    rate?: number;
    tone?: string;
  };
  onRemoteAudio?: (track: MediaStreamTrack) => void;
  onFloorState?: (state: FloorState) => void;
  onTranscript?: (text: string, confidence: number) => void;
  onError?: (error: string) => void;
}

export interface FloorState {
  active_speaker?: string;
  queue: string[];
  timestamp: number;
}

interface WebRtcTransportParams {
  transport_id: string;
  iceParameters: unknown;
  iceCandidates: unknown[];
  dtlsParameters: unknown;
  sctpParameters?: unknown;
}

export class SFUTransport {
  private config: SFUTransportConfig;
  private peerConnection: RTCPeerConnection | null = null;
  private sendTransport: WebRtcTransportParams | null = null;
  private recvTransport: WebRtcTransportParams | null = null;
  private producer: RTCRtpSender | null = null;
  private consumers: Map<string, RTCRtpReceiver> = new Map();
  private floorState: FloorState = { queue: [], timestamp: Date.now() };
  private connected = false;

  constructor(config: SFUTransportConfig) {
    this.config = config;
  }

  /**
   * Initialize SFU transport connection
   */
  async connect(): Promise<void> {
    try {
      const turnUsername = String(import.meta.env.VITE_PTT_TURN_USERNAME || '').trim();
      const turnCredential = String(import.meta.env.VITE_PTT_TURN_CREDENTIAL || '').trim();

      // 1. Create peer connection
      this.peerConnection = new RTCPeerConnection({
        iceServers: [
          {
            urls: [
              'turn:72.61.123.97:3478?transport=udp',
              'turn:72.61.123.97:3478?transport=tcp',
            ],
            ...(turnUsername ? { username: turnUsername } : {}),
            ...(turnCredential ? { credential: turnCredential } : {}),
          },
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
        iceTransportPolicy: 'relay',
      });

      // 2. Create send transport
      this.sendTransport = await this._createTransport('send');

      // 3. Create receive transport
      this.recvTransport = await this._createTransport('recv');

      // 4. Connect transports (DTLS handshake)
      await this._connectTransport(this.sendTransport);
      await this._connectTransport(this.recvTransport);

      // 5. Setup local audio track
      if (this.config.localStream) {
        const audioTrack = this.config.localStream.getAudioTracks()[0];
        if (audioTrack && this.peerConnection) {
          this.producer = this.peerConnection.addTrack(audioTrack, this.config.localStream);
        }
      }

      this.connected = true;
      console.log('[SFU Transport] Connected');
    } catch (err) {
      console.error('[SFU Transport] Connection failed:', err);
      const message = err instanceof Error ? err.message : String(err);
      this.config.onError?.(`Connection failed: ${message}`);
      throw err;
    }
  }

  /**
   * Create WebRTC transport (send or recv)
   * @private
   */
  private async _createTransport(direction: 'send' | 'recv'): Promise<WebRtcTransportParams> {
    const response = await fetch(`${this.config.pptServerUrl}/sfu/transport/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.token}`,
      },
      body: JSON.stringify({
        channel_id: this.config.channelId,
        direction,
      }),
    });

    if (!response.ok) {
      throw new Error(`Transport creation failed: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Connect transport (DTLS handshake)
   * @private
   */
  private async _connectTransport(transport: WebRtcTransportParams): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    // Create offer/answer with SFU
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    // Exchange with SFU server
    const response = await fetch(`${this.config.pptServerUrl}/sfu/transport/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.token}`,
      },
      body: JSON.stringify({
        transport_id: transport.transport_id,
        dtlsParameters: transport.dtlsParameters,
      }),
    });

    if (!response.ok) {
      throw new Error(`Transport connect failed: ${response.statusText}`);
    }
  }

  /**
   * Request floor (for speaking)
   */
  async requestFloor(): Promise<void> {
    try {
      const response = await fetch(`${this.config.pptServerUrl}/control/floor-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.token}`,
        },
        body: JSON.stringify({
          channel_id: this.config.channelId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Floor request failed: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[SFU Transport] Floor requested:', result);
    } catch (err) {
      console.error('[SFU Transport] Floor request error:', err);
      const message = err instanceof Error ? err.message : String(err);
      this.config.onError?.(`Floor request failed: ${message}`);
      throw err;
    }
  }

  /**
   * Start producing audio (after floor is granted)
   */
  async startProducing(): Promise<void> {
    try {
      if (!this.producer || !this.peerConnection) {
        throw new Error('Producer not initialized');
      }

      const params = this.producer.getParameters();

      const response = await fetch(
        `${this.config.pptServerUrl}/sfu/transport/${this.sendTransport?.transport_id}/produce`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.token}`,
          },
          body: JSON.stringify({
            kind: 'audio',
            rtpParameters: params,
            appData: {
              channel_id: this.config.channelId,
              voice_metadata: this.config.voiceMetadata || null,
            },
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Producer creation failed: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[SFU Transport] Producer started:', result.producer_id);
    } catch (err) {
      console.error('[SFU Transport] Start producing error:', err);
      const message = err instanceof Error ? err.message : String(err);
      this.config.onError?.(`Start producing failed: ${message}`);
      throw err;
    }
  }

  /**
   * Stop producing audio
   */
  async stopProducing(): Promise<void> {
    // Pause producer via REST endpoint
    if (this.producer) {
      try {
        await fetch(
          `${this.config.pptServerUrl}/sfu/producer/${this.producer.track?.id}/pause`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.token}`,
            },
          }
        );
      } catch (err) {
        console.error('[SFU Transport] Stop producing error:', err);
      }
    }
  }

  /**
   * Release floor (done speaking)
   */
  async releaseFloor(): Promise<void> {
    try {
      const response = await fetch(`${this.config.pptServerUrl}/control/floor-release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.token}`,
        },
        body: JSON.stringify({
          channel_id: this.config.channelId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Floor release failed: ${response.statusText}`);
      }

      console.log('[SFU Transport] Floor released');
    } catch (err) {
      console.error('[SFU Transport] Release floor error:', err);
      const message = err instanceof Error ? err.message : String(err);
      this.config.onError?.(`Release floor failed: ${message}`);
      throw err;
    }
  }

  /**
   * Disconnect from SFU
   */
  async disconnect(): Promise<void> {
    try {
      if (this.peerConnection) {
        this.peerConnection.close();
      }
      this.connected = false;
      console.log('[SFU Transport] Disconnected');
    } catch (err) {
      console.error('[SFU Transport] Disconnect error:', err);
    }
  }

  /**
   * Get current floor state
   */
  getFloorState(): FloorState {
    return this.floorState;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Factory function: create SFU transport
 */
export async function createSFUTransport(
  config: SFUTransportConfig
): Promise<SFUTransport> {
  const transport = new SFUTransport(config);
  await transport.connect();
  return transport;
}
