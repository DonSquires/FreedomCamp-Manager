# PTT Clean-Sheet Rollout Plan

## Realignment Project: Next 2 Phases Execution Checklist

Status source: `docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md` and `docs/STAGING.md`

**CURRENT STATUS (2026-05-17)**: Phase A-E ✅ COMPLETE (95+ cumulative tests). Phase F 80% ready (isolated gates passing). Phase G entry gate 50% complete (build budget + Phase E health validated). Phase 0 entry blockers resolved; Phase 0-1 scaffolding complete; Phase 0-2/P0-3 contract lanes green (10/10 deployed, 2026-05-17).
Intent:
**Updated Timing Schedule**:
 - Phase A: ✅ Complete (Aug 1 - Aug 25, 2026) — Actual completion: May 14, 2026 (ahead of schedule)
 - Phase B: ✅ Complete (Aug 26 - Sept 29, 2026) — Actual completion: May 14, 2026 (ahead of schedule)
 - Phase C: ✅ Complete (Sept 30 - Oct 18, 2026) — Actual completion: May 14, 2026 (ahead of schedule)
 - Phase D: ✅ Complete (Oct 19 - Nov 24, 2026) — Actual completion: May 14, 2026 (ahead of schedule)
 - Phase E: ✅ Complete (Nov 25 onward, 2026) — Actual completion: May 15, 2026 (ahead of schedule)
 - Phase F: ⏳ In progress (Expected: Complete by May 17, 2026) — Current: 80% ready, Phase 3 transience issue (infra) remaining
 - Phase G: ⏳ Staged (Expected: Complete by May 20, 2026) — Current: 50% validated (build + Phase E health), canary lane pending
 - Phase 0: ⏳ In progress (Implementation started May 17, 2026) — Phase 0-1 scaffolding complete; Phase 0-2/P0-3 contract lanes green (10/10 deployed); steering committee ADR sign-off still pending (human process)

1. Track execution for the next two realignment phases with checkboxes.
2. Keep this section as the active operator checklist for C1-C4 and D1-D3.

### Global Entry Gate (Before Phase C Work)

- [ ] Confirm Phase B gate is explicitly green in staging evidence.
- [ ] Confirm ownership roster is current for C and D leads.

- [x] Confirm Phase B gate is explicitly green in staging evidence. ✅ May 14
- [x] Confirm ownership roster is current for C and D leads. ✅ May 14
- [x] Confirm feature flag plan exists for all C and D slices. ✅ May 14
- [x] Confirm rollback and degraded-mode expectations are documented per slice. ✅ May 14
#### C1 Site Guard / Security Operations (Weeks 1-2)

Owner: Security Operations Lead

- [x] Map Site Guard / Static Guard workflows to shared case/timeline contracts.
- [x] Ensure emergency assist events persist to the shared timeline.
- [x] Validate org-safe reads/writes across Site Guard actions.
- [x] Add/refresh E2E and integration tests for Site Guard case linkage.
- [x] Capture evidence in staging snapshot with command outputs.

#### C2 Identity and Risk (Weeks 3-4)

Owner: Identity and Risk Lead

- [x] Align Access Control, Face Recognition, Identity Verification flows to case/event contracts.
- [x] Align Site Risk Assessment persistence to the same org-scoped contracts.
- [x] Validate org isolation for identity and risk data access paths.
- [x] Add degraded-mode behavior coverage for inference/risk unavailability.
- [x] Capture evidence in staging snapshot with command outputs.

#### C3 Intelligence (Weeks 5-6)

Owner: Intelligence Data Lead

- [x] Align POI/VOI/LOI and evidence capture to shared case/timeline contracts.
- [x] Ensure alert queues emit/consume shared event-family records.
- [x] Validate idempotent replay behavior for intelligence/event ingestion.
- [x] Add integration tests for evidence linkage and org-safe retrieval.
- [x] Capture evidence in staging snapshot with command outputs.

#### C4 Client Services Surfaces (Weeks 7-8)

Owner: Client Services Lead

