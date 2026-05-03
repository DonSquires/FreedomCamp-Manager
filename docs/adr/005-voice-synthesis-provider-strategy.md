# ADR 005: Voice Synthesis Provider Strategy

## Status

Accepted

## Context

Phase 4 of the PTT Radio rebuild (plan.md) adds translated-audio relay: speech from one officer is translated and synthesized as audio for officers in other languages. Phase 5 (Voice-Twin Governance) optionally adds a consented voice-twin that renders translated audio in the speaker's own voice profile.

Two synthesis use cases require different provider strategies:

1. **Neutral dispatch voice (Phase 4)** — a fixed, clearly synthetic voice for translated audio. No consent requirement. Must be low-latency, deployable without third-party data routing for NZ privacy compliance.
2. **Consented voice-twin (Phase 5)** — translated audio rendered in the speaker's voice. Requires explicit consent, revocation, and auditable enrollment. High quality; latency tolerance higher than neutral voice.

**Options evaluated:**

| Option | Self-host | Latency | Voice-twin | NZ data routing | License |
|--------|-----------|---------|------------|-----------------|---------|
| **Coqui TTS / XTTS** | ✅ | Medium | ✅ XTTS v2 | ✅ On-VPS | OSS (Mozilla Public) |
| ElevenLabs | ❌ SaaS | Low | ✅ | ❌ Offshore routing | Commercial |
| OpenAI TTS | ❌ SaaS | Low | ❌ | ❌ Offshore routing | Commercial |
| MeloTTS | ✅ | Low | ❌ | ✅ | OSS (MIT) |
| Piper TTS | ✅ | Very low | ❌ | ✅ | OSS (MIT) |

## Decision

Adopt a **two-tier synthesis strategy** with a provider abstraction layer:

### Tier 1 — Neutral Dispatch Voice (Phase 4)

Use **Piper TTS** for neutral translated audio:

- Extremely low latency (suitable for near-real-time relay).
- Self-hostable on VPS via the existing `inference-service/` ONNX pipeline (Piper uses ONNX models).
- MIT licensed; NZ-data-resident by design.
- Clearly synthetic; no voice cloning capability reduces privacy risk.
- Default voice: a neutral, clear, professional en-NZ compatible voice model.

### Tier 2 — Consented Voice-Twin (Phase 5, gated)

Use **Coqui XTTS v2** for consented voice-twin rendering:

- Self-hostable on RunPod GPU or a VPS GPU upgrade.
- XTTS v2 supports voice cloning from a short reference sample.
- NZ-data-resident when deployed on-instance (no offshore audio routing).
- Gated behind explicit consent records in `radio_voice_consents` table.
- Phase 5 does not start until Phase 4 (neutral audio) is proven, auditable, and trusted (per plan.md Phase Gates).

### Provider Abstraction

A `SpeechSynthesisProvider` interface is defined in `inference-service/` with two implementations: `PiperProvider` and `XttsProvider`. The control plane selects the tier based on channel policy and consent state — the radio client never calls a synthesis endpoint directly.

```
interface SpeechSynthesisProvider {
  synthesize(text: string, language: string, voiceProfile?: string): Promise<Buffer>
  isAvailable(): Promise<boolean>
}
```

## Consequences

- ElevenLabs is **rejected** for production voice-twin synthesis due to offshore data routing constraints under the NZ Privacy Act 2020. It may be used for proactive supervisor alerts (non-officer-audio use cases) if a data processing agreement is established.
- The `inference-service/` ONNX runtime already supports Piper-compatible models — Tier 1 adds a model download and synthesis endpoint, not a new service.
- Tier 2 (XTTS) requires GPU inference; deployment is gated on Phase 4 exit criteria and consent/revocation infrastructure being in place.
- Synthetic audio artifacts are tagged in the UI and in `radio_tts_renders` metadata — users are never misled about audio authenticity.
- Voice watermarking is added in Phase 5 before voice-twin release; this is non-negotiable.

## Verification

- Piper synthesizes a test utterance in under 500 ms on the inference service VPS tier.
- XTTS synthesizes a test utterance with a reference voice sample in a GPU test environment.
- Provider abstraction interface passes a mock test for both tiers.
- Consent gate correctly blocks Tier 2 synthesis when no active consent record exists.
