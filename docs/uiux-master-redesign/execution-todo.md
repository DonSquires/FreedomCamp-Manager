# UI/UX Rebuild Execution To-Do

Status: active tracker
Date: 2026-04-26

## Confidence Rule

Do not claim completion until all release gates in this checklist are green.

## Current Confidence

- Confidence: 78%
- Why not 100% yet:
	1. Navigation registry migration is only partially applied.
	2. Parity tests for route-to-nav mapping are not implemented.
	3. Human-test standard-credential rerun is still outstanding.
	4. Phase 2 shell rollout is not validated on top-priority officer/admin journeys.

## Hard Blockers (Must Close)

- [ ] B1: Route/nav parity test suite implemented and green (`ux`)
- [ ] B2: Primary sidebar and primary admin top-nav fully registry-driven (`ux`)
- [ ] B3: Human-test standard-credential run completed with actionable-only failures (`harness` or `ux`)
- [ ] B4: Officer/admin critical route pass on deep-functional journeys after nav changes (`ux`)

## Evidence Policy

- Every `[x]` item must include one evidence line directly under the item.
- Evidence format:
	- `Evidence: <artifact-path-or-command-output-reference>`
- Items without evidence are treated as incomplete.

## Tooling Baseline

- [x] Node and npm available
- [x] bun and bunx available
- [x] ripgrep (`rg`) installed
- [ ] Playwright role credentials fully configured (no fallback required)

## Plan Execution Checklist

### Phase 0 - Baseline and Instrumentation
- [ ] Route inventory generated from `src/App.tsx`
- [ ] Module inventory generated from `src/modules/registry.ts`
- [ ] Schema-to-IA reconciliation completed against `docs/LIVE_SCHEMA.md`
- [ ] UX telemetry event set defined (`nav_click`, `route_entry`, `route_backtrack`, `time_to_first_action`, `portal_switch`)
- [ ] Coverage report generated (zero unmapped route families/modules)

Exit gate:
- [ ] Phase 0 complete with published inventory artifact and zero unmapped coverage entries.

### Phase 0.5 - Human-Test Harness Stabilization
- [x] Add base URL readiness gate for agentic packs
- [ ] Re-run human-test with standard credentials
- [x] Re-run human-test with fallback mode for comparison
- [x] Confirm no harness bootstrap failures remain

### Phase 1 - Canonical IA Registry
- [x] `ia_redesign_config` grounded in `system_state.json`
- [x] `src/config/navigationRegistry.ts` scaffold added
- [ ] Migrate primary sidebar nav rendering to registry source
- [ ] Migrate primary admin top-nav rendering to registry source
- [ ] Add route/nav parity tests

Exit gate:
- [ ] Phase 1 complete only when all primary nav surfaces render from registry metadata.

### Phase 2 - Section Shell Rollout
- [ ] Standard page shell anatomy applied to top-priority admin views
- [ ] Standard page shell anatomy applied to top-priority officer views
- [ ] Route aliases and backward compatibility validated
- [ ] Org context indicator and quick-switch validated

Exit gate:
- [ ] Phase 2 complete only when top-priority admin + officer screens share the same page anatomy contract.

### Phase 3 - Officer Workflow Hardening
- [ ] Officer action board finalized
- [ ] Night patrol and glove-mode validation complete
- [ ] Offline-safe interaction patterns validated

### Phase 4 - Admin Consolidation
- [ ] Admin Hub and Command Centre card taxonomy unified
- [ ] Duplicate route clusters removed from deprecated menu paths
- [ ] Discoverability checks pass for assets/pricing/invoicing and specialist portals

### Phase 5 - QA and Rollout
- [ ] Accessibility pass complete (WCAG 2.2 criteria in spec)
- [ ] Theme pass complete (light/dark/high-contrast/night-patrol)
- [ ] E2E parity pass complete for admin/admin_officer/officer/master
- [ ] Feature-flag rollout plan documented and approved
- [ ] 7-day and 30-day KPI measurement plan ready

Exit gate:
- [ ] Phase 5 complete only after all QA gates are green and rollout controls are documented.

## Current Measurement Snapshot

- Latest human-test report (fallback mode): `tools/human-test-engine/reports/2026-04-26T15-07-18-264Z/report.md`
- Operational Readiness: 91%
- Remaining blockers: 1 agentic functional failure (`tender-shadow`) and 2 Playwright failures (`/breaches` timeout and `/hotspots` redirect mismatch)

Latest re-validation attempt:
- `tools/human-test-engine/reports/2026-04-26T21-09-51-047Z/report.md`
- Result is environment-blocked in this container (`bunx` missing and no reachable local app base URL), so functional regression status could not be re-confirmed from this run.

Latest known CI root-cause fix applied:
- Deep-functional cross-browser session invalidation fixed by serializing workflow matrix (`max-parallel: 1`) in `.github/workflows/playwright-deep-functional-cross-browser.yml`.

## Drift Prevention Rules

- Update this file at the end of every execution block.
- Never mark a phase complete without linked evidence artifact.
- Record every failed gate with root-cause type: `harness`, `env`, `ux`, or `data`.

## Next Execution Block (Immediate)

- [ ] Implement parity tests for route/nav coverage and wire into CI.
- [ ] Complete sidebar and admin top-nav registry migration.
- [ ] Re-run human-test with standard credentials and attach report artifact.
- [ ] Re-baseline KPI timings for top 10 admin/officer journeys.

## Validation Commands (Executable)

- [ ] `bun run build`
- [ ] `bun run lint`
- [ ] `PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK=1 node scripts/human-test-engine.mjs`
- [ ] `node scripts/dr-bob-review.mjs --file docs/uiux-master-redesign/spec.md`
- [ ] `node scripts/dr-bob-review.mjs --file docs/uiux-master-redesign/plan.md`
- [ ] `node scripts/dr-bob-review.mjs --file docs/uiux-master-redesign/execution-todo.md`
