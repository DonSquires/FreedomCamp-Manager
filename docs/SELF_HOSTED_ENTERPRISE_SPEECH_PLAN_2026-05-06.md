# Self-Hosted Enterprise Speech Stack Plan

Date: 2026-05-06
Owner: Master Systems Manager
Status: Proposed execution plan
Related spec: `docs/SELF_HOSTED_ENTERPRISE_SPEECH_SPEC_2026-05-06.md`

## Bob Assistant User-Only Policy

1. Bob assistant behavior is strictly user-scoped, not organization-scoped.
2. A user's access to Bob speech capabilities must follow the authenticated user identity, even if that user moves between organizations.
3. Organization context may be carried as optional metadata for analytics or routing hints only, never as an access restriction.

## Goal

Execute a modular, enterprise-grade speech platform for Bob using the whole stack:

1. Client wake-word and capture adapters.
2. hPanel speech router.
3. RunPod inference endpoints.
4. Supabase policy, audit, and RLS.
5. Existing Bob execution governance.
6. Existing staging and release gates.

## Principles

1. Reuse the current estate before adding new infrastructure.
2. Railway hosts two active services: the proxy and the Ollama instance. Use Railway Ollama for intent inference before provisioning new RunPod endpoints.
3. Keep PTT and speech aligned on hPanel where low-latency control is needed.
4. Keep GPU-heavy inference on RunPod until there is verified in-house GPU capacity.
5. Ship advisory speech safely before enabling execution flows.

## Workstreams

### Workstream A: Architecture and contracts

Deliverables:

1. Final speech API contract for `speech-to-intent` and `tts`.
2. Auth and user-context threading model.
3. Confidence and confirmation policy matrix.
4. Sequence diagrams for web, mobile, and PTT-triggered speech flows.

Files to update:

1. `docs/MODULAR_SPEECH_STACK_RUNBOOK.md`
2. `docs/STAGING.md`
3. `docs/DEPLOYMENT_GUIDE.md`
4. `docs/ENTERPRISE_PAIR_REVIEW_CANONICAL.md`

### Workstream B: hPanel control plane

Deliverables:

1. Production-ready speech-router deployment on hPanel.
2. Health checks, logs, and restart policy.
3. Secret placement and runtime contract for STT, intent, and TTS providers.

Files and services:

1. `ops/speech-intent/`
2. hPanel deployment scripts and service registration
3. `docs/PTT_SELF_HOSTED_OPERATIONS_STANDARD.md`

### Workstream C: RunPod inference modules

Deliverables:

1. STT endpoint contract and model selection.
2. Intent endpoint contract with JSON schema output.
3. Optional TTS endpoint for higher-quality synthesis.

Files and services:

1. `inference-service/`
2. `runpod-worker/`
3. `README_RUNPOD.md`
4. `docs/BOB_ENV_REFERENCE.md`

### Workstream D: Supabase auth, audit, and policy

Deliverables:

1. Edge shim that authenticates and forwards to speech-router.
2. Audit/event persistence for transcript and intent review.
3. Policy checks for user context and future execution contracts.

Files and services:

1. `supabase/functions/`
2. future `radio_*` and Bob audit tables where required
3. `src/lib/edgeFunctions.ts`

### Workstream E: Client and mobile experience

Deliverables:

1. Wake-word adapter abstraction.
2. Audio capture UX with haptic and visible state.
3. Advisory response rendering and degraded states.
4. Mobile-first production lane.

Files and services:

1. `src/pages/BobAssistantStudio.tsx`
2. `src/pages/BobStudio.tsx`
3. `mobile-app/`
4. PTT route integration where appropriate

### Workstream F: Observability and release gating

Deliverables:

1. Speech-specific metrics and dashboards.
2. CI checks for self-hosted endpoint posture.
3. Staging verification checklist for speech stack.

Files and services:

1. `.github/workflows/`
2. `scripts/`
3. `docs/STAGING.md`
4. `docs/BOB_READINESS_SCORECARD.md`

## Ticket Plan

### Ticket 1: Finalize speech contracts

1. Define request and response schemas.
2. Define confidence thresholds.
3. Define advisory-only policy for initial launch.

### Ticket 2: Harden speech-router for production

1. Add auth headers, request validation, and provider health tracking.
2. Add circuit breaking and explicit fallback results.
3. Add deployment runbook steps for hPanel.

### Ticket 3: Establish RunPod STT lane

1. Select starting Faster-Whisper model.
2. Benchmark latency and cost.
3. Record fallback behavior and failure semantics.

### Ticket 4: Establish intent JSON lane via Railway Ollama

1. Route `INTENT_URL` to Railway Ollama (`https://ollama-production-3ab0.up.railway.app`) using native Ollama `/api/generate` with JSON output.
2. Define JSON schema enforced via system prompt and response parsing.
3. Test route, role, and user-sensitive prompts against the deployed model.
4. Only provision a separate RunPod vLLM endpoint if Railway Ollama latency is unacceptable under load.

### Ticket 5: Wire Supabase edge shim

1. Authenticate caller.
2. Attach user context.
3. Persist audit event and execution review metadata.

### Ticket 6: Build wake-word adapter abstraction

1. Define client interface for local detection.
2. Implement browser adapter.
3. Implement mobile adapter.
4. Add fallback to manual activation.

### Ticket 7: Add observability and rollout gates

1. Emit latency and confidence metrics.
2. Add CI checks for endpoint posture.
3. Add staging commands and pass criteria.

### Ticket 8: Advisory pilot rollout

1. Enable read-only advisory lane for selected operators.
2. Capture intent accuracy and UX friction.
3. Do not allow automatic mutations.

### Ticket 9: Controlled execution rollout

1. Reuse Bob mutation catalog and confirmation policy.
2. Require user confirmation for mutation-capable outcomes.
3. Add focused governance regression coverage.

## Enterprise Benefits Realization

1. Frontend team gets stable speech contracts instead of SDK-specific behavior.
2. Mobile team gets a voice-first workflow without surrendering control to a vendor.
3. Platform team keeps GPU-heavy inference isolated and replaceable.
4. Operations team keeps always-on orchestration on infrastructure they already manage.
5. Compliance team keeps audit and consent anchored to authenticated users in Supabase.
6. Leadership keeps the option to move more workloads on-prem or VPS-side later.

## Risks and Mitigations

1. Risk: hPanel becomes a new bottleneck.
   Mitigation: keep it control-plane only; offload heavy inference to RunPod.
2. Risk: wake-word accuracy is weak in the field.
   Mitigation: launch mobile-first with supervised thresholds and manual fallback.
3. Risk: speech becomes an execution bypass.
   Mitigation: route execution-capable actions through existing Bob gateway and mutation contracts.
4. Risk: observability arrives too late.
   Mitigation: no pilot without latency, failure, and confidence metrics.

## Validation Gates

1. `bun run lint`
2. `bun run build`
3. `bun run test:bob:governance`
4. speech-router health and provider checks
5. staged auth and user-scope verification for speech calls
6. updated canonical docs and staging guidance

## Done Definition

This initiative is enterprise-ready only when:

1. The whole stack is intentionally used and documented.
2. Speech is governed like Bob, not treated as a side integration.
3. Operators can trust degraded behavior and confirmation rules.
4. Docs, staging, and release gates all reflect the final design.