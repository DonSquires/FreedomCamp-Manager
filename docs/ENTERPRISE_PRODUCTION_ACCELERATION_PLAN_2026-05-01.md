# Enterprise Production Acceleration Plan (2026-05-01)

## Objective

Break the fix-fail loop and reach enterprise-selling readiness with measurable weekly progress.

## Current Grounded Reality

1. Human trial gate exists and now includes mandatory AI assistance preflight plus mandatory AI build/research/triage.
2. Local Alpine browser runs are not authoritative for cross-browser readiness; Ubuntu CI remains source of truth.
3. Pod/GPU capacity is intermittent, so pod is fallback and not the critical path for release readiness.
4. Existing planning docs are strong on future-state architecture, but execution has lacked short-cycle evidence gates.

## Why Progress Has Stalled

1. Too much effort has gone into architecture-level redesign discussion before locking short-cycle release outcomes.
2. Repeated failures have not always produced the same structured decision output (owner, fix class, deadline, proof).
3. Several runs were duplicated/inconclusive, creating noise and unclear primary evidence.
4. Commercial readiness has not been linked to a strict release scorecard each run.

## New Operating Model (Mandatory)

Every release-gate run must end with one decisive state:

1. GO
2. CONDITIONAL_GO
3. NO_GO

And every non-GO run must produce:

1. blocker owner
2. concrete fix action
3. verification command
4. deadline

No unowned blockers.

## 3-Lane Execution Strategy

### Lane A: Product Reliability Gate (Primary)

Goal:

1. Make release gate the single source of production readiness truth.

Actions:

1. Keep one active human-trial gate run at a time.
2. Enforce AI preflight plus mandatory AI assist every run.
3. Generate summary and enterprise readiness report artifacts every run.

Exit criteria:

1. 3 consecutive gate runs with no blocker-level infra/runtime errors.
2. 2 consecutive runs with no failed critical steps.

### Lane B: AI Runtime and Agentic Capability

Goal:

1. Ensure Bob can reliably assist build, research, and triage in each release cycle.

Actions:

1. Keep OpenAI-style path configured as primary where available.
2. Keep Bob service path configured as fallback.
3. Fail fast when neither path is ready.

Exit criteria:

1. Mandatory AI assist succeeds in 3 consecutive production-gate runs.
2. AI assist artifacts show valid responses for build, research, and triage.

### Lane C: Commercial Readiness

Goal:

1. Turn engineering outcomes into sellable enterprise confidence signals.

Actions:

1. Publish per-run readiness report with score and blockers.
2. Maintain one-page go/no-go checklist sign-off by engineering, product, operations.
3. Track trial launch prerequisites in a single run-linked artifact set.

Exit criteria:

1. Readiness score >= 85 for two consecutive runs.
2. No unresolved blocker in report.
3. Trial script, rollback owner, and incident path all signed off.

## 7-Day Execution Cadence

### Day 1 to Day 2

1. Stabilize gate and remove duplicate runs.
2. Fix any blocker from AI preflight or mandatory AI assist path.
3. Produce first enterprise readiness report.

### Day 3 to Day 4

1. Resolve top blocker and top major from report.
2. Re-run full gate and compare score delta.
3. Lock owner and due date on remaining issues.

### Day 5 to Day 7

1. Achieve two consecutive runs at or above readiness threshold.
2. Perform final trial readiness sign-off.
3. Schedule first controlled human trial window.

## Failure Loop Breaker Rules

1. If the same blocker appears in two runs, halt new feature work until closed.
2. If AI mandatory assist fails twice, fix provider configuration before any test expansion.
3. If runtime/browser launch failures recur, treat as infrastructure blocker, not test-content bug.
4. If owner is missing for any blocker, run is automatically NO_GO.

## Ownership Model

1. Engineering owner: gate stability, test failures, infra blockers.
2. AI platform owner: OpenAI-style path, Bob fallback health, mandatory assist results.
3. Product owner: major/minor acceptance decisions.
4. Operations owner: rollback path and incident runbook readiness.

## Success Definition (Enterprise Production)

Enterprise production readiness is achieved when:

1. release gate verdict is GO or approved CONDITIONAL_GO,
2. blocker count is zero,
3. failed critical step count is zero,
4. AI mandatory assist succeeds on all required capabilities,
5. sign-off checklist is complete,
6. readiness score remains stable above threshold across consecutive runs.
