# Decisions

This file is the historical memory for Bob and Dr Bob.

When a pattern, platform, or architectural decision changes, append a dated note here before asking Bob to extend that area.

## Decision Entry Template

- Date: YYYY-MM-DD
- Decision: one sentence
- Scope: files, services, or modules affected
- Reason: why the decision was made
- Consequences: follow-on constraints Bob must persist

## Current Standing Decisions

- Date: 2026-05-10
- Decision: Bob patrol and dispatch intelligence must use deterministic pre-classification and plan verification before automating historical data placement.
- Scope: `src/lib/bobSetupBlueprint.ts`, `src/lib/historicalDispatchIntelligence.ts`, `src/lib/patrolZoneFallbacks.ts`, `src/pages/AiAnalysis.tsx`, `src/pages/BobAssistantStudio.tsx`, Edge Functions, test suites (see ADR 013).
- Reason: Raw hope-and-verify Bob workflows were failing on ambiguous job classifications (noise vs. alarm), missed facility mapping, and inconsistent timestamp handling. Pre-classification and verification loops ensure data integrity before insertion and enable Bob self-correction.
- Consequences: All historical patrol and dispatch data intake must flow through bobSetupBlueprint or historicalDispatchIntelligence preprocessing; Bob receives pre-computed compliance scores, performance diagnostics, and job type hints; verification loop auto-detects and corrects mapping mismatches; fallback patrol zones activate only when explicit boundaries are missing.

- Date: 2026-05-09
- Decision: ANPR/AI parking-duration signals are advisory evidence only and cannot be used as sole proof for infringement actions.
- Scope: Bob compliance reasoning, ANPR/parking workflows, automated notice recommendations, and appeal evidence handling.
- Reason: Real-world NZ failures showed false positives when separate short visits were merged into a single overstay without parking-state proof.
- Consequences: Every Bob-assisted enforcement recommendation must include corroboration checks (multi-visit split detection, parking-state evidence, and confidence/explainability metadata). If corroboration is missing, Bob must route to human review and explicitly state evidence gaps.

- Date: 2026-05-08
- Decision: Total JS build budget recalibrated from 7200 kB to 8000 kB.
- Scope: `scripts/check-build-budgets.mjs`.
- Reason: Sprints 31–43 collectively added ~730 kB of new pages and feature components beyond the 7200 kB baseline. The total non-exempt JS reached 7924 kB before Sprint 43 landed. Recalibrating to 8000 kB preserves budget headroom for Sprint 44+. Per-chunk budget (550 kB) remains unchanged.
- Consequences: Future sprints must not exceed 8000 kB total without a matching decision entry and re-calibration.

- Date: 2026-05-06
- Decision: Total JS build budget recalibrated from 7000 kB to 7200 kB.
- Scope: `scripts/check-build-budgets.mjs`.
- Reason: Sprint 22 + Sprint 18 new pages (DriftEventLog, InvestigationJobConfig, ZoneLegalConfigViewer, HealthSafetyReports, WelfareCheckinLog, ParkingPermitManager, plus audit log pages) added ~170 kB beyond the previous 7000 kB baseline. Per-chunk budget (550 kB) remains unchanged.
- Consequences: Future sprints must not exceed 7200 kB total without a matching decision entry and re-calibration.

- Date: 2026-05-06
- Decision: Bob must use the shared gateway plus named mutation contracts for execution-capable workflows, and execution-review metadata stays inside existing Bob memory JSONB context unless queryable schema is explicitly required.
- Scope: `src/lib/edgeFunctions.ts`, `src/lib/bobSchemaRegistry.ts`, `src/lib/bobRouteEntityMap.ts`, `src/lib/bobMutationCatalog.ts`, `src/pages/AiAnalysis.tsx`, `src/pages/BobAssistantStudio.tsx`, `supabase/functions/onspace-ai-chat/index.ts`, `supabase/functions/grandmaster-studio/index.ts`, `supabase/functions/bob-code-change-task/index.ts`, `src/lib/bobLearningMemory.ts`.
- Reason: Bob needed enterprise-grade route/schema awareness and controlled writes without arbitrary table mutation, plus a visible audit trail that fit the current schema safely.
- Consequences: Bob callers should route through the shared gateway, execution-capable calls must name an approved mutation contract, server endpoints must reject missing or mismatched contracts, and staging/deploy validation must include `bun run test:bob:governance`.

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
