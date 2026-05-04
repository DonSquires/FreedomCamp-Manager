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
| /compliance | pending | 0.57 | 2 | local-2026-05-04-phase3-nondirect-v2 | partial |
| /dispatch-monitor | pending | 0.65 | 2 | local-2026-05-04-phase3-nondirect-v2 | partial |
| /job-map | pending | 0.72 | 2 | local-2026-05-04-phase3-nondirect-v2 | partial |
| /observations | pending | 0.65 | 2 | local-2026-05-04-phase3-nondirect-v2 | partial |
| /radio | pending | 0.85 | 2 | local-2026-05-04-phase3-nondirect-v2 | partial |
| /breaches | pending | 0.84 | 2 | local-2026-05-04-phase3-nondirect-v2 | partial |
| /reports | pending | 0.63 | 2 | local-2026-05-04-phase3-nondirect-v2 | partial |
| /crm | pending | 0.59 | 2 | local-2026-05-04-phase3-nondirect-v2 | partial |
| /live-patrol | pending | 0.74 | 2 | local-2026-05-04-phase3-nondirect-v2 | partial |
| /noise-control | pending | 0.72 | 2 | local-2026-05-04-phase3-nondirect-v2 | partial |

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
	- Result: `1 passed (18.4s)`
- Workbook import completed:
	- `node scripts/import-phase3-baseline.mjs --input test-results/phase3-ux-baseline.json --run-id local-2026-05-04-phase3-nondirect-v2`
	- Rows processed: `10`
- Remaining blocker: click-depth medians are still pending (`clickDepth=null`) for all top-10 routes because triaged route links are not visible from the measured `/admin` and `/admin/dashboard` shell state in the current environment.

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
