# PTT Clean-Sheet Rollout Plan

## Objective

Move FieldOps Manager from the current signaling-centric PTT baseline to a professional radio platform with live translation and optional voice-matched relay, while preserving org isolation and operational safety.

Future-state note:

1. This plan describes proposed target-state services, ADRs, and schema additions.
2. These items are design targets and backlog items, not claims that they already exist in the current repo or `system_state.json`.

## Workstreams

### 1. Architecture and Service Boundaries

1. Define service contracts for policy gateway, radio control plane, SFU plane, and AI speech plane.
2. Select the SFU platform and deployment topology.
3. Define Redis/message bus requirements for floor control and presence fanout.
4. Define observability baselines and SLOs.

Grounding note:

1. These are proposed future services and boundaries for the redesign.
2. The current repo remains grounded in the existing frontend, Supabase policy layer, hPanel PTT server, and inference service until those changes are explicitly implemented.

### 2. Schema and Policy Redesign

1. Add new `radio_*` schema objects.
2. Define RLS policies for transcripts, translations, TTS renders, and voice profiles.
3. Model org scope, contract scope, emergency override, and consent state.
4. Regenerate TS database types after schema changes.

Initial target data model:

1. `radio_transmissions`: one row per transmission session, linked to org, channel, and speaker
2. `radio_transcript_segments`: time-ordered transcript segments linked to `radio_transmissions`
3. `radio_translation_segments`: translated transcript segments linked to transcript segment and target language
4. `radio_tts_renders`: synthetic-audio render artifacts linked to transmission and target language
5. `radio_voice_profiles`: consented voice profile registry for optional voice-twin support
6. `radio_voice_consents`: auditable consent and revocation records for voice-twin enrollment

Relationship rule:

1. All new target-state tables stay org-scoped and remain subordinate to the existing policy model enforced in Supabase.

### 3. Client Module Refactor

1. Separate transport, UI, device, caption, and translation responsibilities behind clear interfaces.
2. Keep the first implementation grounded in existing repo structure unless a new module path is explicitly added and verified.
3. Keep current UX principles:
   - clear active-org context
   - optimistic real-time states
   - keyboard accessibility
   - low-friction field interaction

### 4. Media Backbone Migration

1. Replace peer-first media with SFU-backed sessions.
2. Keep TURN and restrictive-network support mandatory.
3. Add floor arbitration events and emergency override.
4. Add replay/recording fork for authorized channels.

### 5. AI Speech Integration

1. Implement streaming STT path.
2. Implement segment translation path.
3. Implement translated-audio synthesis path.
4. Add confidence thresholds and fail-soft rules.
5. Keep original audio primary.

### 6. Voice-Twin Governance

1. Build consented enrollment workflow.
2. Add profile management and revocation.
3. Add provider abstraction and watermarking.
4. Default to neutral dispatch voice until policy and trust gates pass.

## Phase Plan

### Phase 0: Decision and Foundations

1. Approve architecture and service topology.
2. Choose SFU stack.
3. Choose voice-synthesis provider strategy.
4. Define legal/compliance position for voice matching.

ADR status:

1. These ADRs are pending design decisions at the start of the plan.
2. Phase 0 exists specifically to create and approve them before implementation starts.

### Phase 1: Radio Core Rebuild

1. Stand up control plane.
2. Stand up SFU + TURN.
3. Integrate scoped session grants from Supabase policy layer.
4. Migrate radio client to the new transport.
5. Do not include live translation or voice-twin scope in this phase.

Exit criteria:

1. original audio works across supported roles
2. reconnect and floor control are stable
3. emergency override is implemented

### Phase 2: Transcript Layer

1. Add streaming STT ingestion from media tap.
2. Persist transcript segments and transmission metadata.
3. Render live captions in the radio UI.
4. Add explicit delayed-caption and speech-unavailable states.

Exit criteria:

1. transcript segments arrive within target latency
2. transcript persistence is org-safe and auditable

### Phase 3: Translation Layer

1. Add translation subscriptions per user/language.
2. Persist translated segments.
3. Render original plus translated caption lanes.
4. Gate translated captions behind latency and confidence thresholds.

Exit criteria:

1. captions do not cross org boundaries
2. low-confidence segments are visibly flagged

### Phase 4: Translated Audio Relay

1. Add TTS render queue.
2. Add receiver-side playback preferences.
3. Add neutral translated audio option.
4. Keep original audio primary and suppress translated playout when latency exceeds threshold.

Exit criteria:

1. translated audio is optional and clearly synthetic
2. failures do not affect original radio traffic

### Phase 5: Voice-Twin Relay

1. Add consented enrollment.
2. Add voice-profile registry.
3. Add user-specific synthetic relay mode.
4. Add deletion and revocation workflow.
5. Require explicit legal, trust, and operational approval before release.

Exit criteria:

1. consent and revocation are enforced
2. all voice-twin outputs are synthetic-tagged and auditable

## Ticket Backlog

### Ticket Group A: Architecture

1. ADR draft: choose SFU platform
2. ADR draft: choose event backbone for floor control
3. ADR draft: voice-twin governance model

### Ticket Group B: Data Model

1. Create `radio_transmissions`
2. Create `radio_transcript_segments`
3. Create `radio_translation_segments`
4. Create `radio_tts_renders`
5. Create `radio_voice_profiles` and `radio_voice_consents`
6. Add RLS and policy helper functions

### Ticket Group C: Client Refactor

1. Introduce radio service boundaries without assuming a new top-level module path
2. Migrate store/runtime into transport, caption, and translation service layers
3. Add live caption UI
4. Add translation controls and state model
5. Add synthetic-audio indicators

Client refactor detail:

1. Start by isolating transport concerns from `src/lib/ptt.ts`.
2. Extract caption and translation state into separate client-side services while preserving the current route surface.
3. Keep the first implementation within the current repo layout until a new module boundary is explicitly added.
4. Add feature flags so caption, translation, and translated-audio rollout can be enabled independently.

### Ticket Group D: Service Buildout

1. Build policy gateway token contract
2. Build radio control plane
3. Deploy SFU and TURN
4. Connect AI media tap
5. Add speech worker queue

### Ticket Group E: Trust and Operations

1. Add audit dashboards
2. Add synthetic media tagging checks
3. Add latency and packet-loss dashboards
4. Add runbooks for AI degradation modes

## Validation

1. Role-scoped radio access tests
2. Org isolation tests for transcripts and translations
3. Reconnect tests across unstable networks
4. Emergency-channel latency tests
5. AI-off degradation tests
6. Consent/revocation tests for voice profiles

## Risks to Retire Early

1. SFU operational cost and reliability
2. translation latency under field network conditions
3. legal/compliance posture for voice matching
4. user trust in synthetic translated audio

## Phase Gates

1. Do not start translated audio until transcript and caption latency is stable in staging.
2. Do not start voice-twin buildout until neutral translated audio is proven, auditable, and trusted.
3. If any phase weakens original-audio reliability, stop and repair that phase before moving forward.

## Dr Bob Final Verification Checks

1. Ensure all phases meet their exit criteria before proceeding.
2. Conduct thorough testing in a staging environment before moving to production.
3. Monitor SFU operational costs and reliability throughout the project.