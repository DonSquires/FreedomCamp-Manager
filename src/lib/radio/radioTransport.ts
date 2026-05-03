/**
 * Radio Transport — SFU transport layer
 *
 * When VITE_RADIO_SFU_ENABLED=true this module provides a mediasoup-client
 * send/receive transport to the ptt-server control plane. When the flag is
 * false (default) all calls are lightweight pass-throughs that keep the
 * existing ptt.ts peer-to-peer path intact.
 *
 * Architecture: ADR 003 (ptt-radio-service-topology), ADR 004 (mediasoup v3)
 *
 * Phase 1 implementation: connect/disconnect + audio producer lifecycle.
 * Consumer (receive) side is wired in Phase 2 when the SFU fan-out is stable.
 */

import { radioFeatureFlags } from './radioFeatureFlags'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SfuTransportOptions {
  /** Signed JWT returned by the radio-token Edge Function */
  token: string
  /** HTTP base URL of the ptt-server control plane */
  controlUrl: string
  /** Transmission id inserted by the Edge Function */
  transmissionId: string
  /** ICE servers from the token response */
  iceServers: RTCIceServer[]
}

export interface SfuSession {
  transmissionId: string
  /** Close the send transport and notify the control plane */
  close(): Promise<void>
  /** Start sending a local MediaStream track as the audio producer */
  produce(stream: MediaStream): Promise<void>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function post<T>(url: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`radio-transport: POST ${url} failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<T>
}

// ─── SFU Session ──────────────────────────────────────────────────────────────

async function createSfuSession(opts: SfuTransportOptions): Promise<SfuSession> {
  // Dynamically import mediasoup-client to keep it out of the main chunk when
  // the SFU flag is off. TypeScript sees the type via the installed package.
  const { Device } = await import('mediasoup-client')
  const { controlUrl, token, transmissionId, iceServers } = opts

  // 1. Create a mediasoup Router on the control plane
  const { routerRtpCapabilities } = await post<{ routerRtpCapabilities: object }>(
    `${controlUrl}/radio/router/create`,
    token,
    { transmissionId },
  )

  // 2. Load the Device
  const device = new Device()
  await device.load({ routerRtpCapabilities: routerRtpCapabilities as Parameters<typeof device.load>[0]['routerRtpCapabilities'] })

  // 3. Create a WebRTC send transport on the control plane
  const transportParams = await post<{
    id: string
    iceParameters: object
    iceCandidates: object[]
    dtlsParameters: object
  }>(
    `${controlUrl}/radio/transport/create`,
    token,
    {
      transmissionId,
      direction: 'send',
      iceServers,
    },
  )

  // 4. Wire up the client-side send transport
  const sendTransport = device.createSendTransport({
    ...transportParams,
    iceServers,
  } as Parameters<typeof device.createSendTransport>[0])

  sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
    try {
      await post(
        `${controlUrl}/radio/transport/connect`,
        token,
        { transmissionId, transportId: sendTransport.id, dtlsParameters },
      )
      callback()
    } catch (err) {
      errback(err instanceof Error ? err : new Error(String(err)))
    }
  })

  sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
    try {
      const { id } = await post<{ id: string }>(
        `${controlUrl}/radio/producer/create`,
        token,
        { transmissionId, transportId: sendTransport.id, kind, rtpParameters },
      )
      callback({ id })
    } catch (err) {
      errback(err instanceof Error ? err : new Error(String(err)))
    }
  })

  let producer: Awaited<ReturnType<typeof sendTransport.produce>> | null = null

  return {
    transmissionId,

    async produce(stream: MediaStream): Promise<void> {
      const track = stream.getAudioTracks()[0]
      if (!track) throw new Error('radio-transport: no audio track in stream')
      if (producer) producer.close()
      producer = await sendTransport.produce({ track })
    },

    async close(): Promise<void> {
      producer?.close()
      sendTransport.close()
      await fetch(`${controlUrl}/radio/session/${encodeURIComponent(transmissionId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {
        // best-effort teardown
      })
    },
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Open an SFU session for outbound audio.
 * Only available when `radioFeatureFlags.sfuEnabled` is true.
 * Throws if called with the flag off to surface configuration mistakes early.
 */
export async function openSfuSession(opts: SfuTransportOptions): Promise<SfuSession> {
  if (!radioFeatureFlags.sfuEnabled) {
    throw new Error(
      'radio-transport: VITE_RADIO_SFU_ENABLED is not set. ' +
      'Use connectToPTT from @/lib/ptt for the peer-to-peer path.',
    )
  }
  return createSfuSession(opts)
}

/** True when the SFU path is active and mediasoup-client is expected. */
export const isSfuActive = radioFeatureFlags.sfuEnabled
