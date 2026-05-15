# Star Trek Phased Rollout Plan

Date: 2026-05-12
Owner: Platform Architecture Lead + Bob Platform Lead
Status: All four phases COMPLETE — browser E2E confirmed PASS 5/5 all phases (2026-05-15, native Chromium)
Linked staging control: docs/STAGING.md
Instruction checkpoint policy: docs/INSTRUCTION_MANUAL.md (section 1b)

## Purpose

This plan defines a four-phase rollout called Star Trek and binds each phase to:

1. A checkpoint validation test.
2. A required update in docs/STAGING.md.
3. A required update in docs/INSTRUCTION_MANUAL.md.

No phase may move to the next phase until all three are completed.

## Non-Regression Guard (Mandatory During Consolidation)

While routes, RLS, and module structure are being consolidated, Bob's actionable control paths must remain operational:

1. Message control path (`ask-bob`, Bob studio/proposal flows) must continue to resolve valid organization scope and execute approved actions.
2. Voice control path (wake word + PTT-linked Bob intercom and command extraction) must remain usable for field operations.
3. Any access-control refactor must use shared restriction gates, not remove Bob's approved write-actuation workflow.
4. If a security hardening change would block Bob actionability, the change must be shipped with an equivalent approved path in the same release.

## Phase 1: The Director (Roster and Access Gate)

Objective: establish Bob as gatekeeper so no officer enters tactical workflows without active assignment.

### Implementation

1. Roster-to-route handshake:
   - Add middleware guard in src/middleware.ts.
   - Validate active roster_shifts record for current officer.
   - If none exists, redirect to welfare-only standby screen.
2. Morphing portal:
   - Default-hide tactical modules in field officer portal.
   - Inject module access only when site_user_permissions grants access for client_site_id.
3. Pre-shift window:
   - Apply 15-minute pre-shift buffer.
   - During pre-shift, allow only Radio (PTT) and Emergency tools.

### Check and Balance

- Log in as non-rostered guard.
- Expected: no tactical data, only Emergency path available.

### Required Checkpoint Doc Updates

1. STAGING.md:
   - Add session snapshot with command evidence and PASS/FAIL.
2. INSTRUCTION_MANUAL.md:
   - Update officer login/navigation behavior for welfare-only standby and pre-shift mode.

## Phase 2: The Universal Translator (Voice and Audio Logic)

Objective: enable eyes-up operations where Bob translates and communicates without reading the screen.

### Implementation

1. Dual-path audio:
   - Stream A: co-worker PTT.
   - Stream B: Bob intercom.
   - Wake word for Bob, hold-to-talk for co-workers.
2. Audio ducking:
   - When Bob speaks, reduce co-worker channel to 20 percent.
3. Bidirectional cloning:
   - RunPod worker synthesizes translated output in original speaker voice.

### Check and Balance

- Send English radio transmission.
- Expected: receiving foreign-language officer hears translated cloned voice, with original chatter ducked.

### Required Checkpoint Doc Updates

1. STAGING.md:
   - Add evidence block for translation + ducking validation.
2. INSTRUCTION_MANUAL.md:
   - Update PTT and Bob audio behavior sections for dual stream, wake word, and ducking rules.
3. Regression evidence:
   - Include proof that Bob voice and Bob message command paths still execute at least one approved operational action end-to-end.

## Phase 3: The Sentient XO (Memory and Administrative Actuation)

Objective: give Bob persistent memory and voice-operated administrative actuation.

### Implementation

1. Persistent mind:
   - Activate bob_user_memory usage in live workflows.
   - Persist user identity, site history, and friction events.
2. Admin actuation:
   - Allow Bob to create records through validated command-to-SQL workflow.
   - Example intent: create new client site.
3. Gap detection:
   - If mandatory command fields are missing, Bob must ask for missing inputs before write.

### Check and Balance

- Issue voice command for record creation.
- Expected: Supabase row exists with correct fields and no manual typing.

### Required Checkpoint Doc Updates

1. STAGING.md:
   - Add audit evidence for command, validation, and successful write.
2. INSTRUCTION_MANUAL.md:
   - Update Bob operations section with memory behavior, actuation permissions, and missing-data prompt logic.
3. Regression evidence:
   - Include proof that RLS/policy changes did not break Bob command-to-action workflows.

## Phase 4: The Admiral's Bridge (Welfare and Enforcement)

Objective: provide manager-level tactical visibility and human-in-the-loop legal control.

### Implementation

1. Live tactical map:
   - Real-time Mapbox overlay in admin portal from user_locations.
   - Highlight skyving and welfare alerts.
2. Safety dossier:
   - Before site arrival, Bob queries historical observations and vocalizes friction/aggression risk for last 24 hours.
3. Fire control key:
   - Bob drafts enforcement output.
   - Officer must provide on-screen digital signature to authorize and print.

### Check and Balance

- Trigger armed-danger keyword.
- Expected: admin map pulses red and emergency channel broadcasts officer GPS.

### Required Checkpoint Doc Updates

1. STAGING.md:
   - Add emergency alert evidence and human-authorization proof.
2. INSTRUCTION_MANUAL.md:
   - Update admin tactical map, welfare escalation, and enforcement signature authorization steps.

