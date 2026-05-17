/**
 * Radio Feature Flags
 *
 * Env-driven gates for each phase of the PTT Radio rebuild.
 * All flags default to false so existing behaviour is unchanged until
 * explicitly enabled per environment.
 *
 * VITE_RADIO_SFU_ENABLED          — Phase 1: use mediasoup SFU transport instead of P2P
 * VITE_RADIO_TRANSCRIPT_INGESTION_ENABLED — Phase 2: enable transcript ingestion pipeline features
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

  /** Enable transcript ingestion pipeline features. Phase 2. */
  transcriptIngestionEnabled: anyFlag([
    'VITE_RADIO_TRANSCRIPT_INGESTION_ENABLED',
    'VITE_FF_PHASE_0_TRANSCRIPT_INGESTION',
  ]),

  /** Show live STT caption panel below the transmission log. Phase 2. */
  captionsEnabled: anyFlag(['VITE_RADIO_CAPTIONS_ENABLED', 'VITE_FF_PHASE_0_LIVE_CAPTIONS']),

  /** Show translation controls and translated output. Phase 3. */
  translationEnabled: anyFlag(['VITE_RADIO_TRANSLATION_ENABLED', 'VITE_FF_PHASE_0_TRANSLATION_ENABLED']),

  /** Show both original + translated caption lanes simultaneously. Phase 3. */
  dualCaptionLanesEnabled: anyFlag(['VITE_RADIO_DUAL_CAPTION_LANES_ENABLED', 'VITE_FF_PHASE_0_DUAL_CAPTION_LANES']),

  /** Confidence threshold (0–1) below which a caption is flagged low-confidence.
   *  Reads VITE_FF_PHASE_0_TRANSLATION_CONFIDENCE_THRESHOLD; defaults to 0.65. */
  translationConfidenceThreshold: (() => {
    const raw =
      (import.meta.env as Record<string, string>)['VITE_FF_PHASE_0_TRANSLATION_CONFIDENCE_THRESHOLD'] ??
      (import.meta.env as Record<string, string>)['VITE_RADIO_TRANSLATION_CONFIDENCE_THRESHOLD'] ??
      ''
    const parsed = parseFloat(raw)
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.65
  })(),

  /** Badge synthetic/TTS audio in the transmission log. Phase 4/5. */
  syntheticAudioEnabled: anyFlag(['VITE_RADIO_SYNTHETIC_AUDIO_ENABLED', 'VITE_FF_PHASE_0_VOICE_TWIN_GOVERNANCE']),

  /** Enable translated audio relay (TTS synthesis of translated captions). Phase 4. */
  ttsRelayEnabled: anyFlag(['VITE_RADIO_TTS_RELAY_ENABLED', 'VITE_FF_PHASE_0_TTS_RELAY_ENABLED']),

  /** Fall back to original audio when TTS relay fails. Phase 4. */
  ttsFallbackToOriginal: anyFlag(['VITE_RADIO_TTS_FALLBACK_TO_ORIGINAL', 'VITE_FF_PHASE_0_TTS_FALLBACK_TO_ORIGINAL']),
} as const

export type RadioFeatureFlags = typeof radioFeatureFlags
