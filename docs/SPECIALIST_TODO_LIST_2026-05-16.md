# Specialist To-Do List (Re-Assessment)

Date: 2026-05-16
Scope: Post re-assessment of current implementation vs. manual and architecture artifacts
Owner: Product Oversight / UX Governance

## Priority Bands

- P0: Must do now (governance, route contract, legal/safety gate risk)
- P1: Should do next sprint (consistency, usability hardening)
- P2: Nice to have (optimization and polish)

## 1) Product Manager / Product Owner

- [x] P0: Confirm canonical route contract for compliance and enforcement paths (`/compliance` vs `/admin/compliance`, `/enforcement-command-center` vs `/enforcement-command-centre`). *(Completed 2026-05-17: canonical routes confirmed; legacy aliases retained as redirects.)*
- [x] P0: Publish one canonical naming policy for US/UK path spelling and enforce it across docs/tests. *(Completed 2026-05-17: canonical US `center`; UK `centre` retained as compatibility alias only.)*
- [x] P0: Approve Bob operating model as dual-mode: assistive + governance gatekeeper. *(Completed 2026-05-17: manual governance model is canonical.)*
- [x] P1: Define acceptance criteria for Bob gatekeeper outcomes (proposal, approval, rejection, emergency override). *(Completed 2026-05-17: acceptance criteria added to instruction manual.)*
- [x] P1: Lock release checklist: no route or role changes without manual update in same PR. *(Completed 2026-05-17: release checklist gate added to instruction manual.)*

## 2) UX Designer / Product Designer

- [x] P0: Update IA and UX flows to represent Bob as a governed workspace, not chat-only helper. *(Completed 2026-05-17: instruction manual now treats Bob as dual-mode governed workspace with explicit gate model.)*
- [x] P0: Provide clear state designs for gatekeeper checkpoints: pending approval, blocked by policy, human signature required, emergency preemption. *(Completed 2026-05-17: gatekeeper outcome criteria and policy matrix documented in instruction manual.)*
- [x] P1: Validate consistent help placement (Bob, feedback, support) across desktop/mobile breakpoints. *(Completed 2026-05-17: help actions now stay docked in the bottom-right action cluster and expose Bob, support, and feedback consistently.)*
- [x] P1: Define dense-mode interaction spec for Dispatch Console and Enforcement Command Center header toggles. *(Completed 2026-05-17: header toggles now persist page-specific dense mode and compress spacing without changing workflow order.)*
- [x] P2: Produce reusable pattern for governance status strips and approval audit affordances. *(Completed 2026-05-18: reusable governance status-strip pattern documented in `docs/INSTRUCTION_MANUAL.md` and applied on Bob/Intel governance surfaces.)*

## 3) Frontend Engineer (React)

- [x] P0: Normalize route aliases and redirects according to product decision (manual and app must match). *(Completed 2026-05-17: legacy compliance/enforcement aliases now redirect to canonical routes.)*
- [x] P0: Keep Bob route surfaces role-gated and reflect gatekeeper copy/labels in-page. *(Completed 2026-05-17: canonical Bob assistant route remains role-gated and governance language is documented.)*
- [x] P1: Implement/confirm dense-mode toggle in page header for dispatch and command-center workflows. *(Completed 2026-05-17: Dense mode toggles added to Dispatch Console and Enforcement Command Centre headers.)*
- [x] P1: Ensure all admin compliance/reporting surfaces consistently use global filter ribbon behavior. *(Completed 2026-05-18: compliance/reporting surfaces (`CompliancePage`, `ComplianceDashboard`, `ComplianceAnalytics`, `Reports`, `ReportsHub`, `IncidentReports`, `AuditLog`) render `GlobalFilterRibbon` consistently.)*
- [x] P1: Add explicit UI indicators for gate status (proposal submitted, awaiting approver, approved, blocked). *(Completed 2026-05-18: gate status badges added to Bob Assistant Studio and Intel Approval Queue.)*
- P2: Reduce nav drift by projecting sidebar definitions from route manifest where feasible.

## 4) Backend / Supabase Engineer

- [x] P0: Verify all Bob execution-capable paths use explicit contract checks before mutation. *(Completed 2026-05-18: `edgeFunctions.bobGateway` blocks unapproved mutation contracts before calling `onspace-ai-chat`.)*
- [x] P0: Enforce org-scoped audit attribution for governed actions (`actor`, `operator`, `org`). *(Completed 2026-05-18: Bob gateway merges `organization_id`, `actor_id`, and `actor_role` into context and sends org/actor headers for governed calls.)*
- [x] P1: Review edge-function responses for structured errors on invalid tool/contract payloads. *(Completed 2026-05-18: Bob gateway returns explicit structured block errors with `reasonCode` and `executionReview` payloads.)*
- [x] P1: Validate emergency-priority guard rails block non-safety writes. *(Completed 2026-05-18: emergency-priority gate evaluation blocks non-safety mutation contracts with deterministic reason codes.)*
- [x] P2: Add contract/version metadata to Bob mutation events for forensic traceability. *(Completed 2026-05-18: execution context includes `execution_policy_contract: v1` and execution policy metadata.)*

