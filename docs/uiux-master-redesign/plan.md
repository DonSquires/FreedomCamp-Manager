# FieldOps Master UI/UX Redesign Plan

Status: execution plan
Date: 2026-04-26
Depends on: spec.md, self-critique.md

## Execution Order and Readiness Rules

Execution order is strict:
1. Phase 0.5 (harness stabilization)
2. Phase 0 (baseline and instrumentation)
3. Phase 1 (canonical IA registry)
4. Phase 2 (section shells)
5. Phase 3 (officer hardening)
6. Phase 4 (admin consolidation)
7. Phase 5 (QA and rollout)

Entry rule for each phase:
- Previous phase exit criteria must be met and recorded with artifact evidence.

Evidence rule for each phase handoff:
- Include a short handoff note with:
	- completed tasks
	- unresolved risks
	- evidence artifact paths
	- explicit go/no-go decision

## Phase 0.5: Human-Test Harness Stabilization (1-2 days)

Objectives:
- Eliminate false negatives in human-test agentic packs before using results as release gates.

Tasks:
1. Add base URL readiness/wait check before agentic pack launch in `scripts/human-test-engine.mjs` workflow.
2. Ensure Playwright credential preflight is satisfied in CI/local profile or explicitly documented fallback mode is used.
3. Re-run human-test engine with and without shared fallback mode and compare outcomes.
4. Treat `ERR_CONNECTION_REFUSED` at first step as harness issue unless web server health check confirms app outage.

Exit criteria:
- Human-test report has no harness bootstrap failures.
- Agentic pack failures, if any, are actionable UX behavior defects.

Required evidence artifacts:
- latest standard-credential report path
- latest fallback-mode report path
- harness readiness check output

## Phase 0: Baseline and Instrumentation (3-4 days)

Objectives:
- Establish measurable UX baseline.
- Map all active routes and nav entries.

Tasks:
1. Build route inventory from `src/App.tsx` and canonical module routes in `src/modules/registry.ts`.
2. Record nav surface inventory from `src/components/features/AppLayout.tsx`, `src/components/features/AdminNavigationMenu.tsx`, `src/pages/AdminHub.tsx`, `src/pages/AdminPortal.tsx`.
3. Reconcile route inventory against `docs/LIVE_SCHEMA.md` table domains to ensure each schema-backed capability has a navigable IA owner section.
4. Add analytics events:
- nav_click
- route_entry
- route_backtrack
- time_to_first_action
- portal_switch
5. Capture baseline for admin and officer workflow top 10 journeys.
6. Produce a mandatory coverage report listing all live route families and module IDs with assigned IA sections; block Phase 1 if any are unmapped.

Exit criteria:
- Baseline dashboard published.
- Current IA drift list complete.
- Coverage report has zero unmapped modules or route families.

Required evidence artifacts:
- route inventory artifact
- module inventory artifact
- schema-to-IA reconciliation artifact
- telemetry event definition artifact

## Phase 1: Canonical IA Registry (4-6 days)

Objectives:
- Create one source of truth for route access and nav rendering.

Tasks:
1. Add `ia_redesign_config` to `system_state.json` before any new file creation:
- registry_path
- source_files
- schema_version
- approved_on
2. Introduce `src/config/navigationRegistry.ts` with typed schema only after step 1 is merged:
- path
- label
- section
- navSurface
- allowedRoles
- area
- orgScoped
- aliasOf
- redirectTo
3. Refactor nav renderers to consume registry:
- `AppLayout`
- `AdminNavigationMenu`
- hub/dashboard tiles where applicable
4. Refactor existing route wrappers in `src/App.tsx` (`ProtectedRoute`, `RoleRoute`, `AreaRoute`) to consume registry metadata where possible.
5. Add parity tests: every visible nav item must map to live route; every route with navSurface visible must render in appropriate menu.

Exit criteria:
- No hardcoded duplicate role arrays in key nav files.
- Navigation parity test suite green.

Required evidence artifacts:
- registry schema file
- nav migration diff references
- parity test results

## Phase 2: Mission Control and Section Shells (5-7 days)

Objectives:
- Introduce new IA sections without breaking existing workflows.

Tasks:
1. Introduce standardized section shell layout patterns inside existing pages first.
2. Create any new section shell page only after it is grounded in `system_state.json` and linked to registry ownership.
3. Re-map existing pages to target sections:
- Mission Control
- Field Operations
- Compliance and Enforcement
- Intelligence and Records
- Workforce and Scheduling
- Clients and Commercial
- Reports and Analytics
- Platform and Settings
4. Maintain route aliases and redirects for backward compatibility.
5. Add persistent org context indicator and quick-switch control.

Exit criteria:
- New shell navigation available for admin and master roles.
- No workflow loss for existing deep links.

Required evidence artifacts:
- section shell adoption matrix
- deep link compatibility checks
- org context indicator validation notes

## Phase 3: Officer-First Workflow Hardening (4-6 days)

Objectives:
- Deliver high-confidence officer UX for field operations.

Tasks:
1. Build officer action board:
- Start shift
- Active assignment
- Safety and welfare
- Capture and evidence
- Escalation
2. Standardize high-pressure interaction patterns using existing component library and currently shipped pages; define any new component in a separate grounded ticket before build.
3. Validate night-patrol and glove-friendly behavior on mobile breakpoints.
4. Ensure specialist tools are contextual under Field Operations.

Exit criteria:
- Officer taps-to-first-action improves against baseline.
- Night-patrol and offline behavior pass validation checklist.

## Phase 4: Admin Workflow Consolidation (4-6 days)

Objectives:
- Reduce duplication between Admin Hub, Command Centre, and alternate nav flows.

Tasks:
1. Converge Admin Hub and Command Centre card systems into one documented card taxonomy pattern using existing card components.
2. Remove duplicate nav route clusters from deprecated menu structures.
3. Define section-level dashboard templates and data loading contracts.
4. Validate discoverability for commercial modules (assets/pricing/invoicing) and specialist modules.

Exit criteria:
- One admin navigation grammar in production.
- Discoverability regression tests pass.

## Phase 5: Accessibility, QA, and Rollout (3-5 days)

Objectives:
- Validate quality and ship safely.

Tasks:
1. Accessibility pass across core role journeys.
2. Theme pass for light, dark, high-contrast, night-patrol.
3. E2E route and nav parity coverage for admin, admin_officer, officer, master.
4. Feature flag rollout plan:
- internal pilot
- admin cohort
- officer cohort
- full production
5. Post-release measurement and rollback criteria.

Exit criteria:
- QA signoff completed.
- KPI movement report generated at 7 and 30 days.

Required evidence artifacts:
- accessibility report
- theme and responsive validation report
- role journey E2E pass report
- rollout and rollback runbook

## Governance and Collaboration

1. Require architecture review on registry schema changes.
2. Require design QA checklist per IA section release.
3. Run Dr Bob review on spec and plan before each phase handoff.
4. Update `docs/DECISIONS.md` when IA contracts or policy assumptions change.