- [x] Align Assets, Keys, Client, Contact, Service Agreement surfaces to shared contracts.
- [x] Confirm reporting integration reads from case/timeline-aligned sources.
- [x] Validate cross-surface workflow continuity under role/route constraints.
- [x] Add smoke tests for client-service workflows on shared backbone.
- [x] Capture evidence in staging snapshot with command outputs.

### Phase C Exit Gate Checklist

- [x] Phase B gate confirmed green. ✅
- [x] Security assistive surfaces resolve people/vehicle/place via shared contracts. ✅
- [x] Site guard and assistive workflows attach to shared case/timeline model. ✅
- [x] Build/lint/tests pass for all C slices. ✅
- [x] Phase C completion snapshot recorded in staging docs. ✅

### Phase D (Bob + Translation + Transition Hardening)

Timeline reference: Sept 30 - Nov 24

#### D1 Bob Approval Contracts (Weeks 1-2)

Owner: Bob Platform Lead

- [x] Standardize Bob proposal, approval, escalation, execution, and audit contract fields.
- [x] Ensure Bob actions carry org context and approver/execution outcomes.
- [x] Validate audit completeness for all Bob decision pathways.
- [x] Add contract tests for proposal -> approval -> execution lifecycle.
- [x] Capture evidence in staging snapshot with command outputs.

#### D2 Translation and Speech Runtime Boundaries (Weeks 3-4)

Owner: Speech and AI Lead

- [x] Enforce translation/speech runtime boundaries and fallback contracts.
- [x] Validate degraded-mode controls for transcript, translation, and synthetic-audio flows.
- [x] Ensure failures do not break primary operational pathways.
- [x] Add tests for success + degraded responses with org-scoped persistence checks.
- [x] Capture evidence in staging snapshot with command outputs.

#### D3 Transition, Handshake, Offline-Reconnect (Weeks 5-8)

Owner: Mobility Lead

- [x] Harden active-org transition polling and handshake outcomes.
- [x] Validate offline replay conflict handling and reconnect idempotency.
- [x] Validate org-scope safety under reconnect and replay scenarios.
- [x] Add integration tests for duplicate replay/stale-state conflict cases.
- [x] Capture evidence in staging snapshot with command outputs.

### Phase D Exit Gate Checklist

- [x] Phase C gate confirmed green.
- [x] Bob approval, translation, and transition services are auditable.
- [x] Degraded-mode safety verified for Bob/translation/speech paths.
- [x] Offline replay conflict scenarios pass defined tests.
- [x] Build/lint/tests pass for all D slices.
- [x] Phase D completion snapshot recorded in staging docs.

### Phase E Entry Check (Go/No-Go)

- [x] Confirm Phase D gate is explicitly green in staging evidence.
- [x] Confirm ownership/support rota is active for E1-E4 slices. ✅
- [x] Confirm target high-fragmentation pages and dashboard acceptance criteria are agreed. ✅

### Phase E (Data Movement Reduction + Enterprise Hardening)

Timeline reference: Nov 25 onward

#### E1 Direct Query Reduction Baseline

Owner: Data Access Lead

- [x] Publish baseline vs current direct-query drift for target pages.
- [x] Confirm reduction targets and acceptance thresholds are documented.
- [x] Capture evidence in staging snapshot with command outputs.

#### E2 Hook/Service Migration

Owner: Platform Integration Lead

- [x] Migrate highest-fragmentation surfaces to shared hook/service contracts.
- [x] Validate org isolation and role-safe behavior after migration.
- [x] Capture evidence in staging snapshot with command outputs.

#### E3 Audit Dashboard Completeness

Owner: Audit and Governance Lead

- [x] Validate operational and contract-event completeness dashboards.
- [x] Confirm integrity checks and alert thresholds are active.
- [x] Capture evidence in staging snapshot with command outputs.

#### E4 Communications Delivery Governance

Owner: Communications Reliability Lead

- [x] Validate retry visibility and delivery accountability metrics.
- [x] Confirm degraded/outage communication behavior is auditable.
- [x] Capture evidence in staging snapshot with command outputs.

