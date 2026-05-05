# Decisions

This file is the historical memory for Bob and Dr Bob.

When a pattern, platform, or architectural decision changes, append a dated note here before asking Bob to extend that area.

## Decision Entry Template

- Date: YYYY-MM-DD
- Decision: one sentence
- Scope: files, services, or modules affected
- Reason: why the decision was made
- Consequences: follow-on constraints Bob must respect

## Current Standing Decisions

- Date: 2026-04-28
- Decision: Bob must run a Change Intent Validation Gate before editing code.
- Scope: all bug fixes, test updates, route changes, and feature work.
- Reason: prevent logical mismatches between route intent, rendered component, role access, expected outcome, and follow-on user flow.
- Consequences: each change must verify: (1) should this item exist here, (2) how it should work, (3) expected visible result, (4) where it goes next, and (5) next behavior on success and failure.

- Date: 2026-04-23
- Decision: Bob must read `system_state.json` before making redesign or new-module claims.
- Scope: architecture advice, `/chat`, `/code/task`, Dr Bob review, truth broadcaster.
- Reason: prevent hallucinated modules, package-manager drift, and ungrounded implementation plans.
- Consequences: any invented module path or ungrounded feature reference is a blocker and scores `0/10` in response logs.

- Date: 2026-04-23
- Decision: Major redesigns follow `spec.md` then self-critique then `plan.md` before implementation.
- Scope: Bob planning, Dr Bob review, architecture prompts, future CI review gates.
- Reason: force grounded design before code generation.
- Consequences: `scripts/review-architecture-artifacts.mjs` should run before implementation claims on major work.

- Date: 2026-05-05
- Decision: Bob conversation memory and preferences are scoped per-user, not per-org.
- Scope: `src/stores/bobStore.ts`, `src/stores/bobAssistantStore.ts`, `src/hooks/useBobConversation.ts`, `src/hooks/useBobIdentitySettings.ts`, `src/lib/bobConversationService.ts`, `supabase/functions/onspace-ai-chat/index.ts`, migrations `20260505000001` and `20260505000002`.
- Reason: Multiple officers sharing a device were seeing each other's Bob history and voice identity settings. User-level scoping prevents bleed between users on the same organization.
- Consequences: All Bob reads/writes must include `user_id = auth.uid()` predicate. Org-level policy toggles (e.g. `bob_voiceprint_enrollment_allowed`) live on `organizations` and are enforced in `useBobIdentitySettings` before any enrollment action. Never revert to org-only RLS for Bob tables without revisiting multi-user device safety.

- Date: 2026-05-05
- Decision: RunPod Serverless Dockerfile default CMD must start a long-running handler process; never a one-shot test runner.
- Scope: `runpod-worker/Dockerfile`, `runpod-worker/start_mode.sh`, `runpod-worker/start.sh`, `runpod-worker/handler.py`.
- Reason: RunPod Serverless requires the container to stay alive and poll jobs via `runpod.serverless.start({"handler": handler})`. Using a one-shot command as CMD causes `test_input.json not found, exiting` failures and no job processing.
- Consequences: Boot chain must remain: start_mode.sh → start.sh → `exec python3 handler.py` → `runpod.serverless.start(...)`. Do not replace CMD with a one-shot command, a bare test runner, or a pod-style always-on webserver without ensuring the handler loop is the final process.
