# UI/UX Enterprise Forward Plan (Consensus Loop)

Date: 2026-05-03
Scope: UI, UX, route/module mapping, enterprise-grade hardening, competitive parity, Voice of the Customer, and value maximization.

## Decision Goal
Achieve 100% cross-lens agreement (Bob + Dr Bob + Specialist + OpenAI architecture lens) on an execution-ready plan.

## Proposed Plan

Grounding note:
- This plan only references existing repository files and scripts as the implementation baseline.
- Any new artifact is explicitly marked as `candidate gap artifact` during execution and must be investigated before creation.
- Ungrounded references are treated as potentially legitimate product gaps, not auto-removed.

## Ungrounded Reference Policy (Mandatory)

Rule:
- If an item is not grounded in existing files or `system_state.json`, classify it as `candidate gap` and keep it in this plan until investigation completes.

Investigation workflow:
1. Register the item in the `Candidate Gap Register` section below.
2. Attempt grounding using repository evidence (`src/`, `supabase/`, `docs/`, scripts, and CI artifacts).
3. If still ungrounded, record one of two outcomes:
	- `Confirmed gap`: missing capability/documentation to be planned and implemented.
	- `Discarded assumption`: explicitly rejected after evidence review.
4. Do not remove entries silently; close them with evidence and decision.

Evidence requirement:
- Every closed candidate gap must cite at least one existing file or command output artifact.

### Priority 1 (Critical): Route/Menu Authority Unification
- Make `src/navigation/routeManifest.ts` the primary source for navigation visibility metadata while keeping route guard enforcement in `src/App.tsx`.
- Update `src/components/features/AppLayout.tsx` to pre-filter menu items by role and organization context before render.
- Eliminate silent redirects by returning explicit access guidance in guarded-route outcomes.

Deliverables:
- `src/components/features/AppLayout.tsx` uses manifest-driven role/org pre-filtering.
- `tests/e2e/module-route-access.spec.ts` expanded to include route/menu parity assertions for top-traffic modules.
- `scripts/audit-org-scoping.mjs` and existing route-gate validation commands included in phase verification checklist.

Success metric:
- 0 menu items rendered that resolve to blocked routes for signed-in role/org combinations.

### Priority 2 (Critical): Dispatch Reliability Fallbacks
- Implement suburb/postcode fallback in `src/lib/dispatchAssignment.ts` where current TODOs indicate missing fallback behavior.
- Preserve operator throughput in low-connectivity/rural patrol scenarios.

Deliverables:
- `src/lib/dispatchAssignment.ts` fallback path implemented for no-GPS scenarios.
- `tests/e2e/module-route-access.spec.ts` plus existing human test runner (`scripts/run-human-module-suite.mjs`) include no-GPS and delayed-sync assignment checks.

Success metric:
- 100% successful assignment path for defined no-GPS test cases.

### Priority 3 (High): UX Consistency System
- Standardize loading, error, empty, retry, and offline states across high-use pages.
- Define one interaction pattern for async state transitions.

Deliverables:
- Shared async-state UX components in existing UI/component structure (`src/components/features/`, `src/pages/` updates for first wave).
- First-wave rollout on top 10 operator routes with explicit page-level adoption list (`candidate gap artifact` pending investigation).

Success metric:
- 100% of top-10 routes use standardized async-state patterns.

### Priority 4 (High): Enterprise Multi-Org Assurance
- Add route/menu and workflow tests for cross-org boundaries using existing e2e and test tooling.
- Verify role x org x portal behavior is deterministic and auditable.

Deliverables:
- `tests/e2e/module-route-access.spec.ts` extended with cross-org route/access scenarios.
- Existing test runners (`scripts/human-test-engine.mjs`, `scripts/run-human-module-suite.mjs`) include Bob-related portal workflow checks across org contexts.
- Cross-org verification matrix (`candidate gap artifact`) retained for investigation and grounding.

Success metric:
- 0 unauthorized cross-org route or data exposures in test matrix.

### Priority 5 (High): Competitive/VOC Value Uplift
- Prioritize features that close the largest gap vs benchmark systems and deliver clear customer value.
- Convert VOC signals into measurable backlog items with owner and timeline.

Deliverables:
- Competitive gap board derived from `docs/COMPETITIVE_ANALYSIS_2024.md` and `docs/MODULE_ROADMAP.md` (`candidate gap artifact`) retained for investigation.
- VOC-to-backlog mapping with quantifiable outcomes (`candidate gap artifact`) retained for investigation and linked to module owners once grounded.

Success metric:
- Top 5 VOC pain points mapped to implementation tickets with acceptance criteria.

## Execution Sequence (Sprint 0 + 4 Sprints)
0. Sprint 0 (Mandatory): Candidate-gap investigation and closure decisions.
1. Sprint 1: Route/menu authority + top-risk access checks.
2. Sprint 2: Dispatch fallback + reliability tests.
3. Sprint 3: Async UX system rollout (top 10 routes).
4. Sprint 4: Competitive/VOC value items + enterprise hardening verification.

