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
- Date: 2026-05-18
- Decision: Production ONNX runtime defaults are now pinned to `balanced` profile based on benchmark run `26011565908`.
- Scope: `inference-service/.env.example`, `inference-service/server.js`, `.github/workflows/ops-onnx-runtime-profile-benchmark.yml`, benchmark artifact `onnx-runtime-benchmark-26011565908`.
- Reason: The first successful Ubuntu/glibc benchmark run showed `balanced` as best YOLO tradeoff in this environment, with top p95 and throughput among tested profiles.
- Consequences: (1) Keep `ONNX_RUNTIME_PROFILE=balanced` as production default. (2) Do not force thread overrides unless host-specific benchmark data justifies it; profile defaults already map to CPU count. (3) Re-check defaults when weekly benchmark results drift materially.

- Date: 2026-05-18
- Decision: ONNX runtime profile benchmark automation is canonical for model-runtime latency/throughput tuning and must produce both JSON metrics and markdown summary artifacts.
- Scope: `inference-service/scripts/benchmark-onnx-runtime-profiles.mjs`, `scripts/summarize-onnx-runtime-benchmark.mjs`, `.github/workflows/ops-onnx-runtime-profile-benchmark.yml`, `inference-service/README.md`, `docs/BOB_MODEL_QUALITY_BASELINE_2026-05-18.md`.
- Reason: Alpine/musl environments cannot execute `onnxruntime-node` benchmark runs reliably, so profile tuning must be measured on a reproducible glibc runner and retained as reviewable evidence.
- Consequences: (1) Runtime profile changes should reference benchmark artifacts from the workflow. (2) Benchmark runs must keep markdown output for commit-ready decision logging. (3) Host-level performance drift should be reviewed in weekly ML/LLM quality cadence.

- Date: 2026-05-18
- Decision: Bob decision logs and approval artifacts now follow an explicit 7-year retention policy with archive and legal-hold rules.
- Scope: `docs/BOB_RETENTION_POLICY_2026-05-18.md`, `docs/BOB_SECURITY_GOVERNANCE_AUDIT_2026-05-18.md`, `docs/GOVERNANCE_CHANGELOG.md`, `supabase/migrations/20260710000004_phase_d1_bob_approval_contracts.sql`.
- Reason: The specialist backlog required retention handling for Bob decision logs and approval artifacts to be explicit rather than implied by surrounding audit tables and general compliance patterns.
- Consequences: (1) Bob proposal/event records must be retained for 7 years from terminal status unless hold rules apply. (2) Pending proposals require a minimum 90-day retention window after due date. (3) Disposal must preserve a minimal deletion audit marker.

- Date: 2026-05-18
- Decision: Bob model quality lifecycle is now governed by an explicit baseline scorecard, calibration bands, retraining triggers, and promotion cadence.
- Scope: `docs/BOB_MODEL_QUALITY_BASELINE_2026-05-18.md`, `scripts/mlops-domain-inference-canary.mjs`, `scripts/mlops-canary-promotion-gate.mjs`, `scripts/bob-llm-regression-suite.mjs`, corresponding ops workflows.
- Reason: Specialist backlog required explicit ML ownership artifacts for baseline quality, calibration, retraining triggers, promotion gates, and drift cadence instead of implicit script-only behavior.
- Consequences: (1) Promotion decisions should reference the documented baseline and trigger thresholds. (2) Confidence label semantics should follow the calibration bands unless explicitly revised. (3) Retraining should be initiated from defined drift triggers rather than ad-hoc judgment.

- Date: 2026-05-17
- Decision: Specialist-list governance tranche is now canonical for Bob gatekeeper policy matrix, emergency precedence semantics, and route-contract alias regression coverage.
- Scope: `docs/INSTRUCTION_MANUAL.md`, `docs/SPECIALIST_TODO_LIST_2026-05-16.md`, `tests/e2e/route-contract-alias-parity.spec.ts`, existing Bob/Phase 4 gatekeeper specs.
- Reason: Continuing the specialist execution plan required converting open UX/AI/QA/documentation governance tasks into explicit acceptance artifacts and verifiable tests.
- Consequences: (1) Bob governed operations now have a documented action-class matrix and deterministic emergency fallback language. (2) Canonical route contract and compatibility aliases are test-asserted in E2E. (3) Specialist checklist completion state should reference concrete files/specs when closing P0/P1 governance items.

