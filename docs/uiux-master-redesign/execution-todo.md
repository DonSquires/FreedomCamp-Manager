# UI/UX Rebuild Execution To-Do

Status: active tracker
Date: 2026-04-26

## Review Basis (Last 12 Hours)

- Schema references reviewed:
	- `docs/LIVE_SCHEMA.md`
	- `docs/SCHEMA6_TABLE_RECONCILIATION.md`
	- `docs/LIVE_FUNCTIONS.md`
	- `docs/LIVE_TRIGGERS.md`
- UI/UX artifact set reviewed:
	- `docs/uiux-master-redesign/spec.md`
	- `docs/uiux-master-redesign/plan.md`
	- `docs/uiux-master-redesign/self-critique.md`
- Recent change history reviewed (last 12h):
	- `be18bfc6` docs/uiux tracker + scaffold loader update
	- `f9e10c43` clean dashboard UX navigation/refresh improvements
	- `ff8d6ae6` deep-functional CI matrix serialization root-cause fix

## Confidence Rule

Do not claim completion until all release gates in this checklist are green.

## Current Confidence

- Confidence: 88%
- Why not 100% yet:
	1. Navigation registry migration is only partially applied.
	2. Parity tests exist locally but are not yet wired as a CI-required gate.
	3. Human-test standard-credential rerun is still outstanding.
	4. Phase 2 shell rollout is not validated on top-priority officer/admin journeys.

## Hard Blockers (Must Close)

- [ ] B1: Route/nav parity test suite implemented, green, and CI-enforced (`ux`)
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
	- Evidence: local CLI baseline validated in current branch setup session.
- [x] bun and bunx available
	- Evidence: bun/bunx installed and used in workflow and local commands; non-zero exits were app/runtime failures, not missing binaries.
- [x] ripgrep (`rg`) installed
	- Evidence: `rg` used across recent CI/debug sessions and this document review pass.
- [ ] Playwright role credentials fully configured (no fallback required)

## Plan Execution Checklist

### Phase 0 - Baseline and Instrumentation
- [x] Route inventory generated from `src/App.tsx`
	- Evidence: `docs/uiux-master-redesign/artifacts/route-inventory-2026-04-27.md`
- [x] Module inventory generated from `src/modules/registry.ts`
	- Evidence: `docs/uiux-master-redesign/artifacts/module-inventory-2026-04-27.md`
- [x] Schema-to-IA reconciliation completed against `docs/LIVE_SCHEMA.md`
	- Evidence: `docs/uiux-master-redesign/artifacts/schema-ia-reconciliation-2026-04-27.md`
- [x] UX telemetry event set defined (`nav_click`, `route_entry`, `route_backtrack`, `time_to_first_action`, `portal_switch`)
	- Evidence: `docs/uiux-master-redesign/artifacts/ux-telemetry-events-v1-2026-04-27.md`
- [ ] Coverage report generated (zero unmapped route families/modules)

Exit gate:
- [ ] Phase 0 complete with published inventory artifact and zero unmapped coverage entries.

### Phase 0.5 - Human-Test Harness Stabilization
- [x] Add base URL readiness gate for agentic packs
	- Evidence: implemented in `scripts/human-test-engine.mjs` and reflected by tracker update commit `be18bfc6`.
- [ ] Re-run human-test with standard credentials
- [x] Re-run human-test with fallback mode for comparison
	- Evidence: `tools/human-test-engine/reports/2026-04-26T15-07-18-264Z/report.md`.
- [x] Confirm no harness bootstrap failures remain
	- Evidence: fallback-mode report above plus latest harness notes in this tracker.

### Phase 1 - Canonical IA Registry
- [x] `ia_redesign_config` grounded in `system_state.json`
	- Evidence: completed prior to tracker hardening; marked in active execution stream artifacts.
- [x] `src/config/navigationRegistry.ts` scaffold added
	- Evidence: registry scaffold exists at `src/config/navigationRegistry.ts`.
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
- Result is environment-blocked in this container (no reachable local app base URL at time of run), so functional regression status could not be re-confirmed from this run.

Latest known CI root-cause fix applied:
- Deep-functional cross-browser session invalidation fixed by serializing workflow matrix (`max-parallel: 1`) in `.github/workflows/playwright-deep-functional-cross-browser.yml`.

## Drift Prevention Rules

- Update this file at the end of every execution block.
- Never mark a phase complete without linked evidence artifact.
- Record every failed gate with root-cause type: `harness`, `env`, `ux`, or `data`.

## Next Execution Block (Immediate)

- [ ] Generate and validate route-family/module coverage report (zero unmapped required).
	- Owner: platform/frontend
	- Deliverable: `docs/uiux-master-redesign/artifacts/coverage-report-<date>.md` with explicit mapped/unmapped sections.
- [ ] Wire parity tests for route/nav coverage into CI.
	- Owner: platform/frontend
	- Deliverable: deterministic test suite for registry coverage and nav rendering parity.
	- Evidence (implemented locally): `src/config/navigationRegistry.parity.test.ts` and local pass via `bunx vitest run src/config/navigationRegistry.parity.test.ts`.
- [ ] Complete sidebar and admin top-nav registry migration.
	- Owner: frontend/navigation
	- Deliverable: no primary nav surface using hardcoded route arrays.
- [ ] Re-run human-test with standard credentials and attach report artifact.
	- Owner: QA/automation
	- Deliverable: new report under `tools/human-test-engine/reports/` with standard credentials.
- [ ] Re-baseline KPI timings for top 10 admin/officer journeys.
	- Owner: product/analytics
	- Deliverable: baseline snapshot with timestamp and method section.

## Action-Ready Sequence (Strict)

1. Complete Phase 0 remaining items and publish artifacts.
2. Close Hard Blockers B1-B2 before any Phase 2 shell rollout work.
3. Run standard-credential human-test and update blocker B3 status.
4. Run deep-functional role-critical routes after nav migration and update blocker B4.
5. Only then proceed to Phase 2 visual shell expansion.

## Validation Commands (Executable)

- [ ] `bun run build`
- [ ] `bun run lint`
- [ ] `PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK=1 node scripts/human-test-engine.mjs`
- [ ] `node scripts/dr-bob-review.mjs --file docs/uiux-master-redesign/spec.md`
- [ ] `node scripts/dr-bob-review.mjs --file docs/uiux-master-redesign/plan.md`
- [ ] `node scripts/dr-bob-review.mjs --file docs/uiux-master-redesign/execution-todo.md`