Sprint 0 exit gate (must be green before Sprint 1 kickoff):
- Every `Open` item in Candidate Gap Register is resolved to either `Confirmed gap` or `Discarded assumption` with evidence.
- No candidate gap remains in unknown state.
- Consensus lens check returns no blockers for kickoff readiness.

## Governance
- Weekly triad review in canonical + STAGING logs.
- CI gates must pass before phase progression.
- No phase closeout without evidence artifacts.

## Required Evidence Before Final Approval
1. Route/menu parity evidence from updated e2e checks in `tests/e2e/module-route-access.spec.ts`.
2. Dispatch fallback evidence from `src/lib/dispatchAssignment.ts` execution paths + test runs.
3. UX consistency evidence from first-wave route rollout logs (`candidate gap artifact`, investigation-required).
4. Cross-org assurance evidence from human/e2e test outputs.
5. Competitive/VOC mapping evidence tied to `docs/COMPETITIVE_ANALYSIS_2024.md` and `docs/MODULE_ROADMAP.md`.

## Candidate Gap Register

| Candidate gap item | Current grounding status | Investigation owner | Required evidence to close | Decision state |
|---|---|---|---|---|
| Cross-org verification matrix artifact | Not present in repo baseline | Application architecture | Evidence from `tests/e2e/module-route-access.spec.ts` outputs and/or docs artifact path | Confirmed gap (Sprint 0) |
| Competitive gap board artifact | Not present in repo baseline | Product strategy + architecture | Linkage evidence from `docs/COMPETITIVE_ANALYSIS_2024.md` to prioritized backlog records | Confirmed gap (Sprint 0) |
| VOC-to-backlog mapping artifact | Not present in repo baseline | Product design + operations | VOC signal sources + mapped backlog items with acceptance criteria | Confirmed gap (Sprint 0) |
| First-wave UX rollout log artifact | Not present in repo baseline | UX lead + frontend architecture | Route-level rollout evidence across top-10 routes | Confirmed gap (Sprint 0) |

## Investigation Evidence (2026-05-03)

Repository baseline checks:
- Missing candidate artifact files confirmed:
	- `docs/cross-org-verification-matrix.md`
	- `docs/competitive-gap-board.md`
	- `docs/voc-to-backlog-mapping.md`
	- `docs/ui-ux-first-wave-rollout-log.md`
- Dispatch fallback gap evidence in `src/lib/dispatchAssignment.ts`:
	- Existing fallback markers and unresolved TODOs at lines: 44, 162, 188, 198, 215, 221, 316, 323

Interpretation:
- Ungrounded references are retained as legitimate candidate build gaps and moved into Sprint 0 as explicit closure work.

## Route/Schema Measurement Baseline (2026-05-03 23:35:28 NZST)

Route-map checks:
- `node scripts/generate-route-role-matrix.mjs`: PASS (`tools/route-role-matrix/route-role-matrix.json`, route count 121)
- `node scripts/validate-roadmap-role-gates.mjs --strict`: PASS
- `node scripts/validate-roadmap-grounding.mjs --strict`: PASS
- `node scripts/generate-module-grounding-report.mjs`: PASS (`tools/module-grounding/module-grounding-report.json`: routes 121, unresolved 0, missing files 0)

Schema-grounding checks:
- Primary schema reference confirmed: `docs/LIVE_SCHEMA.md`
- Schema-to-IA reconciliation artifact confirmed: `docs/uiux-master-redesign/artifacts/schema-ia-reconciliation-2026-04-27.md`
- Plan priorities map to live schema domains present in `docs/LIVE_SCHEMA.md` (`observations`, `organizations`, `user_profiles`, `zones`, `patrols`, `vehicle_monthly_stays`, `zone_compliance_matrix`)
- Dispatch fallback implementation gap remains valid and grounded by TODO markers in `src/lib/dispatchAssignment.ts` (lines 44, 162, 188, 198, 215, 221, 316, 323)

Measurement verdict:
- Route map fit: 100/100
- Schema fit: 92/100
- Deduction basis: Sprint 0 confirmed gaps still require closure artifacts; no hard route/schema contradictions detected.

## Consensus Snapshot (Current Round)

- Bob lens: `Decision=approve; Blockers=none`
- Dr Bob lens: `Decision=approve; Blockers=none`
- OpenAI lens (GitHub Models gpt-4o): `Decision=approve-with-notes; Blockers=none`
- Specialist lens (pre-Sprint-0 update): `Decision=needs-revision` due to unresolved `Open` candidate gaps

Resolution action applied:
- All Candidate Gap Register entries moved from `Open` to `Confirmed gap (Sprint 0)` with evidence basis.

## Consensus Check Template
- Bob: approve | approve-with-notes | needs-revision
- Dr Bob: approve | approve-with-notes | needs-revision
- Specialist: approve | approve-with-notes | needs-revision
- OpenAI architecture lens: approve | approve-with-notes | needs-revision

Blockers are considered unresolved if any lens returns needs-revision.

Kickoff policy:
- `approve-with-notes` is not kickoff-green if notes include unresolved blockers.
- Kickoff-green requires either:
	- `approve` with no blockers, or
	- `approve-with-notes` where notes are non-blocking and all Candidate Gap Register items are closed per Sprint 0 gate.
