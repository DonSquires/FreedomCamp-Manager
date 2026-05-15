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

- Date: 2026-05-15
- Decision: Bob automation must authenticate as a dedicated service account and persist dual attribution (`user_id` + `operator_id`) for every ledger write.
- Scope: `proxy-server/lib/bobSystemAuth.js`, `proxy-server/server.js`, `proxy-server/.env.example`, `docs/ENVIRONMENT_VARIABLES.md`, `supabase/migrations/20260514233156_bob_system_ledger.sql`, `inference-service/lib/bob-agent-ledger.js`, `inference-service/server.js`, `src/lib/bobEngine.ts`.
- Reason: Service-account auth removes ad-hoc impersonation, enables uniform JWT enforcement in gateway paths, and provides deterministic Bob-vs-human forensic visibility.
- Consequences: Deployments must set `BOB_SYSTEM_EMAIL` and `BOB_SYSTEM_PASSWORD` in server-side environments, keep rotating Bob session tokens at runtime, and populate `operator_id` on all `bob_system_ledger` writes.

- Date: 2026-05-14
- Decision: Star Trek + Bob automation memory must be persisted as a reusable runbook with canonical command flow and known-fix patterns so Bob can continue without session retraining.
- Scope: `scripts/staging-star-trek-bob-check.sh`, `package.json` (`staging:star-trek:bob:check`), `docs/STAGING.md`, `tests/e2e/phase3-sentient-xo.spec.ts`, `tests/e2e/phase4-admirals-bridge.spec.ts`, `tests/e2e/auth.ts`.
- Reason: Session-by-session retelling was slowing automation and causing repeated diagnosis of the same Alpine/Chromium and auth-selector issues.
- Consequences: Bob automation must start with `npm run staging:star-trek:bob:check` as the canonical gate. If Chromium is unavailable, the non-browser fallback path is valid and should not be treated as a failure. Every major stabilization outcome must be recorded in `docs/STAGING.md` with: command used, result, and fix pattern.

- Date: 2026-05-12
- Decision: PTT access must never be gated by geofence/zone membership — zone-bypass fallback applies to all authenticated users with an org ID, not only grand_master.
- Scope: `src/lib/ptt.ts` (`getPlatformAdminFallbackScope`), `src/pages/PTTRadio.tsx` (auto-connect + mic permission prompt).
- Reason: Live-user reports showed officers on first load received no microphone permission prompt and PTT was blocked with "PTT server unavailable" when the PTT server returned a "no active client zone" error. Regular officers had no bypass path; only grand_master could recover.
- Consequences: `getPlatformAdminFallbackScope` must return `org:<orgId>` for any authenticated user. Auto-mic prompt and auto-channel-connect on mount must remain in PTTRadio. Location data (GPS → street address) is visual-only and must never gate PTT channel access.

- Date: 2026-05-11
- Decision: Human-modules Playwright suites must treat `/portal-selection` and `/login` as valid guarded fallback states unless the specific scenario explicitly requires in-page privileged UI.
- Scope: `tests/e2e/ui-comprehensive.spec.ts`, `tests/e2e/human-module-interaction.spec.ts`, role-gated route assertions, and remediation lanes for human-modules approvals.
- Reason: Recent runs showed repeated false-negative failures caused by role/portal guards and transient auth redirects being asserted as hard route regressions.
- Consequences: New or updated UI E2E flows must (1) resolve portal selection by target area where possible, (2) allow guarded fallback states when appropriate, and (3) only hard-fail on access denials when scenario intent expects access.

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
