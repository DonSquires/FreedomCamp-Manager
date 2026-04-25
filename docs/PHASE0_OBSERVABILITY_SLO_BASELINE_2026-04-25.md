# Phase 0 - Observability and SLO Baseline (2026-04-25)

## Scope

This baseline defines critical-flow observability and service SLO anchors using existing workflows, scripts, and diagnostic standards in the current stack.

## Baseline Sources

1. Platform synthetic health monitoring
   - `.github/workflows/synthetic-monitor.yml`
   - Hourly scheduled checks plus post-deploy checks for frontend availability, Supabase reachability, and browser-render health.

2. AI/runtime dependency diagnostics
   - `.github/workflows/ops-railway-wiring-audit.yml`
   - `.github/workflows/ops-runpod-serverless-smoke.yml`
   - `inference-service/scripts/verify-supabase-pipeline.sh`

3. PTT service health validation
   - `.github/workflows/deploy-voice-server.yml` post-deploy health check
   - `docs/PTT_SELF_HOSTED_OPERATIONS_STANDARD.md`

4. Database migration reliability checks
   - `docs/DB_MIGRATION_EXECUTION_PLAN.md`
   - `scripts/deploy-phase4.sh`
   - `scripts/post-deployment-smoke-test.sh`

## Critical Flows and SLO Anchors

1. Frontend reachability and render integrity
   - Signal: synthetic monitor frontend HTTP and Playwright render checks.
   - Availability objective: no unresolved hourly synthetic-monitor failures.

2. Core service dependency health
   - Signal: Railway wiring audit and check-railway-health status.
   - Reliability objective: proxy and inference report healthy during audit/smoke runs.

3. Inference request path readiness
   - Signal: RunPod serverless smoke workflow and inference health checks.
   - Reliability objective: smoke invocation completes without endpoint error.

4. PTT signaling runtime health
   - Signal: voice-server post-deploy health endpoint validation and PTT operations standard.
   - Reliability objective: health endpoint returns success after deployment.

5. Database performance and post-deploy stability
   - Signal: migration execution plan thresholds and deploy-phase4 slow-query checks.
   - Performance objectives:
     - patrol/route queries p95 under 200 ms
     - reporting queries p95 under 5 s
     - no RLS auth failures in 1-hour post-deploy window

## Observability Operations Cadence

1. Hourly
   - Synthetic monitor scheduled workflow.

2. Weekly
   - Review synthetic monitor trends and Bob human interaction smoke outcomes.
   - Review service dependency health posture from ops workflows.

3. Change-event driven
   - Run migration/deploy smoke checks after schema/runtime changes.
   - Execute wiring audit and dependency checks for service URL/secret drift.

## Baseline Verdict

Pass. Observability and SLO baseline for critical flows is now explicitly captured and grounded in active monitoring workflows and deployment runbooks.
