/**
 * Radio Feature Flags
 *
 * Env-driven gates for each phase of the PTT Radio rebuild.
 * All flags default to false so existing behaviour is unchanged until
 * explicitly enabled per environment.
 *
 * VITE_RADIO_SFU_ENABLED          — Phase 1: use mediasoup SFU transport instead of P2P
 * VITE_RADIO_CAPTIONS_ENABLED     — Phase 2: display live STT captions panel
 * VITE_RADIO_TRANSLATION_ENABLED  — Phase 3: display translation controls and output
 * VITE_RADIO_SYNTHETIC_AUDIO_ENABLED — Phase 4+5: badge synthetic/TTS audio in TX log
 */

function flag(key: string): boolean {
  const raw = (import.meta.env as Record<string, string>)[key] ?? ''
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())
}

function anyFlag(keys: string[]): boolean {
  return keys.some((key) => flag(key))
}

export const radioFeatureFlags = {
  /** Use mediasoup SFU transport instead of peer-to-peer WebRTC. Phase 1. */
  sfuEnabled: anyFlag(['VITE_RADIO_SFU_ENABLED', 'VITE_FF_PHASE_0_SFU_ENABLED']),

  /** Show live STT caption panel below the transmission log. Phase 2. */
  captionsEnabled: anyFlag(['VITE_RADIO_CAPTIONS_ENABLED', 'VITE_FF_PHASE_0_LIVE_CAPTIONS']),

  /** Show translation controls and translated output. Phase 3. */
  translationEnabled: anyFlag(['VITE_RADIO_TRANSLATION_ENABLED', 'VITE_FF_PHASE_0_TRANSLATION_ENABLED']),

  /** Badge synthetic/TTS audio in the transmission log. Phase 4/5. */
  syntheticAudioEnabled: anyFlag(['VITE_RADIO_SYNTHETIC_AUDIO_ENABLED', 'VITE_FF_PHASE_0_VOICE_TWIN_GOVERNANCE']),
} as const

export type RadioFeatureFlags = typeof radioFeatureFlags
