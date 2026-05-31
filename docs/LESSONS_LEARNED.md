# Lessons Learned

Use this file to record concrete mistakes Bob and Dr Bob found during adversarial review or failed executions.

## Entry Template

- Date: YYYY-MM-DD
- Trigger: command, review, or failure source
- Mistake: what Bob got wrong
- Risk: why it mattered
- Fix: what changed
- Prevention Rule: what Bob must do next time

## Current Lessons

- Date: 2026-05-30
- Trigger: Broad timeout audit across user management and notice/dispatch flows after repeated "timed out" reports.
- Mistake: Multiple pages wrapped edge-function mutations with local `Promise.race` timeouts shorter than the shared edge timeout/retry layer, causing premature UI failures before edge fallback logic completed.
- Risk: False timeout errors, unnecessary fallback execution, duplicate retries, and noisy operator experience in high-latency periods.
- Fix: Increased local edge-call wrappers in `src/pages/UserManagement.tsx`, `src/pages/InfringementNotices.tsx`, `src/pages/DispatchConsole.tsx`, `src/pages/PhotoReingest.tsx`, and `src/pages/TenderReferenceLibrary.tsx` so local timers no longer preempt shared edge handling.
- Prevention Rule: Any page-level timeout around `edgeFunctions.*` must be greater than the shared edge timeout budget (or removed) to avoid double-timeout races.

- Date: 2026-05-30
- Trigger: Follow-up tree review after timeout-storm mitigation on Platform health polling.
- Mistake: Secondary health status consumers (`OfficerShell`, `HealthBanner`, `SystemHealthIndicator`) still used `inferenceService.checkServicesHealth()` without in-flight dedupe/cache, so concurrent poll windows could still fan out duplicate edge health calls.
- Risk: Repeated background health calls can amplify transient edge slowdowns into user-visible degradation and unnecessary load.
- Fix: Added in-flight request dedupe plus short success TTL and error backoff cache in `src/lib/inferenceService.ts` so concurrent pollers share one request path.
- Prevention Rule: Any shared health helper used by multiple components must include dedupe + cache/backoff and avoid per-component transport retries/toasts.

- Date: 2026-05-30
- Trigger: Platform header repeatedly showed "Edge function request timed out after 35s" while live polling was active.
- Mistake: Multiple independent health pollers queried the same `check-services-health` edge function concurrently, then surfaced the raw timeout string directly in UI status labels.
- Risk: Timeout storms created noisy degraded UX, repeated edge load, and misleading incident signals even when core app routes remained usable.
- Fix: Added client-side health-call in-flight dedupe + short TTL caching + timeout backoff in `src/lib/proxyServices.ts`, unified Bob health query keys to share React Query cache in `src/hooks/usePTTAutoConnect.ts`, and normalized timeout text in `src/components/features/AppLayout.tsx`.
- Prevention Rule: Any background health polling must share a single request path with dedupe/cache/backoff and must never render raw transport timeout text directly to users.

- Date: 2026-05-24
- Trigger: User directive to stop non-coding auto-closures and teach Dr Bob endpoint/env/load/wiring triage.
- Mistake: Non-coding incidents (endpoint URL mistakes, API-key-vs-URL confusion, env misconfiguration, failed-load signatures, and wrong wiring direction) could be returned as `resolve` by model output and applied too early.
- Risk: Premature closure hides infrastructure root causes and creates false confidence while failures continue.
- Fix: Enforced triage-first policy in rerun workflow: all non-coding lanes stay open (`keep_open`/`investigating` unless explicit human escalation), with structured `nonCodingType`, `nextAction`, and `evidenceRequired` fields persisted in `ai_analysis`.
- Prevention Rule: For endpoint/env/load/wiring/API-vs-URL issues, always classify as non-coding triage lane, require rerun + config evidence, and never auto-resolve on first-pass AI output.

