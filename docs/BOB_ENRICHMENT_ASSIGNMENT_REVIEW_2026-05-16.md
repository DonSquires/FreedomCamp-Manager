# Bob Enrichment Document Assignment Review - 2026-05-16

Scope: fast pre-flight review to train Bob on selecting reference documents, combining them into a plan, and defining an executable enrichment project.

## 1) Assignment Review Output

### 1.1 AUTHORITATIVE

- `system_state.json`
- `docs/DECISIONS.md`
- `docs/STAGING.md` (enrichment and strict sign-off sections)

### 1.2 OPERATIONAL

- `docs/BIB_STORAGE_DATA_ENTRY_PLAYBOOK.md`
- `docs/BOB_ENRICHMENT_DOCUMENT_ASSIGNMENT_PLAYBOOK.md`

### 1.3 IMPLEMENTATION

- `scripts/backfill-bob-intakes-from-storage.mjs`
- `scripts/run-enrichment-bob-app-training.mjs`
- `scripts/bootstrap-marlborough-parking.mjs`
- `scripts/geo-boundary-transition-test.mjs`
- `scripts/bob-capability-gate.mjs`

### 1.4 EVIDENCE

- `logs/enrichment-training-artifact.json`

### 1.5 CANDIDATE (review-required)

- Any new manual/uploaded documents that are not yet referenced in staging or decisions docs.
- Any runbook text that still implies permissive degraded completion for strict sign-off.

## 2) Mix-and-Match Plan Built from Assigned Docs

Lane A - Intake:
- Use `docs/BIB_STORAGE_DATA_ENTRY_PLAYBOOK.md` + `scripts/backfill-bob-intakes-from-storage.mjs`.
- Output: bucket/prefix batch sequence and org resolution strategy.

Lane B - Ownership/Bootstrap:
- Use `docs/STAGING.md` + `scripts/bootstrap-marlborough-parking.mjs`.
- Output: provider/client/workspace/contract and access prerequisites.

Lane C - Geofence Validation:
- Use `docs/STAGING.md` + `scripts/geo-boundary-transition-test.mjs`.
- Output: strict boundary transition checks with no-transition treated as blocker.

Lane D - Runtime Readiness:
- Use `scripts/run-enrichment-bob-app-training.mjs` + `scripts/bob-capability-gate.mjs` + artifact.
- Output: blocker-aware readiness decision and strict sign-off decision.

Merge rule:
- Script behavior wins over prose when conflicting.
- Higher-priority authoritative docs win over lower-priority guides.
- Any unresolved conflict is logged as a blocker before apply execution.

## 3) Enrichment Project Definition (Created from Review)

Project: `marlborough-all-buckets-enrichment-2026-05-16`

Objective:
- Stage and enrich data from all relevant storage sources,
- train Bob on source-grounded execution,
- validate app/runtime readiness,
- and produce strict sign-off artifact output.

Execution phases:

1. Document assignment pre-flight (completed in this review).
2. Bucket coverage map:
   - enumerate target buckets/prefixes,
   - classify files as reference vs candidate/new,
   - define apply batching order.
3. Intake dry-run then apply by batch.
4. Bootstrap/refresh org, contracts, and geospatial prerequisites.
5. Run enrichment orchestration with feeds and app checks.
6. Validate boundary transition and capability gate outcomes.
7. Publish artifact status and blocker summary.

Strict sign-off conditions:
- boundary transition pass,
- blockers list empty,
- degraded flag false.

## 4) Training Instructions for Bob (Immediate)

Before every enrichment run, Bob must output:

1. Assigned document set by label.
2. Candidate/new docs requiring review.
3. Plan lanes A-D with chosen source files.
4. Execution blockers and go/no-go.

After run, Bob must output:

1. Artifact path.
2. Blockers summary.
3. Strict sign-off verdict.
4. Follow-up tasks with owner and timestamp.