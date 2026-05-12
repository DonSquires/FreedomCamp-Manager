# Star Trek Phased Rollout Plan

Date: 2026-05-12
Owner: Platform Architecture Lead + Bob Platform Lead
Status: Active rollout blueprint
Linked staging control: docs/STAGING.md
Instruction checkpoint policy: docs/INSTRUCTION_MANUAL.md (section 1b)

## Purpose

This plan defines a four-phase rollout called Star Trek and binds each phase to:

1. A checkpoint validation test.
2. A required update in docs/STAGING.md.
3. A required update in docs/INSTRUCTION_MANUAL.md.

No phase may move to the next phase until all three are completed.

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

Star Trek rollout is complete only when all are true:

1. Phase 1 through Phase 4 check-and-balance tests are all PASS.
2. Every phase has a matching STAGING session evidence entry.
3. INSTRUCTION_MANUAL has been updated at each phase checkpoint with role-facing behavior changes.
4. No open blocker remains in STAGING for roster gating, audio safety, Bob actuation, or emergency escalation.