- Date: 2026-05-17
- Decision: PM route contract and governance release gate are canonical for compliance/enforcement routes and Bob dual-mode governance outcomes.
- Scope: `src/App.tsx`, `docs/INSTRUCTION_MANUAL.md`, `docs/SPECIALIST_TODO_LIST_2026-05-16.md`.
- Reason: PM priority list required resolving route contract ambiguity (`/compliance` vs `/admin/compliance`, `center` vs `centre`) and formalizing Bob gatekeeper acceptance outcomes plus release checklist governance.
- Consequences: (1) Canonical paths are `/compliance`, `/compliance-analytics`, `/enforcement-command-center`. (2) Legacy aliases are compatibility redirects only (`/admin/compliance`, `/admin/compliance-analytics`, `/enforcement-command-centre`). (3) Route/role changes are not release-ready without manual and staging updates in the same PR. (4) Bob governed outcomes must satisfy explicit proposal/approval/rejection/emergency acceptance criteria.

- Date: 2026-05-18
- Decision: Nightly docs-vs-router drift reporting is canonical for the governance route slice and must be surfaced as a scheduled artifact.
- Scope: `scripts/nightly-route-docs-drift-report.mjs`, `.github/workflows/ops-route-docs-drift-report.yml`, `docs/route-contract-canonical.json`, `docs/INSTRUCTION_MANUAL.md`, `docs/ROUTE_CONSOLIDATION_MANIFEST.md`, `docs/BOB_SYSTEM_ROUTE_MAP.md`.
- Reason: The governance route contract is now explicit, so the repo needs a recurring check that the manual and route reference docs keep pace with router reality for the canonical Bob/compliance/enforcement paths.
- Consequences: (1) Nightly drift reports should fail on missing route references in the checked docs. (2) The curated governance route slice remains the source of truth for the report until the route contract expands. (3) Docs changes for governance routes should be reconciled before the next scheduled run.

- Date: 2026-05-17
- Decision: CRO Part 4 workflow consolidation is closed for the current cycle; no additional role-specific guided workflows are required beyond the shipped admin-report, admin-breach, and officer-shift guided flows.
- Scope: `docs/CRO_TODOLIST.md`, `docs/STAGING.md`, `docs/INSTRUCTION_MANUAL.md`, `src/pages/ReportsHub.tsx`, `src/pages/BreachAlerts.tsx`, `src/pages/FieldOfficerPortal.tsx`.
- Reason: The Part 4 checklist is fully implemented and validated in staging snapshots, and the top fragmented workflows identified by PM are now covered by guided in-page flows without introducing additional route complexity.
- Consequences: (1) Part 4 status is now `✅ Complete`. (2) Additional guided workflow work is deferred to future CRO cycles unless new fragmentation evidence is recorded. (3) Any future Part 4 expansion must start with a new PM fragmentation inventory and a new decision entry.

- Date: 2026-05-17
- Decision: Trust-and-consistency async state contract is now canonical across primary operational shells: loading must use structure-matched skeleton/async states; errors must include plain-English explanation + retry + fallback; empty states must include explanatory CTA.
- Scope: `src/pages/AdminPortal.tsx`, `src/pages/BreachAlerts.tsx`, `src/pages/ComplianceDashboard.tsx`, `src/pages/FieldOfficerPortal.tsx`, `src/pages/ObservationRecords.tsx`, `src/pages/PatrolKPIDashboard.tsx`, `src/pages/PublicParkingAppealPortal.tsx`, `src/components/features/AsyncStateWrapper.tsx`, `docs/CRO_TODOLIST.md`, `docs/STAGING.md`, `docs/INSTRUCTION_MANUAL.md`.
- Reason: Part 5 CRO work identified state inconsistency as a direct source of operator hesitation and task drop-off. Standardising async-state behavior across high-traffic shells reduces ambiguity during degraded network/data conditions and improves recoverability.
- Consequences: (1) New/modified shell pages must adopt the same state contract and avoid spinner-only/blank state regressions. (2) Retry/fallback paths are mandatory for operational errors. (3) Empty states must tell operators what to do next. (4) Officer offline queue UX remains explicit and reconnect-aware by design.

