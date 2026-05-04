# Phase 3 UX Baseline Capture Workbook

Date: 2026-05-03
Phase: Phase 3 (P1/P2) UX and operator efficiency improvements

## Purpose

Capture measured baselines before further UX implementation for:

- click depth
- time-to-primary-action
- error-prone action counts

## Measurement Protocol

1. Use a stable credentialed admin path for triaged routes.
2. Capture at least 3 runs per route and record median values.
3. Record route mismatch or unexpected redirects as error-prone actions.
4. Store evidence artifacts (Playwright report/test-results) and reference run IDs in STAGING.

## Route Baseline Table (Top-10)

| Route | Click Depth (median) | Time-to-Primary-Action (median, sec) | Error-Prone Actions (count/sample) | Evidence Run ID | Status |
|---|---:|---:|---:|---|---|
| /compliance | 2 | 13.99 | 0 | local-2026-05-04-phase3-nondirect-v5 | captured |
| /dispatch-monitor | 2 | 12.59 | 0 | local-2026-05-04-phase3-nondirect-v5 | captured |
| /job-map | 2 | 12.69 | 0 | local-2026-05-04-phase3-nondirect-v5 | captured |
| /observations | 2 | 12.39 | 0 | local-2026-05-04-phase3-nondirect-v5 | captured |
| /radio | 3 | 15.17 | 0 | local-2026-05-04-phase3-nondirect-v5 | captured |
| /breaches | 2 | 12.41 | 0 | local-2026-05-04-phase3-nondirect-v5 | captured |
| /reports | 2 | 13 | 0 | local-2026-05-04-phase3-nondirect-v5 | captured |
| /crm | 2 | 12.61 | 0 | local-2026-05-04-phase3-nondirect-v5 | captured |
| /live-patrol | 2 | 12.45 | 0 | local-2026-05-04-phase3-nondirect-v5 | captured |
| /noise-control | 2 | 12.7 | 1 | local-2026-05-04-phase3-nondirect-v5 | captured |

## Evidence Sources

- Route grounding: docs/PHASE3_TOP10_ROUTE_VERIFICATION_2026-05-03.md
- Async-state CI lane: .github/workflows/phase1-async-state-validation.yml
- Existing async-state assertions: tests/e2e/async-state-first-wave.spec.ts
- Baseline capture spec: tests/e2e/phase3-ux-baseline-capture.spec.ts
- Baseline capture CI lane: .github/workflows/phase3-ux-baseline-capture.yml

## Notes

- This workbook is the executable evidence surface for Phase 3 baseline requirements (D1-D4) and should be updated before additional UX code changes.

## Current Execution State (2026-05-04)

- Local run completed in this container:
	- `PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK=1 bunx playwright test tests/e2e/phase3-ux-baseline-capture.spec.ts --project=chromium --reporter=list`
	- Result: `1 passed (2.5m)`
- Workbook import completed:
	- `node scripts/import-phase3-baseline.mjs --input test-results/phase3-ux-baseline.json --run-id local-2026-05-04-phase3-nondirect-v5`
	- Rows processed: `10`
- D1 baseline measurement is now captured locally: admin-shell hydration waits allow the spec to measure non-direct navigation with click-depth medians of `2` for nine routes and `3` for `/radio`.

## Artifact Import Command

After downloading CI artifact `test-results/phase3-ux-baseline.json`, run:

```bash
node scripts/import-phase3-baseline.mjs \
	--input test-results/phase3-ux-baseline.json \
	--run-id <GITHUB_RUN_ID>
```

Optional:

- `--workbook <path>` to target a different markdown workbook file.

## One-Shot CI Fetch + Import

If the workflow has already completed in GitHub Actions:

```bash
node scripts/fetch-and-import-phase3-baseline.mjs --run-id <GITHUB_RUN_ID>
```

Or auto-select the latest run for the workflow:

```bash
node scripts/fetch-and-import-phase3-baseline.mjs
```

Optional:

- `--workflow <name>` to target a different workflow file
- `--out-dir <path>` to control artifact download location