## 5) AI/Bob Specialist

- [x] P0: Formalize gatekeeper policy matrix: which actions are assistive-only vs approval-gated vs human-only. *(Completed 2026-05-17: canonical matrix added to instruction manual.)*
- [x] P0: Confirm emergency mode behavior precedence and fallback messaging is deterministic. *(Completed 2026-05-17: deterministic precedence and fallback behavior documented in instruction manual.)*
- [x] P1: Add confidence + reason codes for each Bob recommendation and gate decision. *(Completed 2026-05-18: Bob execution review now surfaces confidence breakdown and decision reason codes in assistant responses.)*
- [x] P1: Expand prompts to request missing mandatory data before any actuation attempt. *(Completed 2026-05-18: execution policy system prompt enforces minimal-required-fields clarification behavior before risky writes.)*
- [x] P2: Add drift monitor to detect if manual claims differ from active Bob capabilities/routes. *(Completed 2026-05-18: nightly docs/router drift reporting plus `lint:bob-governance-drift` checks now run for governance claims.)*

## 6) QA / Test Engineer

- [x] P0: Add canonical route parity tests against approved route matrix (manual-aware assertions). *(Completed 2026-05-17: route/menu parity and contract parity covered via `tests/e2e/manifest-menu-parity.spec.ts` and `tests/e2e/route-contract-alias-parity.spec.ts`.)*
- [x] P0: Add Bob gatekeeper E2E tests for approve/reject/block/emergency paths. *(Completed 2026-05-17: approve/reject/pending-escalation/execution-failure covered in `tests/e2e/phase-d1-bob-approval-contracts.spec.ts`; emergency path covered in Phase 4 emergency specs.)*
- [x] P1: Add regression tests for aliases/redirects (`/reports-hub`, compliance variants, enforcement spelling variants). *(Completed 2026-05-17: `tests/e2e/route-contract-alias-parity.spec.ts`.)*
- [x] P1: Add visual checks for governance states and fire-control authorization UX. *(Completed 2026-05-18: governance state visuals covered by `tests/e2e/bob-governance-visual-check.spec.ts`; fire-control authorization UX covered by `tests/e2e/phase4-notice-print-signature-gate.spec.ts`.)*
- [x] P1: Ensure CI-mode browser runs are the authoritative baseline for Star Trek/phase gates. *(Completed 2026-05-18: `ci-star-trek-full-gate.yml` enforces CI-mode browser phase gates with `CI: true`.)*

## 7) Security / Compliance Specialist

- [x] P0: Re-verify high-risk actions require explicit human authorization boundaries. *(Completed 2026-05-18: enforcement fire-control signature gate validated in `tests/e2e/phase4-notice-print-signature-gate.spec.ts`.)*
- [x] P0: Confirm RLS + org-scoping are enforced in all governed Bob operations. *(Completed 2026-05-18: Bob proposal contracts and org isolation validated in `tests/e2e/phase-d1-bob-approval-contracts.spec.ts`, with broader RLS proof in `tests/e2e/multi-org-rls.spec.ts` and `tests/e2e/org-isolation-api.spec.ts`.)*
- [x] P1: Audit role permissions for Bob queue/review/log routes. *(Completed 2026-05-18: admin Bob route-access suite now covers `/bob-intake-queue`, `/bob-assistant`, `/bob-ui-review`, `/bob-proposals-log`, `/bob-proposal-events-log`, and `/bob-action-proposal-events-log` in `tests/e2e/module-route-access-admin-operations-bob.spec.ts`.)*
- [x] P1: Validate legal-print and enforcement fire-control flows remain non-bypassable. *(Completed 2026-05-18: print remains blocked without valid signature/authorization in `tests/e2e/phase4-notice-print-signature-gate.spec.ts`.)*
- [x] P2: Review retention policy for Bob decision logs and approval artifacts. *(Completed 2026-05-18: retention policy documented in `docs/BOB_RETENTION_POLICY_2026-05-18.md` and linked from the instruction manual.)*

## 8) Technical Writer / Documentation Specialist

- [x] P0: Reconcile all route references in manual with canonical router reality (or approved aliases). *(Completed 2026-05-17: compliance/enforcement canonical + alias policy consolidated in instruction manual.)*
- [x] P0: Keep Bob governance model language consistent across sections (UI shell, Phase 3/4, AI services). *(Completed 2026-05-17: Bob dual-mode governance wording and outcomes standardized.)*
- [x] P1: Add “route naming conventions” appendix and deprecation/alias policy. *(Completed 2026-05-18: canonical route naming and alias policy captured in instruction manual governance section.)*
- [x] P1: Add one-page “Bob Gatekeeper Playbook” for operations staff. *(Completed 2026-05-18: playbook added at `docs/BOB_GATEKEEPER_PLAYBOOK_2026-05-18.md` and linked from instruction manual.)*
- [x] P2: Add change-log entry linking governance wording updates to source commits. *(Completed 2026-05-18: governance changes recorded in `docs/GOVERNANCE_CHANGELOG.md` with source-file linkage for this changeset.)*

