# Phase 4 - Ops Handover and Runbooks (2026-04-25)

## Objective

Consolidate the operational handover baseline for platform owners, on-call responders, and release operators across web, AI/runtime, data, and PTT surfaces.

## Canonical Runbook Sources

1. System-wide operations map
   - `docs/SYSTEM_GUIDE.md`
   - Defines routine weekly/monthly checklists and escalation entry points.

2. Deployment and migration recovery
   - `docs/DB_MIGRATION_EXECUTION_PLAN.md`
   - `docs/DB_MIGRATION_ROLLBACK_MATRIX.md`
   - `scripts/deploy-phase1.sh`
   - `scripts/deploy-phase4.sh`
   - `scripts/rollback-emergency.sh`

3. Platform health and synthetic monitoring
   - `.github/workflows/synthetic-monitor.yml`
   - `.github/workflows/ops-railway-wiring-audit.yml`
   - `.github/workflows/ops-runpod-serverless-smoke.yml`

4. Human interaction and AI runtime quality probes
   - `.github/workflows/ops-bob-human-interaction-smoke.yml`

5. PTT operations standard
   - `docs/PTT_SELF_HOSTED_OPERATIONS_STANDARD.md`

## Handover Responsibilities

1. Operations owner
   - Maintains weekly and monthly checks in `docs/SYSTEM_GUIDE.md`.
   - Confirms synthetic monitor is healthy and false-positive controls remain effective.

2. Data/platform release operator
   - Runs deployment sequence and ensures rollback readiness before schema changes.
   - Executes post-deployment smoke checks and records outcomes.

3. AI/runtime operator
   - Verifies inference health, provider configuration, and smoke conversation reliability.
   - Monitors fallback frequency in human interaction smoke runs.

4. PTT service operator
   - Maintains token/signaling health and TURN readiness based on PTT standard.
   - Executes severity-based incident handling per standard response table.

## Required Operational Cadence

1. Weekly
   - Review synthetic monitor results.
   - Review Bob human interaction smoke results.
   - Confirm RunPod endpoint health.

2. Monthly
   - Execute geofence review.
   - Reconfirm model/version posture before upgrades.
   - Review package update posture.

3. Change-event driven
   - Trigger migration/deployment runbooks.
   - Trigger wiring audit and smoke workflows post-runtime changes.

## Handover Completion Criteria

1. Runbook sources are explicit and linked to executable workflows/scripts.
2. Role responsibilities are clear for ops, data release, AI runtime, and PTT operators.
3. Routine cadence and incident pathways are documented and testable.

## Phase 4 Ops Deliverable Verdict

Pass. Ops handover and runbook pack is complete and grounded in active docs, scripts, and CI workflows.