- Date: 2026-05-24
- Trigger: Needs-human backlog review (`requires_human_review=true`) showed 111 open items, with 108 from Vercel emulator runs and 103 titled `FAILED_LAUNCH`.
- Mistake: Dr Bob treated environment launch failures (browser/app boot instability in emulator context) as product bug regressions and kept them in human-review queues.
- Risk: Human triage load balloons with non-product incidents, masking real app defects and delaying root-cause fixes.
- Fix: Added autonomous closeout staging and explicit remediation-closeout wiring; reinforced triage rule that emulator launch failures must be classified as infrastructure/runtime incidents first, then retried before filing product bug conclusions.
- Prevention Rule: If failure signature is `FAILED_LAUNCH`, connection refusal, or worker bootstrap error, classify as runtime/infrastructure and rerun environment checks before escalating as product bug.

- Date: 2026-05-24
- Trigger: Dr Bob escalation queue reached 42 needs-human entries dominated by `blocker-findings` and `unstructured-review` outcomes.
- Mistake: Review artifacts were escalated when proposals were not clearly grounded in `system_state.json` and when Dr Bob response formatting drifted from strict JSON.
- Risk: Escalation queue becomes stale/noisy; autonomous healing appears inactive despite repeated runs.
- Fix: Reinforced stage-gated closeout flow plus explicit guidance to rerun with strict grounding and strict JSON output contract before human handoff.
- Prevention Rule: Dr Bob must fail-fast on ungrounded module references, mark future-state items as proposed, and always return strict JSON schema output for every review pass.

- Date: 2026-05-12
- Trigger: Live-user reports — PTT not requesting permissions on first load and "PTT server unavailable" for regular officers.
- Mistake: `getPlatformAdminFallbackScope()` had a `role !== 'grand_master'` guard that blocked the zone-error recovery path for all other roles. PTTRadio auto-connect only fired for `dispatch`/`direct` modes. No automatic microphone permission prompt existed on page mount.
- Risk: Officers arriving at the radio page saw no browser permission dialog, no active channel connection, and an unrecoverable "unavailable" state whenever the PTT server reported a zone mismatch — effectively making PTT non-functional for first-time users.
- Fix: Removed role guard from `getPlatformAdminFallbackScope` (all org users get zone bypass); added mount-time `requestMicrophoneAccess()` effect in PTTRadio; changed initial auto-connect to fire for all radio modes.
- Prevention Rule: PTT availability must not depend on geofence state. Zone errors must always fall back to `org:<orgId>` scope for any user with an org assignment. Microphone permission must be requested on every first-mount of PTT pages.

- Date: 2026-05-11
- Trigger: Human-modules remediation lanes (`ui-comprehensive`, `human-module-interaction`) during six-hour staging review.
- Mistake: Several E2E assertions treated role-guard redirects (`/portal-selection`, `/login`) as failures even when they were valid outcomes for the authenticated role/session state.
- Risk: Persistent false-red pipelines, long rerun cycles, and misleading triage that blames route regressions instead of expected access-control behavior.
- Fix: Added role-aware fallback handling in navigation helpers and scenario assertions; preserved strict expectations only where access must exist for the test intent.
- Prevention Rule: For guarded routes, assertions must explicitly encode both expected privileged state and valid guard fallback state.

- Date: 2026-05-11
- Trigger: Mobile human interaction sweep timeout and malformed fill failures.
- Mistake: Generic input interaction attempted free-text fills on date/time controls and used full-page screenshots on long sweeps, increasing timeout pressure.
- Risk: Non-deterministic failures unrelated to product regressions, especially on constrained mobile browser runs.
- Fix: Skipped date/time-like input types for generic text fill and switched sweep screenshots to non-blocking viewport capture with extended per-test timeout.
- Prevention Rule: Generic form-fuzz helpers must respect input-type semantics and keep media capture bounded for long-route sweeps.

- Date: 2026-05-09
- Trigger: External NZ case study (Stuff, Laura Frykberg, 2026-05-08) describing ANPR-based parking notices issued to drivers who made separate short visits that were incorrectly merged into one overstay event.
- Mistake: AI/computer-vision enforcement flow treated entry/exit snapshots as sufficient proof of a continuous parking stay, without proving stationary occupancy, multi-visit disambiguation, or evidentiary completeness.
- Risk: false infringement notices, unfair customer burden to disprove machine output, regulatory exposure under Fair Trading obligations, and trust erosion in compliance automation.
- Fix: adopt evidence-first enforcement logic for Bob-assisted compliance decisions: (1) no penalty recommendation without verifiable parking-state evidence, (2) detect and split same-day multi-visit patterns before duration calculation, (3) provide transparent appeal evidence bundle by default.
- Prevention Rule: Bob must never treat ANPR timing pairs alone as conclusive liability; require corroboration (parking-state proof, site context, duplicate-journey checks) and downgrade uncertain cases to human review with explainable evidence gaps.

