# Phase 3 Role-Path Simplification Maps

Date: 2026-05-03
Phase: Phase 3 UX/operator-efficiency improvements
Source: docs/STAGING.md section 9F

## Objective

Reduce click depth and decision friction for high-frequency operations across role families while preserving route-role gate integrity.

## Route Family Focus

Primary triage routes:

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

## Role Maps

### Officer / Admin Officer Fast Path

Current (observed common pattern):

- /officer-home -> /field-officer -> /radio -> /observations -> /job-map

Target simplified path:

- /field-officer -> /radio -> /observations -> /job-map

Simplification actions:

- Add pinned quick actions in officer shell: Report, Dispatch Acceptance, Evidence Capture.
- Preserve active filter/state context when returning from detail routes.
- Ensure one-tap handoff from /radio to /observations and /job-map.

Acceptance targets:

- Primary action click depth <= 2 for officer top tasks.
- Route mismatch and backtrack actions reduced by >= 25%.

### Admin / Admin Officer Operations Fast Path

Current (observed common pattern):

- /admin/dashboard -> /dispatch-monitor -> /compliance -> /reports (multiple context resets)

Target simplified path:

- /admin/dashboard -> /dispatch-monitor -> /compliance -> /reports

Simplification actions:

- Add unified "Ops Command" handoff links between dispatch/compliance/reports.
- Keep global filters sticky and visible across transitions.
- Surface unresolved queue counts in header summary bar for each route.

Acceptance targets:

- Time-to-primary-action reduced by >= 30% from baseline.
- Median click depth to core action <= 2.

### Master / Grand Master Governance Fast Path

Current (observed common pattern):

- /platform -> /audit-log -> /intel-approvals -> /reports

Target simplified path:

- /platform -> /audit-log -> /intel-approvals -> /reports

Simplification actions:

- Add governance shortcut strip in platform header (Approvals, Audits, Org Controls).
- Preserve selected org scope and date filters through governance route transitions.
- Add direct back-link from reports to approvals/audit views.

Acceptance targets:

- Governance task navigation requires <= 2 hops to destination views.
- No role-route mismatch findings under strict validation.

## Guardrails

- Validate all route/role changes with strict gates before merge:
  - node scripts/generate-route-role-matrix.mjs
  - node scripts/validate-roadmap-role-gates.mjs --strict
- Keep docs/MODULE_ROADMAP.md and src/App.tsx in sync for any route changes.
- Update docs/STAGING.md with evidence run IDs after each implemented simplification slice.