### Phase E Completion Gate Checklist

- [x] Phase D gate confirmed green while E changes land.
- [x] Target fragmentation pages show downward direct-query drift.
- [x] Communications delivery governance is live and measurable.
- [x] Build/lint/tests pass for all E slices.
- [x] Phase E completion snapshot recorded in staging docs.

---

## Phase 0 (Radio Platform Redesign: PTT → Professional Radio with Live Translation)

**Timeline reference**: Calendarized on 2026-05-15 (current timeline)

**Amended schedule (NZ):**

1. Phase 0 Entry Gate: 2026-05-15 to 2026-05-20
2. Phase 0-1 (Core SFU + Floor Control): 2026-05-21 to 2026-06-10
3. Phase 0-2 (Streaming STT + Live Captions): 2026-06-11 to 2026-06-24
4. Phase 0-3 (Translation Layer): 2026-06-25 to 2026-07-08
5. Phase 0-4 (Translated Audio Relay): 2026-07-09 to 2026-07-22
6. Phase 0-5 (Voice-Twin Governance): 2026-07-23 to 2026-08-12

**Strategic intent**: Replace peer-to-peer PTT with professional radio platform featuring selective forwarding, streaming transcription, multi-language translation, and optional voice-matched relay — while maintaining org isolation, emergency operability, and full Bob governance integration.

**Architecture foundation**: Three ADRs (SFU platform, event backbone, voice-twin governance) + schema design + 5-phase feature flag rollout.

### Phase 0 Entry Gate Checklist (Go/No-Go)
- [x] ADR-006 (SFU Platform): Livekit selection approved for entry-gate progression (steering committee final sign-off pending)
- [x] ADR-007 (Event Backbone): Redis Pub/Sub topology documented and approved for entry-gate progression
- [x] ADR-008 (Voice-Twin): Three-tier consent governance documented and approved for entry-gate progression
- [x] Phase 0 schema design reviewed and documented (6 core tables + org-level RLS enforcement)
- [x] Feature flag strategy validated (Phases 1-5 canary progression defined)
- [x] Star Trek integration documented (Bob governance for floor control + emergency override)
- [x] All ADRs pass Dr Bob automated review (`node scripts/dr-bob-review.mjs`)
- [x] DECISIONS.md updated with Phase 0 architectural decisions
- [x] STAGING.md updated with Phase 0 entry gate snapshot
- [ ] Steering committee approval meetings completed for ADR-006/007/008 (human process)

**Entry gate owner**: Platform Architecture Lead + Bob Platform Lead (co-owners)

**Immediate blockers**: None technical; steering committee approval meetings remain.

### Phase 0-1: Core SFU + Floor Control (2026-05-21 to 2026-06-10)

**Owner**: Platform Engineering Lead

**Objective**: Establish Livekit SFU as primary media transport and implement org-scoped floor control via Redis + Supabase audit trail.

#### P0-1a SFU Integration
- [ ] Provision Livekit Cloud account (ops team)
- [x] Create `supabase/functions/radio-session-grant/` endpoint for org-scoped token generation
- [ ] Implement `src/lib/radioTransport.ts` with Livekit WebRTC client
- [x] Configure TURN server for restrictive networks
- [x] Add feature flag `FF_PHASE_0_SFU_ENABLED`

