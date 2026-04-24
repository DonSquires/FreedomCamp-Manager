# PTT Clean-Sheet Redesign Spec

## Scope

This spec defines a clean-sheet, professional redesign for mission-critical Push-to-Talk in FieldOps Manager with:

1. Low-latency half-duplex radio operations
2. Live transcript and translation
3. Optional translated audio playback
4. Optional voice-matched synthetic relay
5. Strong org/contract authorization boundaries
6. Audit, retention, and operational resilience

This redesign is grounded in the current repo shape:

1. Frontend: React 18 + TypeScript + Vite + Tailwind + shadcn/ui
2. State: Zustand for PTT runtime, TanStack Query for persisted reads
3. Backend policy/data: Supabase + Edge Functions + RLS
4. Existing PTT runtime: hPanel VPS signaling server in `ptt-server/`
5. Existing AI runtime: `inference-service/` with Whisper-compatible transcription, Ollama translation, and TTS endpoints

## Current Repo Truth

Current implemented seams that matter:

1. `src/lib/ptt.ts` and `src/stores/pttStore.ts` own client-side signaling, WebRTC handling, and device state.
2. `supabase/functions/ptt-signaling-token` already enforces org-aware admission and short-lived scoped tokens.
3. `src/pages/PTTRadio.tsx` already contains:
   - channel selection
   - best-effort clip transcription
   - manual interpreter translation UI
4. `inference-service/server.js` already exposes:
   - `POST /infer/transcribe`
   - `POST /translate`
   - `POST /infer/speak`
5. Existing schema seeds exist in migrations for:
   - `ptt_messages`
   - `ptt_presence`
   - `ptt_channels`
   - `ptt_transmission_log`
   - `ptt_channel_authorizations`
   - `ptt_contract_authorizations`

Current hard constraint:

1. The present architecture is signaling-centric and peer/TURN media-centric.
2. True live translation is not operationally correct if audio only reaches peers and the server never receives media taps.

## Product Goals

1. Preserve professional radio semantics: one floor owner per channel unless emergency override applies.
2. Keep original speaker audio as the operational source of truth.
3. Add assistive AI layers without breaking radio when AI degrades.
4. Enforce multi-org isolation and explicit contract/authorization scope.
5. Support web and mobile workflows with predictable reconnect and low operator friction.

## Non-Goals

1. Reusing browser-native speech APIs as the primary production speech stack.
2. Relying on peer-to-peer media as the long-term primary transport.
3. Treating translated audio as authoritative over original audio.
4. Allowing unconsented voice cloning.

## Design Principles

1. Separate policy, control, media, and AI planes.
2. Keep all authorization decisions in the policy plane, never in the SFU or TTS provider.
3. Fail soft: if AI fails, radio still works.
4. Make synthetic output explicit, auditable, and revocable.
5. Preserve org-scoped UX and active-org clarity throughout.

## Target Architecture

### 1. Client Plane

Web and mobile clients own:

1. microphone capture
2. hold-to-talk, toggle, VOX, and hardware PTT interactions
3. local VAD hints and preflight audio quality checks
4. live caption rendering
5. translated-audio playback preferences
6. explicit synthetic-voice indicators

Client state remains a Zustand-owned runtime slice, but the radio runtime should be separated into its own implementation boundary at execution time.

Implementation note:

1. Do not assume a new top-level module path until the repo truth for that structure is established.
2. The first implementation pass may remain within existing PTT files while service boundaries are introduced incrementally.

### 2. Policy Plane

Supabase remains the policy and audit authority.

Responsibilities:

1. auth and org context
2. role and contract-based access checks
3. issuance of short-lived scoped session grants
4. persistence of transcripts, translations, audits, and consent records
5. retention enforcement

### 3. Control Plane

A dedicated radio control service replaces the current thin signaling pattern.

Responsibilities:

1. channel admission
2. floor arbitration
3. emergency override
4. presence and device coordination
5. reconnect orchestration
6. issuance of SFU session tokens after policy validation

Back it with Redis and a message bus so it can survive multi-node failover.

### 4. Media Plane

Use an SFU as the primary media backbone.

Responsibilities:

1. uplink audio ingress
2. receiver fanout
3. server-side media tap for AI processing
4. recording and replay fork
5. TURN integration and carrier-network resilience

Recommended platforms:

1. LiveKit first choice
2. mediasoup second choice if tighter custom control is needed

Peer-to-peer can remain as a degraded fallback only, not the target production mode.

### 5. AI Speech Plane

This is a dedicated speech pipeline service tier, not mixed into control-plane logic.

Responsibilities:

1. streaming STT
2. incremental translation
3. confidence scoring
4. translated-audio TTS
5. optional voice-twin synthesis
6. safety and quality gating

The existing `inference-service/` can remain the orchestration entry point, but heavy speech workloads should move to dedicated workers.

## Complexity Control

This redesign is intentionally ambitious, so complexity must be bounded explicitly.

Control rules:

1. Keep original radio transport working before introducing live AI layers.
2. Do not split into new services unless each split removes a clear operational or scaling risk.
3. Prefer staged boundary extraction over a big-bang rewrite of client code.
4. Keep phase 1 deployable with a small number of moving parts: policy layer, radio control, SFU, and TURN.
5. Treat voice-twin support as a separate product track, not as part of core radio availability.

