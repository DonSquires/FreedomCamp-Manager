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

- P0: Update IA and UX flows to represent Bob as a governed workspace, not chat-only helper.
- P0: Provide clear state designs for gatekeeper checkpoints: pending approval, blocked by policy, human signature required, emergency preemption.
- P1: Validate consistent help placement (Bob, feedback, support) across desktop/mobile breakpoints.
- P1: Define dense-mode interaction spec for Dispatch Console and Enforcement Command Center header toggles.
- P2: Produce reusable pattern for governance status strips and approval audit affordances.

## 3) Frontend Engineer (React)

- [x] P0: Normalize route aliases and redirects according to product decision (manual and app must match). *(Completed 2026-05-17: legacy compliance/enforcement aliases now redirect to canonical routes.)*
- [x] P0: Keep Bob route surfaces role-gated and reflect gatekeeper copy/labels in-page. *(Completed 2026-05-17: canonical Bob assistant route remains role-gated and governance language is documented.)*
- P1: Implement/confirm dense-mode toggle in page header for dispatch and command-center workflows.
- P1: Ensure all admin compliance/reporting surfaces consistently use global filter ribbon behavior.
- P1: Add explicit UI indicators for gate status (proposal submitted, awaiting approver, approved, blocked).
- P2: Reduce nav drift by projecting sidebar definitions from route manifest where feasible.

## 4) Backend / Supabase Engineer

- P0: Verify all Bob execution-capable paths use explicit contract checks before mutation.
- P0: Enforce org-scoped audit attribution for governed actions (`actor`, `operator`, `org`).
- P1: Review edge-function responses for structured errors on invalid tool/contract payloads.
- P1: Validate emergency-priority guard rails block non-safety writes.
- P2: Add contract/version metadata to Bob mutation events for forensic traceability.

## 5) AI/Bob Specialist

- P0: Formalize gatekeeper policy matrix: which actions are assistive-only vs approval-gated vs human-only.
- P0: Confirm emergency mode behavior precedence and fallback messaging is deterministic.
- P1: Add confidence + reason codes for each Bob recommendation and gate decision.
- P1: Expand prompts to request missing mandatory data before any actuation attempt.
- P2: Add drift monitor to detect if manual claims differ from active Bob capabilities/routes.

## 6) QA / Test Engineer

- P0: Add canonical route parity tests against approved route matrix (manual-aware assertions).
- P0: Add Bob gatekeeper E2E tests for approve/reject/block/emergency paths.
- P1: Add regression tests for aliases/redirects (`/reports-hub`, compliance variants, enforcement spelling variants).
- P1: Add visual checks for governance states and fire-control authorization UX.
- P1: Ensure CI-mode browser runs are the authoritative baseline for Star Trek/phase gates.

## 7) Security / Compliance Specialist

- P0: Re-verify high-risk actions require explicit human authorization boundaries.
- P0: Confirm RLS + org-scoping are enforced in all governed Bob operations.
- P1: Audit role permissions for Bob queue/review/log routes.
- P1: Validate legal-print and enforcement fire-control flows remain non-bypassable.
- P2: Review retention policy for Bob decision logs and approval artifacts.

## 8) Technical Writer / Documentation Specialist

- P0: Reconcile all route references in manual with canonical router reality (or approved aliases).
- P0: Keep Bob governance model language consistent across sections (UI shell, Phase 3/4, AI services).
- P1: Add “route naming conventions” appendix and deprecation/alias policy.
- P1: Add one-page “Bob Gatekeeper Playbook” for operations staff.
- P2: Add change-log entry linking governance wording updates to source commits.

## 9) DevOps / Release Specialist

- P0: Add PR gate/check that flags route changes without manual/docs updates.
- P1: Add CI check to diff route manifest against a canonical route contract artifact.
- P1: Publish release note template section: “Governance and gatekeeper changes”.
- P2: Add nightly drift report for docs vs router path mismatches.

## 10) LLM Engineer (Application-Layer LLM Systems)

- P0: Own runtime prompt/policy architecture and keep Bob governance behavior manual-aligned.
- P0: Own tool-calling and gate orchestration behavior, including deterministic reason-code payloads.
- P1: Add policy regression coverage for emergency-priority block semantics and review payload shape.
- P1: Add docs/runtime drift checks for Bob governance claims in the instruction manual.
- P2: Expand operator-facing explainability fields (confidence framing + decision context) with safe wording.

## 11) ML Engineer (Model Training and Algorithms)

- P0: Own model training/fine-tuning, feature engineering, and dataset quality controls.
- P0: Publish baseline quality scorecard for Bob model tasks and define calibration method.
- P1: Define retraining triggers and model promotion gates (offline metrics before runtime rollout).
- P1: Optimize inference-quality tradeoffs (latency/throughput/quality) at model-runtime layer.
- P2: Add model drift detection and retraining recommendation cadence.

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