## Technical Status Inference Anchors

1. fieldops-ai-engine running and available for Phase 3 memory/actuation logic.
2. fieldops-ollama active on port 11434 for translation workflows.
3. site_user_permissions is the source of truth for Phase 1 module gating.

## Exit Criteria

## Phase 0 Integration: Bob Governance for Radio Floor Control and Emergency Override

**Status**: Documented (2026-05-15) — implementation begins Phase 0-1 (2026-05-21)

Phase 0 (Radio Platform Redesign: PTT → Professional Radio with Live Translation) requires Bob governance
integration at two critical control points. This section defines how Star Trek Bob capabilities (Phases 1–4)
bind to Phase 0 floor control and emergency override.

### Bob Floor Control Integration (Phase 0-1, mapped to Star Trek Phase 3 — Sentient XO)

Bob acts as the governance agent for radio floor acquisition and release:

1. **Floor acquire path**: When an officer requests the radio floor, the request routes through Bob's
   proposal/approval contract (D1, Phase D). Bob validates: active shift roster (Phase 1 Director gate),
   org-scoped channel access, and absence of higher-priority transmission.
2. **Floor release**: Bob can forcibly release a floor token on supervisor instruction or inactivity timeout
   (Redis TTL). The release action is logged to `radio_floor_events` with Bob as `operator_id`.
3. **Bob command surface**: Officers can request floor control via voice command through Star Trek Phase 3
   (Sentient XO) — `textarea[placeholder*="Ask Bob"]` interface at `/bob-assistant`. Bob maps the request
   to a `radio-floor-acquire` Edge Function call with org context.
4. **Non-regression requirement**: Star Trek Phase 3 gate (`phase3-sentient-xo.spec.ts`) must remain green
   through all Phase 0-1 to Phase 0-5 implementation sprints. If Bob actuation breaks, Phase 0 work stops.

### Emergency Override Path (Phase 0-1, mapped to Star Trek Phase 4 — Admiral's Bridge)

Emergency radio override follows the Star Trek Phase 4 human-in-the-loop fire control pattern:

1. **Override trigger**: Supervisor activates armed-danger toggle (`#bob-danger-auto-assist` in
   `BobAssistantStudio`) or issues voice command via Star Trek Phase 2 (Universal Translator) wake word.
2. **Bob approval contract**: Emergency floor override is routed through Bob's D1 approval chain. Bob
   drafts the override action; supervisor confirms with digital authorization (Phase 4 fire control key).
3. **Event fanout**: Approved override emits `{ type: "floor_override", operator_id, reason, timestamp }`
   to Redis `radio:floor:org:{org_id}:channel:{channel_id}` and persists to `radio_floor_events` audit table.
4. **Admin tactical map**: Override is visible in real-time on the tactical map at `/live-tracking`
   (Star Trek Phase 4 Admiral's Bridge). Admin map pulses to indicate emergency channel activity.
5. **Non-regression requirement**: Star Trek Phase 4 gate (`phase4-admirals-bridge.spec.ts`) must stay
   green. Emergency escalation without Bob approval is not permitted.

### Phase 0 Bob Governance: Summary of Control Points

| Phase 0 Sub-Phase | Bob Capability Required | Star Trek Gate | Non-Regression Spec |
|---|---|---|---|
| Phase 0-1 (SFU + Floor Control) | Floor acquire/release via proposal contract | Phase 3 (Sentient XO) | `phase3-sentient-xo.spec.ts` |
| Phase 0-1 (Emergency Override) | Fire control key + admin map alert | Phase 4 (Admiral's Bridge) | `phase4-admirals-bridge.spec.ts` |
| Phase 0-2 (STT + Captions) | Bob audio wake word + ducking | Phase 2 (Universal Translator) | `phase2-universal-translator.spec.ts` |
| Phase 0-3 (Translation Layer) | Bob translation command routing | Phase 3 (Sentient XO) | `phase3-sentient-xo.spec.ts` |
| Phase 0-4 (Translated Audio Relay) | TTS relay with voice profile consent | Phase 4 (Admiral's Bridge) | `phase4-admirals-bridge.spec.ts` |
| Phase 0-5 (Voice-Twin Governance) | Voice-twin enrollment consent actuation | Phase 3 + Phase 4 | Both spec files |

### Linked ADRs

- [ADR-007: Event Backbone for Floor Control](adr/007-event-backbone-floor-control.md) — Redis + Supabase floor signaling
- [ADR-008: Voice-Twin Governance](adr/008-voice-twin-governance.md) — Three-tier consent (Tier 2 enablement via Bob Phase 3/4)
- [ADR-014: Star Trek Phased Rollout](adr/014-star-trek-phased-rollout.md) — Phase 3 and Phase 4 Bob capability anchors

---

## Exit Criteria

Star Trek rollout is complete only when all are true:

1. Phase 1 through Phase 4 check-and-balance tests are all PASS.
2. Every phase has a matching STAGING session evidence entry.
3. INSTRUCTION_MANUAL has been updated at each phase checkpoint with role-facing behavior changes.
4. No open blocker remains in STAGING for roster gating, audio safety, Bob actuation, or emergency escalation.