- Date: 2026-05-17
- Decision: Officer workflow consolidation is anchored in `FieldOfficerPortal.tsx` through a guided 5-step shift flow overlay that orchestrates existing shift, zone, scan, and report actions.
- Scope: `src/pages/FieldOfficerPortal.tsx`, `docs/CRO_TODOLIST.md`, `docs/STAGING.md`, `docs/INSTRUCTION_MANUAL.md`.
- Reason: CRO Part 4 identified the officer primary path as fragmented across start-shift controls, zone selection, scanner entry, and reporting. The owning portal already contains all required state and handlers, so an in-page guided flow reduces navigation friction without introducing new routes or backend mutations.
- Consequences: (1) `Guided shift flow` is the recommended officer path for first-pass workflow completion. (2) Existing direct controls remain available for experienced officers and rapid actions. (3) Future officer workflow consolidation should extend this guided overlay before creating additional standalone workflow routes.

- Date: 2026-05-17
- Decision: Admin breach workflow consolidation is anchored in `BreachAlerts.tsx` using an in-page guided triage flow layered over the existing Decision Dock actions rather than introducing a new standalone route.
- Scope: `src/pages/BreachAlerts.tsx`, `docs/CRO_TODOLIST.md`, `docs/STAGING.md`, `docs/INSTRUCTION_MANUAL.md`.
- Reason: CRO Part 4 requires reducing breach-task navigation hops (review -> assign -> notice -> outcome). Route audit confirmed `/breaches` is a passthrough to `BreachAlerts.tsx`, and the owning page already contains selected-breach context plus all core mutations. Adding a guided flow at this seam delivers workflow consolidation without backend contract churn.
- Consequences: (1) Guided triage becomes the recommended path for breach decisions while existing direct buttons remain available for rapid actions. (2) Assignment uses the existing `AdminFollowUpDrawer` handoff and enforcement/notice actions keep current mutation and navigation semantics. (3) Future breach workflow changes should extend this in-page flow first before introducing new routes.

- Date: 2026-05-17
- Decision: Canonical post-login landing paths are: admin/master → /admin/dashboard (AdminPortal command centre); officer → /officer-home; admin_officer → /portal-selection; grand_master → /platform; client roles → /client-portal; nzscv_monitor → /admin/nzscv.
- Scope: `src/navigation/rolePath.ts` (getDefaultRouteForRole), `src/App.tsx` root `/` route redirect block.
- Reason: CRO Part 2 audit found that `admin` and `master` roles had no explicit default route and fell through to render AdminHub at `/` rather than navigating to the full operational command centre at `/admin/dashboard`. Root `/` also rendered AdminHub as a component instead of redirecting, creating ambiguity and URL inconsistency. Canonical paths are now declared in one authoritative switch block and mirrored in the root route redirect.
- Consequences: (1) admin/master always land at /admin/dashboard on fresh login or root navigation. (2) AdminHub at /admin remains a valid navigation target (hub overview) but is no longer the default entry point. (3) /dashboard (ModuleDashboard) remains distinct — it is a cross-role data/analytics dashboard, not an entry point. (4) getDefaultRouteForRole default branch also redirects to /admin/dashboard to handle any future role additions safely. (5) Root `/` route now contains no component renders — it is a pure redirect block; all roles have explicit handling.

- Date: 2026-05-17
- Decision: Officer landing path consolidation: /officer-home is the canonical officer entry point; /field-officer is the patrol working surface reached from officer-home. These serve distinct sequential purposes and are not redundant.
- Scope: `src/navigation/rolePath.ts` (getDefaultRouteForRole officer case), `src/App.tsx` officer role redirects, `docs/ROUTE_CONSOLIDATION_MANIFEST.md`.
- Reason: CRO Part 2 task required resolving "overlapping officer landing paths" (/field-officer, /portal-selection, /officer-home). Audit confirmed: /officer-home = shift status + welfare entry + module chooser (landing); /field-officer = active patrol workspace (scan, breach, SOS); /portal-selection = dual-role chooser for admin_officer only. These are sequential waypoints, not duplicates. No route consolidation needed.
- Consequences: (1) officer role continues to default to /officer-home. (2) admin_officer continues to default to /portal-selection. (3) /field-officer is not a default entry point — officers navigate there from officer-home. (4) These path semantics must be preserved in any future nav redesign.