- Date: 2026-05-07
- Trigger: Playwright Bob UI regression (`tests/e2e/governance-bob-regression.spec.ts`) showing blank `/login` and `/bob` pages.
- Mistake: duplicate `/open-shifts` entries existed in both `src/navigation/routeManifest.ts` and `src/App.tsx`, causing route manifest validation to throw during app boot.
- Risk: full app startup failure in dev/prod, blank-page regressions, and misleading route-level debugging.
- Fix: removed duplicate route ID/path registrations and revalidated startup plus Bob/login route tests.
- Prevention Rule: when adding routes, run a manifest uniqueness check (routeId + path) and verify startup in browser before running deeper feature tests.

- Date: 2026-05-07
- Trigger: Browser console/runtime errors on Bob Assistant (`Cannot read properties of undefined (reading 'toFixed')`) and CSP warnings in production.
- Mistake: render path assumed numeric values (`speechRate`, `confidence`) were always defined; CSP policy did not include Vercel feedback script origin.
- Risk: render crashes in `BobAssistantStudio`, error-boundary fallbacks, and noisy console warnings that hide real defects.
- Fix: guarded `toFixed` calls with null-safe defaults, added migration fallback for speech rate, updated CSP `script-src` with `https://vercel.live`, and added `mobile-web-app-capable` meta tag.
- Prevention Rule: every user-controlled or persisted numeric render value must have a safe default, and CSP updates must accompany any newly introduced third-party script origins.

- Date: 2026-05-04
- Trigger: Repeated synthetic monitor bug-report bursts (#483-#502).
- Mistake: health workflow treated Bob provider degradation as a full platform outage even when frontend, Supabase, and Playwright checks passed.
- Risk: issue-noise floods, alert fatigue, and triage cycles spent on non-actionable platform incidents.
- Fix: updated `.github/workflows/synthetic-monitor.yml` so Bob degradation is flagged as warning-only when core app checks are healthy.
- Prevention Rule: synthetic reliability checks must classify core availability separately from optional/auxiliary provider quality signals.

- Date: 2026-05-04
- Trigger: `bun run build` failure in `src/components/features/AppLayout.tsx` after breadcrumb label map addition.
- Mistake: `new Map(...)` resolved to the imported Lucide `Map` icon symbol, not the global constructor.
- Risk: hard build failure on `main` and blocked release validation.
- Fix: switched constructor call to `new globalThis.Map(...)` and re-ran lint/build.
- Prevention Rule: when a file imports symbols that shadow built-ins (e.g., `Map`, `Set`), use `globalThis.*` for constructors in shared layout code.

- Date: 2026-04-28
- Trigger: Visual regression route assertion for `/roster` during stabilization run.
- Mistake: test expectation assumed `RosterPlanner` heading without validating actual route-to-component wiring.
- Risk: false red test loops, wrong fixes, and churn from patching symptoms instead of source-of-truth behavior.
- Fix: validated route mapping in `src/App.tsx`, aligned expectation to actual routed page behavior, and codified pre-change intent checks in Bob instructions.
- Prevention Rule: before any edit, confirm existence, role behavior, expected UI result, destination/next step, and success/failure outcomes against real routes/components.

- Date: 2026-04-23
- Trigger: `node scripts/dr-bob-review.mjs --file docs/BOB_TRAINING_ADVANCED_ARCHITECT_2026.md --type plan`
- Mistake: architecture guidance referenced ungrounded module placeholders without matching `system_state.json` evidence.
- Risk: Bob can invent module structure and mislead implementation planning.
- Fix: added blocker review flow, truth protocol checks, and failure summarization.
- Prevention Rule: any module path not grounded in repo files or `system_state.json` must be treated as unverified and blocked.