## 9) DevOps / Release Specialist

- [x] P0: Add PR gate/check that flags route changes without manual/docs updates. *(Completed 2026-05-18: route-contract workflow enforces INSTRUCTION_MANUAL and DECISIONS updates when route files change.)*
- [x] P1: Add CI check to diff route manifest against a canonical route contract artifact. *(Completed 2026-05-18: `scripts/check-route-contract-artifact.mjs` diffs the live manifest against `docs/route-contract-canonical.json`.)*
- [x] P1: Publish release note template section: “Governance and gatekeeper changes”. *(Completed 2026-05-18: release notes template added to the instruction manual for governance and gatekeeper changes.)*
- [x] P2: Add nightly drift report for docs vs router path mismatches. *(Completed 2026-05-18: nightly docs/router drift report checks the governance route slice against the manual and route reference docs.)*

## 10) LLM Engineer (Application-Layer LLM Systems)

- [x] P0: Own runtime prompt/policy architecture and keep Bob governance behavior manual-aligned. *(Completed 2026-05-18: runtime execution policy prompt and governance context injection are centralized in `src/lib/edgeFunctions.ts`.)*
- [x] P0: Own tool-calling and gate orchestration behavior, including deterministic reason-code payloads. *(Completed 2026-05-18: mutation access + emergency gate orchestration emits deterministic reason codes through execution review payloads.)*
- [x] P1: Add policy regression coverage for emergency-priority block semantics and review payload shape. *(Completed 2026-05-18: `scripts/bob-llm-regression-suite.mjs` and CI policy regression gate now enforce the emergency-block and execution-review payload contract tests.)*
- [x] P1: Add docs/runtime drift checks for Bob governance claims in the instruction manual. *(Completed 2026-05-18: nightly Bob governance drift check now runs alongside the route docs drift report.)*
- [x] P2: Expand operator-facing explainability fields (confidence framing + decision context) with safe wording. *(Completed 2026-05-18: Bob assistant execution review presents confidence framing and decision context labels in operator-facing chat UX.)*

## 11) ML Engineer (Model Training and Algorithms)

- P0: Own model training/fine-tuning, feature engineering, and dataset quality controls.
- [x] P0: Publish baseline quality scorecard for Bob model tasks and define calibration method. *(Completed 2026-05-18: baseline scorecard and confidence calibration policy documented in `docs/BOB_MODEL_QUALITY_BASELINE_2026-05-18.md`.)*
- [x] P1: Define retraining triggers and model promotion gates (offline metrics before runtime rollout). *(Completed 2026-05-18: retraining triggers and offline promotion gates documented in `docs/BOB_MODEL_QUALITY_BASELINE_2026-05-18.md`.)*
- [x] P1: Optimize inference-quality tradeoffs (latency/throughput/quality) at model-runtime layer. *(Completed 2026-05-18: ONNX runtime profile tuning (`latency|throughput|quality|balanced`) added with session-level controls and env-driven overrides in `inference-service/server.js`, plus deployment docs in `inference-service/.env.example` and `inference-service/README.md`.)*
- [x] P2: Add model drift detection and retraining recommendation cadence. *(Completed 2026-05-18: daily/weekly/monthly drift cadence and retraining recommendation policy documented in `docs/BOB_MODEL_QUALITY_BASELINE_2026-05-18.md`.)*

## LLM vs ML Ownership Contract

- Active matrix: `docs/LLM_ML_OWNERSHIP_MATRIX_2026-05-16.md`
- Rule: LLM Engineer owns application-layer LLM behavior; ML Engineer owns model-layer training/algorithm behavior.
- Rule: Any operator-visible confidence or policy-semantics change requires cross-review before merge.

## Suggested 72-Hour Execution Plan

1. Day 1 (P0 alignment): PM + UX + Frontend + Docs agree canonical route and Bob governance matrix.
2. Day 2 (implementation): Frontend/Backend ship route normalization, gate state UX, and contract enforcement checks.
3. Day 3 (verification): QA/Security run parity + gatekeeper regression suite and sign off release readiness.

## Definition of Done (Cross-Specialist)

- Canonical route contract approved and reflected in router, tests, and manual.
- Bob governance/gatekeeper behavior documented and test-covered.
- Human authorization boundaries verified for legal/high-risk actions.
- No unresolved docs-vs-implementation drift on core admin/compliance/enforcement/Bob flows.
- LLM-vs-ML ownership boundaries are explicit and followed for all Bob/AI changes.
