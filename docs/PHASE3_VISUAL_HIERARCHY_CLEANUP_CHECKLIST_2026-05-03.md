# Phase 3 Visual Hierarchy Cleanup Checklist

Date: 2026-05-03
Phase: Phase 3 UX/operator-efficiency improvements
Source: docs/STAGING.md section 9G

## Goal

Improve readability, reduce scan-time overhead, and make primary actions immediately discoverable on dense operator pages.

## Scope

Top-10 triaged routes:

- /compliance
- /dispatch-monitor
- /job-map
- /observations
- /radio
- /breaches
- /reports
- /crm
- /live-patrol
- /noise-control

## Slice A (Now) Checklist

- [ ] Place primary action buttons above first table/card fold on all top-10 routes.
- [ ] Keep active filters and role context in sticky page headers.
- [ ] Remove duplicate summary cards/tables where information is repeated.
- [ ] Confirm empty/loading/error states are visible without scrolling.
- [ ] Verify operator action labels are explicit and role-appropriate.

## Slice B (Next) Checklist

- [ ] Add route-level summary bars (pending alerts, unresolved breaches, active dispatches).
- [ ] Normalize empty/loading/error visual pattern across specialist portals.
- [ ] Tighten typography scale and spacing rhythm for dense data views.
- [ ] Ensure KPI cards degrade independently (no whole-page blanking on partial failure).

## Slice C (Later) Backlog Checklist

- [ ] Add cross-route command palette for top operator actions.
- [ ] Add progressive disclosure for advanced controls.
- [ ] Add guided first-run cues for low-frequency governance tools.

## QA and Regression Guardrails

- [ ] Verify mobile viewport 375px for each updated route.
- [ ] Verify keyboard navigation and focus order on primary actions.
- [ ] Verify no route-role regressions via strict role-gate validation.
- [ ] Verify lint/build/doc-authority gates remain green after each slice.

## Evidence Logging

For each completed checklist item, record:

1. Route(s) impacted
2. PR/commit SHA
3. Screenshot or artifact link
4. Before/after click depth or time-to-action delta