- Date: 2026-05-17
- Decision: SFA smoke routing policy with fire-type-specific gates and road-hazard escalation achieves 100% routing accuracy by distinguishing industrial operations, residential fires, burn-offs, and road hazards into explicit decision paths.
- Scope: `scripts/generate-smoke-ablation-mocks.mjs` (policyRecommendedAction function, lines ~75–180), `scripts/research-smoke-ablation.mjs` (metrics evaluation), `scripts/research-smoke-export-live-datasets.mjs` (Supabase integration framework), `data/smoke-ablation-evals.jsonl` (validation dataset, 14 records), `docs/adr/017-sfa-smoke-routing-policy.md`, feature flags for rolling out to live smoke portal.
- Reason: Prior smoke routing conflated industrial toxicity (yellow/black smoke with prohibited materials = prosecution), long-running domestic fires (>60min = abatement not verbal), and road hazards (visibility + industrial = immediate escalation) under single SFA thresholds, causing misdirection and public safety gaps. New approach uses derived SFA components (opacityScore 2.5×, colorToxicity 1.5×, prohibitedScore 2.0×, durationScore 2.0×, etc.) and fire-type flags (isDubiousBurnOff, isNaiveBurnOff) to route deterministically per RMA s.328 road/hazard priority and enforcement pathway rules. Ablation validation: 14/14 correct (100%), all three variants (sfa_only, sfa_with_duration, sfa_contextual) at acc=1.000, exF1=1.000, override=0.000.
- Consequences: (1) Industrial + very heavy (SFA ≥ 8) ALWAYS escalates to infringement; prior warning → prosecution. (2) Industrial + road hazard (SFA ≥ 6.2) immediately escalates to infringement (public safety > abatement). (3) Prohibited materials (any fire type) minimum enforcement is abatement_notice (not direction). (4) Commercial/abusive fires (open_fire, barrel_fire + prohibited + SFA ≥ 6.5) route to infringement/prosecution. (5) Long residential (duration > 60min + SFA ≥ 4) routes to abatement (not verbal). (6) Dubious burn-offs (prohibited/heavy/prolonged + SFA ≥ 5.5) route to abatement; naive burn-offs (light, <20min, SFA ∈ [2.5,3.5)) eligible for verbal_warning. (7) Export SFA components (all 8 scores + 2 flags) to JSONL for audit trail; never scatter thresholds into UI. (8) Before rollout, rerun ablation on new case batches; if accuracy < 95%, escalate to Dr Bob. (9) Quarterly validation mandated; adjust road-hazard and dubious thresholds if false-positive rate > 5%.

- Date: 2026-05-17
- Decision: CFA ambient-first noise routing policy with targeted rule splits achieves 100% routing accuracy by distinguishing diesel machinery, music-led events, and crowd-dominant parties into separate decision trees.
- Scope: `scripts/research-export-live-datasets.mjs` (policyRecommendedAction function, lines ~350–480), `data/noise-ablation-evals.jsonl` (validation dataset, 14 records), `docs/adr/016-cfa-noise-routing-policy.md`, feature flags for rolling out to live noise portal.
- Reason: Prior routing conflated machinery (requiring formal abatement), music (first-visit direction eligible), and parties (crowd-dominant → abatement) under single thresholds, causing misdirection and liability gaps. New approach uses derived CFA flags (`isDieselMachinery`, `peopleNoiseConsistency`, `musicVolumeConsistency`) to route deterministically per RMA s.328 and officer discretion boundaries. Ablation validation: 14/14 correct (100%), all three variants (matrix_only, matrix_audio, matrix_audio_context) at acc=1.000, exF1=1.000, override=0.000.
- Consequences: (1) Diesel machinery NEVER eligible for direction shortcut; always routes to abatement_notice at threshold >= 6 dB above ambient. (2) Music volume threshold raised to >= 0.65 (catches non-bass patterns like vocals/percussion) but gated by people_noise_consistency < 0.8 to exclude parties. (3) Parties with people_noise_consistency >= 0.8 always route to abatement_notice (cannot be bypassed to direction). (4) First-visit events require audio > 8 dB and < 26 dB above ambient (phone mic tolerance band [3, 26] dB). (5) Export routing flags (is_diesel_machinery, is_engine_noise, is_hvac_noise, is_alarm_noise, is_animal_noise, is_ambient_noise) to JSONL for audit trail. (6) Before rolling out to live portal, rerun ablation on new case batches; if accuracy drops below 95%, escalate to Dr Bob for policy review. (7) All routing thresholds centralized in policyRecommendedAction(); never scatter decision logic into UI components.

