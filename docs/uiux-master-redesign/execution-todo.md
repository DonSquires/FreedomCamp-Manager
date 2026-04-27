# UI/UX Rebuild Execution To-Do

Status: active tracker
Date: 2026-04-26

## Confidence Rule

Do not claim completion until all release gates in this checklist are green.

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

### Phase 2 - Section Shell Rollout
- [ ] Standard page shell anatomy applied to top-priority admin views
- [ ] Standard page shell anatomy applied to top-priority officer views
- [ ] Route aliases and backward compatibility validated
- [ ] Org context indicator and quick-switch validated

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

## Current Measurement Snapshot

- Latest human-test report (fallback mode): `tools/human-test-engine/reports/2026-04-26T15-07-18-264Z/report.md`
- Operational Readiness: 91%
- Remaining blockers: 1 agentic functional failure (`tender-shadow`) and 2 Playwright failures (`/breaches` timeout and `/hotspots` redirect mismatch)

Latest re-validation attempt:
- `tools/human-test-engine/reports/2026-04-26T21-09-51-047Z/report.md`
- Result is environment-blocked in this container (`bunx` missing and no reachable local app base URL), so functional regression status could not be re-confirmed from this run.

## Drift Prevention Rules

- Update this file at the end of every execution block.
- Never mark a phase complete without linked evidence artifact.
- Record every failed gate with root-cause type: `harness`, `env`, `ux`, or `data`.

## Validation Commands (Executable)

- [ ] `bun run build`
- [ ] `bun run lint`
- [ ] `PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK=1 node scripts/human-test-engine.mjs`
- [ ] `node scripts/dr-bob-review.mjs --file docs/uiux-master-redesign/spec.md`
- [ ] `node scripts/dr-bob-review.mjs --file docs/uiux-master-redesign/plan.md`
- [ ] `node scripts/dr-bob-review.mjs --file docs/uiux-master-redesign/execution-todo.md`
