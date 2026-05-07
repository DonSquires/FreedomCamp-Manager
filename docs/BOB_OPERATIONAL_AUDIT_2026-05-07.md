# Bob Operational Audit — 2026-05-07

## Scope
- Validate Bob operational readiness (capabilities, runtime doctor, governance tests, failure trends).
- Validate documentation freshness with existing repo authority checks.
- Record concrete blockers, fixes, and residual risks.

## Findings (Severity-Ordered)

### 1. High — Bob doctor false-negative due RunPod probe URL bug (fixed)
- Symptom: `npm run -s bob:doctor:any-container` failed with HTTP 404 against RunPod base URL.
- Root cause: `scripts/bob-container-doctor.sh` posted to the base serverless endpoint instead of `.../runsync` when endpoint kind was `runsync`.
- Fix applied: Probe URL normalization now appends `/runsync` when needed.
- Validation after fix: Doctor passes and confirms ping + chat reachability.

### 2. Medium — Staging and roadmap docs were stale for Sprint 37 status (fixed)
- Symptom: docs still described Sprint 37 as pending.
- Fix applied:
  - Updated `docs/STAGING.md` to mark Sprint 37 delivered.
  - Updated `docs/MODULE_ROADMAP.md` with Sprint 37 addendum and route count metadata.

### 3. Medium — Roadmap grounding scripts report warning noise from slash-heavy prose (open)
- `lint:roadmap-grounding` currently flags many false-positive path-like tokens extracted from descriptive prose.
- This is a tooling quality issue, not a Bob runtime outage.
- Recommendation: tighten parser to only accept route-like tokens that begin with `/` and contain no spaces plus at least one alpha segment.

## Evidence Runbook

### Operational checks
- `npm run -s bob:summarize-failures`
  - Result: lowScoreCount `1`, top failure reason `Bob chat request failed`, no repeated hallucination pattern threshold crossed.
- `npm run -s test:bob:governance`
  - Result: PASS (6/6).
- `npm run -s bob:capabilities`
  - Result: PASS (`chat` capability ok, serverless mode).
- `npm run -s bob:inference:endpoints`
  - Result: PASS (1/1 endpoint healthy, primary `https://api.runpod.ai/v2/n0bp1ifmq01cx2`).
- `npm run -s bob:doctor:any-container`
  - Result before fix: FAIL (404).
  - Result after fix: PASS.

### Documentation checks
- `npm run -s lint:doc-authority` → PASS
- `npm run -s lint:staging-doc` → PASS
- `npm run -s lint:route-roadmap` → PASS
- `npm run -s lint:module-grounding` → PASS
- `npm run -s lint:roadmap-grounding` → WARN/FAIL (known warning noise)
- `npm run -s lint:roadmap-role-gates` → WARN/FAIL (duplicate route declarations reported)

## Operational Verdict
- Bob is operational for core chat and governance behavior in current environment.
- Runtime doctor and endpoint probes now pass after the doctor probe URL fix.
- Documentation status is updated for Sprint 37 delivery.
- Remaining work is primarily tooling hygiene for roadmap validators and duplicate-route cleanup warnings.

## Files Touched During Audit
- `scripts/bob-container-doctor.sh`
- `docs/STAGING.md`
- `docs/MODULE_ROADMAP.md`
- `docs/BOB_OPERATIONAL_AUDIT_2026-05-07.md`