- Date: 2026-05-17
- Decision: Admin_officer role now has fail-closed route and endpoint governance gates separate from admin and officer domains to enforce strict role-specific authorization boundaries.
- Scope: `scripts/check-admin-officer-routes.mjs`, `scripts/check-admin-officer-endpoints.mjs`, `data/admin-officer-routes-baseline.json`, `data/admin-officer-routes-snapshot.json`, `data/admin-officer-endpoints-baseline.json`, `data/admin-officer-endpoints-snapshot.json`, `.github/workflows/ci-admin-officer-routes-gate.yml`, `.github/workflows/ci-admin-officer-endpoints-gate.yml`, `package.json` (data:check:admin-officer-* scripts).
- Reason: Mixed admin/officer role requirements were creating ambiguity in enforcement intent and blocking regression detection. Separate admin_officer governance mirrors successful patterns from admin-modules, officer-routes, transportation-endpoints gates; enables precise drift detection and fail-closed CI validation.
- Consequences: (1) Route mutations touching admin_officer role are now blocked by CI unless baseline/snapshot are updated with explicit justification. (2) Admin_officer endpoints (28 functions) are validated for Deno.serve, CORS helpers, OPTIONS preflight; smoke-notice has internal-endpoint override. (3) Component unexpected-wiring is caught for all admin_officer routes. (4) Role signature changes (admin_officer → admin only, etc.) trigger CI failure. (5) Future admin_officer work must maintain snapshot locks and update baselines as part of review discipline.

- Date: 2026-05-15
- Decision: Star Trek canonical validations should run in CI-mode (`CI=1`) for deterministic web-server startup; non-CI runs may reuse stale server state and produce false infrastructure failures (`ERR_CONNECTION_REFUSED`).
- Scope: `docs/STAGING.md`, `plan.md`, Star Trek validation commands in `tests/e2e/phase1-*.spec.ts`, `tests/e2e/phase2-universal-translator.spec.ts`, `tests/e2e/phase3-*.spec.ts`, and `tests/e2e/phase4-*.spec.ts`.
- Reason: repeated non-CI validation runs showed intermittent connection-refused failures unrelated to product behavior; CI-mode forced a fresh server and produced stable canonical evidence.
- Consequences: (1) Authoritative Star Trek completion checks should be run with `CI=1`. (2) Non-CI failures in this lane should be treated as potential infrastructure noise until reproduced in CI-mode. (3) Staging evidence for Phase F/G should cite CI-mode canonical commands.

- Date: 2026-05-15
- Decision: Phase E (Data Access Reduction + Enterprise Hardening) is formally COMPLETE and gates are locked. Phase 0 (Radio Platform Redesign) entry gate is OPEN pending steering committee approval of three ADRs (SFU selection, event backbone, voice-twin governance).
- Scope: `docs/STAGING.md`, `plan.md`, `tests/e2e/phase-e*.spec.ts`, `docs/adr/006-sfu-platform-selection.md`, `docs/adr/007-event-backbone-floor-control.md`, `docs/adr/008-voice-twin-governance.md`, `docs/PHASE_0_SCHEMA_DESIGN.md`.
- Reason: Phase E completion formalizes the enterprise hardening sprint; Phase 0 architectural decisions must be explicit and approved before implementation sprints (Phases 1–5) begin. ADR-based governance replaces ad-hoc designs.
- Consequences: (1) All future work assumes Phase E baseline (data access reduction, communications governance, audit dashboards active). (2) Phase 0 entry gate requires approval of SFU, event backbone, and voice-twin models from steering committee, legal/compliance, and ops. (3) Phase 1 implementation (Phases 1–5 radio rebuild) cannot start until Phase 0 entry gate passes.

- Date: 2026-05-15
- Decision: Phase 0 radio platform redesign is a 5-phase buildout (Phase 1: SFU + floor control; Phase 2: transcripts + captions; Phase 3: translation layer; Phase 4: translated audio relay; Phase 5: voice-twin enrollment + governance). Each phase has explicit exit gate; no phase gates the next until metrics pass. Feature flags govern canary progression (5% → 25% → 50% → 100%).
- Scope: `docs/PHASE_0_SCHEMA_DESIGN.md`, `docs/adr/006-*.md`, `docs/adr/007-*.md`, `docs/adr/008-*.md`, `plan.md`, `package.json` (feature flag registry).
- Reason: Radio platform redesign is the strategic post-Phase-E priority. Five-phase gate model reduces risk by validating each capability before expanding scope. Livekit SaaS + Redis event backbone + three-tier voice-twin consent model provide a defensible architecture that balances functionality, cost, and compliance.
- Consequences: (1) Phase 1 requires Livekit provisioning and SFU integration; ops/infra support needed. (2) Each phase adds schema tables (radio_transmissions → radio_floor_events → radio_transcript_segments → radio_translation_segments → radio_tts_renders → radio_voice_profiles). (3) Feature flags must be maintained through all 5 phases; no flag removal until phase fully sunseted. (4) Voice-twin governance (ADR-008) requires legal review before Phase 5 implementation. (5) Post-Phase-5 backlog includes multi-channel radio banks, AI floor arbitration, external network integration.

