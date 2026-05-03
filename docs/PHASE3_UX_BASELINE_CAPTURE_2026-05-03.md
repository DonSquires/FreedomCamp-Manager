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
| /compliance | pending | pending | pending | pending | pending |
| /dispatch-monitor | pending | pending | pending | pending | pending |
| /job-map | pending | pending | pending | pending | pending |
| /observations | pending | pending | pending | pending | pending |
| /radio | pending | pending | pending | pending | pending |
| /breaches | pending | pending | pending | pending | pending |
| /reports | pending | pending | pending | pending | pending |
| /crm | pending | pending | pending | pending | pending |
| /live-patrol | pending | pending | pending | pending | pending |
| /noise-control | pending | pending | pending | pending | pending |

## Evidence Sources

- Route grounding: docs/PHASE3_TOP10_ROUTE_VERIFICATION_2026-05-03.md
- Async-state CI lane: .github/workflows/phase1-async-state-validation.yml
- Existing async-state assertions: tests/e2e/async-state-first-wave.spec.ts
- Baseline capture spec: tests/e2e/phase3-ux-baseline-capture.spec.ts
- Baseline capture CI lane: .github/workflows/phase3-ux-baseline-capture.yml

## Notes

- This workbook is the executable evidence surface for Phase 3 baseline requirements (D1-D4) and should be updated before additional UX code changes.