## Media and Translation Flow

### Standard Radio Flow

1. Client requests floor from control plane.
2. Control plane validates scoped grant and grants floor.
3. Client publishes audio to SFU.
4. SFU relays original audio to authorized receivers.
5. SFU forks a low-bitrate AI tap to the speech pipeline.
6. Speech pipeline emits transcript segments.
7. Translation engine emits translated segments per subscribed target language.
8. Receivers see live captions while hearing original audio.
9. Optional translated audio is synthesized after segment or transmission completion.

### Emergency Flow

1. Emergency channels preserve original audio priority.
2. Captioning may continue.
3. Synthetic translated audio may be suppressed if latency or confidence is below threshold.
4. If speech services degrade, the system must fall back to original audio without blocking the channel.

## Latency Targets

1. Floor grant target: under 150 ms median
2. Audio start-to-receiver playout: under 250 ms median
3. First transcript segment: under 800 ms
4. First translated segment: under 1200 ms
5. Full translated audio after transmission end: under 1500 ms for short transmissions

Latency fallback rules:

1. If translated captions miss target repeatedly, show delayed-caption state rather than pretending live status.
2. If translated audio misses target, suppress synthetic playout and keep captions only.
3. If carrier conditions are poor, emergency and dispatch channels must prefer original audio plus optional delayed captions.

## Reliability Targets

1. Radio path must remain operational if STT fails.
2. Radio path must remain operational if translation fails.
3. Radio path must remain operational if TTS fails.
4. Control-plane node loss must not drop the entire fleet.
5. TURN must be production-grade and mandatory where carrier conditions require it.

## Security and Compliance

1. Original audio remains the operational source of truth.
2. Translated text and audio are marked assistive.
3. Synthetic voice output is explicitly labeled synthetic in UI and metadata.
4. Voice matching requires user enrollment, explicit consent, revocation support, and retention policy.
5. All transcript, translation, and voice-profile rows are org-scoped and audit-logged.

## Target Schema

Add or redesign around the following tables:

1. `radio_channels`
2. `radio_channel_memberships`
3. `radio_sessions`
4. `radio_floor_events`
5. `radio_presence`
6. `radio_transmissions`
7. `radio_audio_artifacts`
8. `radio_transcript_segments`
9. `radio_translation_segments`
10. `radio_tts_renders`
11. `radio_voice_profiles`
12. `radio_voice_consents`
13. `radio_quality_events`
14. `radio_policy_overrides`

Minimum required metadata on AI-derived rows:

1. `organization_id`
2. `transmission_id`
3. `source_language`
4. `target_language`
5. `confidence`
6. `provider`
7. `model_version`
8. `synthetic_flag`
9. `created_by_system`

## Voice-Twin Subsystem

Voice matching is a distinct subsystem, not a default TTS option.

Requirements:

1. explicit enrollment flow
2. clean-sample capture workflow
3. speaker-profile generation
4. consent logging
5. revocation and deletion workflow
6. provider-agnostic voice registry
7. watermarking or equivalent synthetic tagging
8. legal and organizational approval gate before production enablement

Operational modes:

1. neutral translated voice
2. organization-standard dispatch voice
3. user-specific voice twin when enabled and consented

Voice-twin go/no-go gates:

1. Do not implement production voice matching until transcript and translation reliability targets are already met.
2. Do not enable voice twins for emergency traffic by default.
3. Do not enable voice twins without explicit consent, revocation, audit trail, and synthetic disclosure in UI.
4. If trust, legal, or latency requirements are unresolved, ship neutral translated voice only.

## Rollout Strategy

1. Phase 1: SFU-backed radio without live AI
2. Phase 2: live captions and transcript persistence
3. Phase 3: live translation captions
4. Phase 4: translated audio playback
5. Phase 5: consented voice-twin relay

## Acceptance Criteria

1. officer/admin/master role access works under scoped policy grants
2. original audio works when AI plane is disabled
3. live captions appear within latency budget on supported networks
4. translated captions never cross org boundaries
5. synthetic audio is always marked and auditable
6. voice-profile deletion revokes future synthesis immediately

## Self-Critique

### Flaw 1: Operational Complexity

This design is significantly more complex than the current repo topology. It introduces a control plane, SFU plane, and AI plane, which raises deployment, observability, and incident-response burden.

Mitigation:

1. Keep phase 1 limited to radio-core rebuild and defer live AI until the media backbone is stable.

### Flaw 2: Voice-Twin Legal and Trust Risk

The voice-matching subsystem is the highest-trust-risk feature. Even if technically strong, it creates consent, misuse, and reputational concerns that can outweigh operator benefit unless tightly governed.

Mitigation:

1. Treat voice twin as optional phase 5 scope with a separate approval gate and neutral-voice fallback.

### Flaw 3: Latency Risk in Real Networks

The design assumes disciplined latency engineering across SFU, STT, translation, and TTS. On poor carrier networks, translated audio may degrade faster than captions, so the system must prefer graceful fallback over feature completeness.

Mitigation:

1. Make original audio the only hard real-time requirement and degrade AI features independently.

## Dr Bob Review Closure

1. Final Dr Bob review decision: approve.
2. No additional verification checks were required for this spec in the final approved review.