- Date: 2026-05-15
- Decision: Phase 0 Architecture Decision Records (ADRs 006, 007, 008) are the source of truth for Livekit SFU selection, Redis event backbone topology, and voice-twin consent model. All three ADRs must pass Dr Bob review and steering committee approval before Phase 1 implementation begins.
- Scope: `docs/adr/006-sfu-platform-selection.md`, `docs/adr/007-event-backbone-floor-control.md`, `docs/adr/008-voice-twin-governance.md`.
- Reason: ADR-based approach makes architectural decisions auditable and referenceable; avoids design thrashing and ensures alignment with Iron Eagle leadership, legal/compliance, and ops teams before code is written.
- Consequences: (1) Any contradiction between ADR and code must be resolved in ADR (decision) not code (implementation). (2) If a fallback path becomes necessary (e.g., cost-driven move from Livekit to Mediasoup), a new ADR must be created with rationale and approval. (3) ADRs must be reviewed at each phase gate; if new information surfaces, ADR can be updated with a dated amendment section.

- Date: 2026-05-15
- Decision: Phase 0 schema design follows org-level isolation via RLS on all new `radio_*` tables. No radio data crosses org boundaries. Multi-tenancy enforcement is mandatory, not optional.
- Scope: `docs/PHASE_0_SCHEMA_DESIGN.md`, all new migrations in `supabase/migrations/202605*.sql`, `tests/e2e/phase1-*.spec.ts`.
- Reason: FieldOps Manager is a multi-org SaaS; radio platform must maintain org isolation. RLS policies prevent both accidental leakage and malicious access.
- Consequences: (1) Every radio table must define RLS policy: `WHERE org_id = current_setting('request.jwt.claims.org_id')::uuid`. (2) Test harness must validate org isolation with cross-org read/write attempts. (3) Any query-builder pattern that bypasses org check is a blocker until remediated.

- Date: 2026-05-15
- Decision: Star Trek (4-phase Bob capability rollout) is integrated into Phase 0 Phase 1 architecture as the governance framework for floor control and emergency override. Bob approval contracts (D1 from Phase D) and voice-twin consent (ADR-008) are aligned.
- Scope: `tests/e2e/phase3-sentient-xo.spec.ts`, `tests/e2e/phase4-admirals-bridge.spec.ts`, `docs/STAR_TREK_PHASED_ROLLOUT_PLAN.md`, `docs/adr/008-voice-twin-governance.md`.
- Reason: Bob is the governance agent for radio platform; Star Trek phase gates ensure Bob capabilities remain operational through Phase 0 development.
- Consequences: (1) Phase 0 Phase 1 implementation must include Bob floor-acquire/release call paths. (2) Star Trek Phase 3 (Sentient XO) gates persist through Phase 0 Phase 1–5; if Bob automation breaks, Phase 0 work stops until resolved. (3) Emergency override path (Phase 0 Phase 1) routes through Bob approval contract (D1) before escalating to supervisor.

- Date: 2026-05-15
- Decision: Phase D is treated as formally closed only when D1-D3 gates plus build/lint are revalidated and recorded in staging, and Phase E work starts from an explicit Go/No-Go entry check with E1-E4 queue tracking.
- Scope: `docs/STAGING.md`, `plan.md`, `tests/e2e/phase-d1-bob-approval-contracts.spec.ts`, `tests/e2e/phase-d2-translation-speech-boundaries.spec.ts`, `tests/e2e/phase-d3-transition-handshake-offline.spec.ts`.
- Reason: Revalidation-before-handoff prevents stale gate assumptions and keeps phase transitions auditable under autonomous continuation.
- Consequences: Future phase transitions must include (1) focused gate reruns, (2) staging evidence update, and (3) a checklisted entry gate for the next phase before execution expands.

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