#### P0-1b Floor Control
- [x] Create `supabase/functions/radio-floor-acquire/` and `radio-floor-release/` endpoints
- [ ] Implement Redis Pub/Sub channels for floor state coordination
- [x] Add `radio_floor_events` table with RLS policies
- [x] Implement floor UI indicator (who's transmitting on this channel)
- [x] Add feature flag `FF_PHASE_0_FLOOR_CONTROL`

Implementation note (2026-05-17):
- Redis floor coordination exists in `ppt-server/floor-control.js` + `ppt-server/radio-control-routes.js` (request/release/override/state).
- UI floor indicator is active in `src/pages/PTTRadio.tsx` via live speaker state (`speakerId`, `speakerName`, `someoneSpeaking`, receiving/transmitting badges).

#### P0-1c Emergency Override
- [x] Create supervisor override path (org-scoped)
- [x] Integrate Bob approval contract (Phase D D1) for escalation
- [x] Add `radio_floor_events.operator_id` logging for audit
- [x] Add feature flag `FF_PHASE_0_EMERGENCY_OVERRIDE`

#### P0-1d Tests & Validation
- [x] Create `tests/e2e/phase0-phase1-sfu-connectivity.spec.ts` (multi-user, org isolation, reconnect)
- [x] Create `tests/e2e/phase0-phase1-floor-control.spec.ts` (floor contention, override, replay)
- [ ] Validate Star Trek Phase 1 (Director) remains green
- [ ] Canary progression gate: **5% orgs for 1 week; < 2% audio drops threshold**

#### P0-1e Capture Evidence
- [ ] Run all tests and record in `docs/STAGING.md`
- [ ] `bun run build` PASS
- [ ] `bun run lint` PASS
- [ ] Update `plan.md` with Phase 0-1 completion snapshot

**Phase 0-1 Progress Snapshot (2026-05-17)**
- Implemented/available: session grant function, floor acquire/release functions, supervisor override function, `radio_floor_events` schema + RLS, override/audit `operator_id` logging, Phase 0 SFU/floor/emergency feature flags, and P0-1 contract specs.
- Remaining before phase completion: Livekit cloud provisioning, Redis floor coordinator, production Star Trek Phase 1 revalidation, canary rollout, and green `bun run build` in an environment where Bun is installed.

### Phase 0-2: Streaming STT + Live Captions (2026-06-11 to 2026-06-24)

**Owner**: Speech & AI Lead

**Objective**: Stream STT from Livekit egress tap; persist transcripts; render live captions in UI.

#### P0-2a STT Ingestion
- [ ] Configure Livekit egress pipeline to tap media
- [ ] Integrate STT service (Google Cloud Speech API or Azure Speech)
- [x] Create `supabase/functions/ingest-transcript-segments/` endpoint
- [x] Create `radio_transmission` and `radio_transcript_segments` tables with RLS
- [x] Add feature flag `FF_PHASE_0_TRANSCRIPT_INGESTION`

Implementation note (2026-05-17):
- `ingest-transcript-segments` now enforces authenticated org scope, transmission/org/channel consistency, bounded payload size, confidence/time validation, and deterministic sequence dedupe before idempotent upsert (`transmission_id,sequence_num`).
- Frontend radio flags now expose transcript-ingestion gate via `VITE_FF_PHASE_0_TRANSCRIPT_INGESTION` / `VITE_RADIO_TRANSCRIPT_INGESTION_ENABLED`.
- Endpoint now supports provider trace metadata (`provider.name/requestId/model/region/latencyMs/pipeline`, `source`) and a health mode (`action: health` or `healthCheck: true`) for runtime readiness checks without segment writes.
- `ptt-server/speech-worker.js` now normalizes outbound speech webhook payloads with stable `source`, structured `provider`, `channelId/channelType`, and trace metadata before forwarding to the speech pipeline.
- `ptt-server/radio-router.js` now enriches producer/session lifecycle queue events with channel scope and default provider/source metadata for downstream transcript processing.
- Credentialed Playwright execution now runs and is green after runtime alignment: deployed `ingest-transcript-segments` refreshed, `radio_transcript_segments.channel_id` migration applied, and P0-2/P0-3 contract lane passes across the configured Playwright browser matrix.

#### P0-2b Live Caption UI
- [x] Add caption lane to `src/pages/RadioUI.tsx`
- [x] Implement caption sync (timestamp-matched to audio playback)
- [x] Add latency threshold control (`FF_PHASE_0_CAPTION_LATENCY_THRESHOLD_MS`)
- [x] Implement "delayed captions" and "speech unavailable" states
- [x] Add feature flag `FF_PHASE_0_LIVE_CAPTIONS`

Implementation note (2026-05-17): caption lane/runtime lives in `src/pages/PTTRadio.tsx` and is exposed through `src/pages/RadioUI.tsx` compatibility entrypoint + `/radio-ui` route.

#### P0-2c Tests & Validation
- [x] Create `tests/e2e/phase0-phase2-transcripts.spec.ts`
- [ ] Validate transcript latency < 1000ms after speech ends
- [x] Validate org isolation on transcript reads/writes ✅ 2026-05-17 (cross-org probe assertion in spec; credentialed run 10/10 green)
- [ ] Validate Star Trek Phase 2 (Universal Translator) remains green
- [ ] Canary progression gate: **5% cohort for 5 days; caption arrival latency must stay < 1000ms**

#### P0-2d Capture Evidence
- [x] Update `docs/STAGING.md` with Phase 0-2 snapshot

### Phase 0-3: Multi-Language Translation Layer (2026-06-25 to 2026-07-08)

**Owner**: Speech & AI Lead

**Objective**: Add per-user translation subscriptions; persist translated segments; render dual caption lanes.

#### P0-3a Translation Pipeline
- [x] Integrate translation service (Google Translate, Azure Translator, DeepL) — stub + provider env wiring ✅ 2026-05-17
- [x] Create `supabase/functions/translate-transcript-segments/` endpoint ✅ 2026-05-17 (deployed to kxwjcupuxnnbnzcgmkoi)
- [x] Create `radio_translation_segments` table with RLS ✅ (migration 20260709000003)
- [x] Implement per-user language preference storage ✅ (user_profiles.notification_preferences.translation)
- [x] Add feature flag `FF_PHASE_0_TRANSLATION_ENABLED` ✅ (radioFeatureFlags.ts)

#### P0-3b Dual Caption UI
- [x] Add translated caption lane alongside original ✅ (PTTRadio.tsx dual lane rendering)
- [x] Implement confidence threshold gating (`FF_PHASE_0_TRANSLATION_CONFIDENCE_THRESHOLD`) ✅ env-configurable via radioFeatureFlags.ts
- [x] Add low-confidence visual indicators ✅ (is_low_confidence generated column + UI badge)
- [x] Add feature flag `FF_PHASE_0_DUAL_CAPTION_LANES` ✅ (radioFeatureFlags.ts)

#### P0-3c Tests & Validation
- [x] Create `tests/e2e/phase0-phase3-translation.spec.ts` ✅
- [x] Validate org isolation on translation reads/writes ✅ (new org-isolation spec assertion)
- [x] Validate low-confidence flagging ✅ (low-confidence spec + is_low_confidence generated column)
- [x] Validate cross-org caption isolation ✅ (RLS cross-org row count = 0 assertion)
- [ ] Validate Star Trek Phase 3 (Sentient XO) remains green
- [ ] Canary progression gate: **25% cohort for 3 days; zero org-boundary leaks**

#### P0-3d Capture Evidence
- [x] Update `docs/STAGING.md` with Phase 0-3 snapshot ✅ 2026-05-17 (contract lane green snapshot recorded)

### Phase 0-4: Translated Audio Relay (2026-07-09 to 2026-07-22)

**Owner**: Speech & AI Lead

**Objective**: Synthesize translated audio and relay to receiving users; maintain original audio as primary.

#### P0-4a TTS Rendering
- [x] Integrate TTS provider (ElevenLabs, Google Cloud TTS, Azure Speech Synthesis) — provider env wiring + degraded-mode 503 ✅ 2026-05-17
- [x] Create `supabase/functions/synthesize-translated-audio/` endpoint ✅ 2026-05-17 (deployed to kxwjcupuxnnbnzcgmkoi)
- [x] Create `radio_tts_renders` table with RLS and synthetic tag ✅ (migration 20260709000004)
- [x] Implement watermarking on all synthesized audio ("This is synthesized translation") ✅ (watermark field in every response)
- [x] Add feature flag `FF_PHASE_0_TTS_RELAY_ENABLED` ✅ (radioFeatureFlags.ts ttsRelayEnabled)

#### P0-4b Audio Playback Controls
- [x] Implement user preference for audio playback mode (original, translated, both) ✅ (user_radio_preferences.audio_playback_mode)
- [x] Add fallback to original if TTS unavailable ✅ (degraded-mode 503 + fallback signal in response)
- [x] Add feature flag `FF_PHASE_0_TTS_FALLBACK_TO_ORIGINAL` ✅ (radioFeatureFlags.ts ttsFallbackToOriginal)
- [x] Create `user_radio_preferences` table ✅ (migration 20260517095000, deployed)

#### P0-4c Tests & Validation
- [x] Create `tests/e2e/phase0-phase4-translated-audio.spec.ts` ✅ 2026-05-17
- [ ] Validate TTS synthesis latency acceptable for live operations
- [x] Validate watermark presence on all synthetic audio ✅ (spec asserts watermark field present)
- [x] Validate original audio remains primary if TTS fails ✅ (degraded-mode spec + fallback signal assertion)
- [ ] Validate Star Trek Phase 4 (Admiral's Bridge) remains green
- [ ] Canary progression gate: **50% cohort for 1 week; zero TTS failures blocking original audio**

#### P0-4d Capture Evidence
- [ ] Update `docs/STAGING.md` with Phase 0-4 snapshot

### Phase 0-5: Voice-Twin Enrollment & Governance (2026-07-23 to 2026-08-12)

**Owner**: Voice & Governance Lead

**Objective**: Enable optional voice-matched relay; three-tier consent model; full audit governance.

#### P0-5a Enrollment UI
- [ ] Create `src/pages/VoiceTwinEnrollment.tsx` with consent flow
- [ ] Create `radio_voice_profiles` table with consent versioning
- [ ] Implement enrollment with signature + timestamp capture
- [ ] Add feature flag `FF_PHASE_0_VOICE_TWIN_ENROLLMENT`

#### P0-5b Runtime Voice-Twin Check
- [ ] Implement `shouldUseVoiceTwin()` logic (enrollment + preference + org setting checks)
- [ ] Create fallback to neutral voice if any check fails
- [ ] Add emergency disable path (user + org-level)
- [ ] Add feature flag `FF_PHASE_0_VOICE_TWIN_SYNTHESIS`

#### P0-5c Audit Governance
- [ ] Create `radio_voice_twin_events` table with full logging
- [ ] Create `src/pages/VoiceTwinAuditDashboard.tsx` for org admins
- [ ] Implement voice-profile revocation (self + supervisor)
- [ ] Add feature flag `FF_PHASE_0_VOICE_TWIN_AUDIT_DASHBOARD`

#### P0-5d Legal & Compliance Gate
- [ ] Legal team reviews consent text and governance model (ADR-008)
- [ ] Compliance validates audit trail and data residency
- [ ] Leadership approves voice-twin use case and risk acceptance
- [ ] **This gate is mandatory before Phase 0-5 implementation**

#### P0-5e Tests & Validation
- [ ] Create `tests/e2e/phase0-phase5-voice-twin.spec.ts`
- [ ] Validate consent enforcement (no synthesis without enrollment)
- [ ] Validate revocation (immediate effect)
- [ ] Validate audit trail completeness
- [ ] Validate emergency disable works under all scenarios
- [ ] Validate Star Trek governance contracts remain green
- [ ] Canary progression gate: **Iron Eagle internal only for 2 weeks; full legal audit of 100+ voice-twin events**

#### P0-5f Capture Evidence
- [ ] Update `docs/STAGING.md` with Phase 0-5 snapshot
- [ ] Record all audit events + legal sign-off

### Phase 0 Exit Gate Checklist

- [ ] Phase 0-1 gate passes: SFU + floor control stable, < 2% audio drops, org isolation verified
- [ ] Phase 0-2 gate passes: Transcripts arriving < 1000ms, caption latency acceptable
- [ ] Phase 0-3 gate passes: Translation working, zero org-boundary leaks, confidence thresholds working
- [ ] Phase 0-4 gate passes: Translated audio synthesis stable, original audio never blocked, watermarking present
- [ ] Phase 0-5 gate passes: Consent governance enforced, audit trail complete, legal approval obtained
- [ ] All Star Trek phases (Phase 1–4) remain green
- [ ] Build/lint/tests pass for all Phase 0 slices
- [ ] Phase 0 completion snapshot recorded in `docs/STAGING.md`
- [ ] PTT deprecation plan finalized (Phase 0-5 → Phase 1 PTT sunset timeline)

---

### Phase F Entry Check (Go/No-Go)

- [x] Confirm Phase E gate is explicitly green in staging evidence.
- [x] Confirm Star Trek Phase 3+4 spec files are present and testable.
- [x] Confirm Phase 0 exit gate dependency is recorded (F treated as validation lane; full Phase 0 implementation gate remains separate).

### Phase F (Star Trek Phase 3+4 — Translation + Translated Audio Consolidation)

Timeline reference: PTT clean-sheet plan Phase 3 + Phase 4

#### F1 Translation Layer Gate (Star Trek Phase 3)

Owner: Speech and AI Lead

- [x] Validate role-path redirect safety for translation-capable sessions.
- [x] Validate Sentient XO integration handoff contract.
- [x] Validate UX baseline capture artifacts remain present and current.
- [x] Run full Star Trek Phase 3 gate suite and capture evidence.
- [x] Capture evidence in staging snapshot with command outputs.

#### F2 Translated Audio Relay Gate (Star Trek Phase 4)

Owner: Speech and AI Lead

- [x] Validate Admiral's Bridge handoff and synthetic audio relay contracts.
- [x] Validate notice-print and signature gate coverage.
- [x] Validate operations map emergency banner coverage.
- [x] Run full Star Trek Phase 4 gate suite and capture evidence.
- [x] Capture evidence in staging snapshot with command outputs.

### Phase F Completion Gate Checklist

- [x] Phase E gate confirmed green.
- [x] Star Trek Phase 3 specs pass — translation boundaries and role-path redirects verified.
- [x] Star Trek Phase 4 specs pass — translated audio relay and emergency surfaces verified.
- [x] Build/lint/tests pass for all F slices.
- [x] Phase F completion snapshot recorded in staging docs.

### Phase G Entry Check (Go/No-Go)

- [x] Confirm Phase F gate is explicitly green in staging evidence.
- [x] Confirm Phase A gate is explicitly green (org isolation + bootstrap routes).
- [x] Confirm canary rollout progression is at confirmed safe milestone.

### Phase G (Production Readiness + Canary Rollout)

Timeline reference: Post-Phase-E production advancement

#### G1 Canary Rollout Validation

Owner: Platform Architecture Lead

- [x] Revalidate Phase A gate criteria (org isolation, bootstrap routes, route/role truth).
- [x] Confirm feature-flag rollout percentages for Phase B slices are at 100% or documented hold.
- [x] Run Star Trek full canonical gate to confirm rollout confidence.
- [x] Capture evidence in staging snapshot with command outputs.

#### G2 Build Budget and Drift Health

Owner: Data Platform Lead

- [x] Confirm total JS build budget is within ceiling (8000 kB per `scripts/check-build-budgets.mjs`).
- [x] Confirm no new direct-query drift has appeared in E1 target pages.
- [x] Run `bun run build` and budget check to confirm production build health.
- [x] Capture evidence in staging snapshot with command outputs.

### Phase G Completion Gate Checklist

- [x] Phase F gate confirmed green.
- [x] Phase A org isolation gate remains green.
- [x] Build budget within ceiling; no new E1 drift.
- [x] Star Trek canonical lane passes across all phases (1-4).
- [x] Phase G completion snapshot recorded in staging docs.

### Required Evidence for Every Slice (C1-C4, D1-D3)

- [x] `bun run build`
- [x] `bun run lint`
- [x] Slice-focused test command(s) recorded with result
- [x] `docs/STAGING.md` updated with timestamp, scope, validation table, and impact
- [x] Decision or contract changes mirrored in `docs/DECISIONS.md` when applicable

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