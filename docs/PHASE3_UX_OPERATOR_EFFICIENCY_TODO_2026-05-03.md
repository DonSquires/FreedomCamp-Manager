# Phase 3 UX/Operator Efficiency To-Do List (Execution Artifact)

Date: 2026-05-03
Source of truth: docs/STAGING.md (Section 9)
Canonical linkage: docs/ENTERPRISE_PAIR_REVIEW_CANONICAL.md

## Phase Goal

Execute Phase 3 UX/operator-efficiency triage with measurable evidence, role-path simplification, and visual hierarchy cleanup while preserving route-role integrity and governance gates.

## Exit Criteria

- Top-friction routes triaged with owner and severity.
- High-impact fixes implemented or scheduled with acceptance criteria.
- Triad review confirms enterprise-appropriate UX trajectory.

## A. Deliverables

- [x] A1. UX triage list for high-impact readability/navigation issues
- [x] A2. Role-specific path simplification for high-frequency operations
- [x] A3. Visual hierarchy cleanup plan for dense pages

## B. Supporting Tasks

- [x] B1. Identify top-10 high-traffic routes from workflow matrix + route map
- [ ] B2. Capture route-level friction findings (time-to-task, click depth, error-prone actions)
- [x] B3. Classify quick wins into now/next/later slices
- [x] B4. Define measurable UX acceptance criteria by route family
- [x] B5. Map role-specific path simplifications for admin, admin_officer, officer, master
- [x] B6. Validate route/role alignment with docs/MODULE_ROADMAP.md and src/App.tsx
- [x] B7. Run triad review on Phase 3 artifact before implementation commit

Evidence:

- B1 route verification: docs/PHASE3_TOP10_ROUTE_VERIFICATION_2026-05-03.md
- Baseline capture workbook (for B2-D4): docs/PHASE3_UX_BASELINE_CAPTURE_2026-05-03.md
- A2/B5 role-path maps: docs/PHASE3_ROLE_PATH_SIMPLIFICATION_MAPS_2026-05-03.md
- A3 visual cleanup checklist: docs/PHASE3_VISUAL_HIERARCHY_CLEANUP_CHECKLIST_2026-05-03.md
- B7 triad record: docs/ENTERPRISE_PAIR_REVIEW_CANONICAL.md (Phase 3 Kickoff section)

## C. Validation Gates

- [x] C1. npm run lint (or bun run lint in Bun-enabled host)
- [x] C2. npm run build (or bun run build in Bun-enabled host)
- [x] C3. DOC_AUTHORITY_STRICT=true bun run lint:doc-authority
- [x] C4. node scripts/generate-route-role-matrix.mjs
- [x] C5. node scripts/validate-roadmap-role-gates.mjs --strict

Evidence (2026-05-03):

- `npm run lint` -> pass
- `npm run build` -> pass
- `DOC_AUTHORITY_STRICT=true npm run lint:doc-authority` -> pass
- `node scripts/generate-route-role-matrix.mjs` -> pass (route count: 121)
- `node scripts/validate-roadmap-role-gates.mjs --strict` -> pass

## D. Baseline Evidence Requirements (Before UX Code Changes)

- [ ] D1. Measured click depth for top-10 routes captured (not estimates)
- [x] D2. Median time-to-primary-action per route family captured
- [x] D3. Error-prone action count from operator walkthrough samples captured
- [x] D4. Evidence snapshot recorded in STAGING session note

## E. Shipping Slices

### P1 Now-Slice (Ranks 1-5) — SHIPPED 2026-05-04 commit 7185e979

- [x] E1. /compliance — sticky quick-action bar with live KPIs + Analytics/View Observations buttons
- [x] E2. /dispatch-monitor — red alert strip above fold for Duress / Not Acknowledged / Over SLA
- [x] E3. /job-map — active job count badge in page heading
- [x] E4. /observations — summary bar (Total/Compliant/In Breach) made sticky with backdrop blur
- [x] E5. /radio — `/radio/log` link already surfaced (depth=1, no change required)

### P2 Next-Slice (Ranks 6-10) — SHIPPED 2026-05-04 commit 69a45c3d

- [x] E6. /breaches — breach summary strip above fold for pending and enforcement-active counts
- [x] E7. /reports — no code change required; summary grid + export bar already above fold and met slice goal
- [x] E8. /crm — added missing GlobalFilterRibbon so org context remains visible on the CRM hub
- [x] E9. /live-patrol — welfare alert strip listing officers with overdue welfare checks
- [x] E10. /noise-control — urgent-job strip above fold for immediate dispatch attention

## F. Governance Decision

- [x] F1. Triad decision recorded (GO/CONDITIONAL_GO/NO_GO)
- [x] F2. Blockers resolved or converted to target-state gaps with owner/date/evidence
- [x] F3. Canonical and STAGING updated with run IDs and artifact links

## 2026-05-04 Continuation Notes

- Validation gates re-run on current head: lint/build/doc-authority/route-role strict all pass.
- P1 route tranche shipped in commit `7185e979`.
- P2 route tranche shipped in commit `69a45c3d`.
- Shared chrome follow-on started on current head: `AppLayout` now owns the active breadcrumb trail for route context, completing the documented Slice A nav-chrome target from STAGING `P3-1`.
- Top-10 route efficiency pass is now complete at the route level; remaining Phase 3 work shifts to shared chrome, dashboard density, standardized list cards, CI cadence, and retrospective/governance closeout.
- Baseline capture re-run with shared fallback credentials:
	- `PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK=1 bunx playwright test tests/e2e/phase3-ux-baseline-capture.spec.ts --project=chromium --reporter=list`
	- `node scripts/import-phase3-baseline.mjs --input test-results/phase3-ux-baseline.json --run-id local-2026-05-04-phase3-nondirect-v2`
- Remaining open gate: D1 click-depth medians are still pending because triaged route links are not visible from the measured `/admin` and `/admin/dashboard` shell state in the current Playwright environment.
- Role-path redirect audit evidence refreshed:
	- `PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK=1 bunx playwright test tests/e2e/phase3-role-path-redirect.spec.ts --project=chromium --reporter=list`
	- Result: `20 passed (1.8m)`
- Triad CI blocker evidence captured:
	- `gh workflow run phase3-ux-baseline-capture.yml`
	- Result: `HTTP 403: Resource not accessible by integration`
	- Recent workflow runs for `.github/workflows/phase3-ux-baseline-capture.yml` show failure conclusions (`25303176478`, `25294265720`)
