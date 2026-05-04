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

### P1 Now-Slice (Ranks 1-5)

- [ ] E1. /compliance
- [ ] E2. /dispatch-monitor
- [ ] E3. /job-map
- [ ] E4. /observations
- [ ] E5. /radio

### P2 Next-Slice (Ranks 6-10)

- [ ] E6. /breaches
- [ ] E7. /reports
- [ ] E8. /crm
- [ ] E9. /live-patrol
- [ ] E10. /noise-control

## F. Governance Decision

- [x] F1. Triad decision recorded (GO/CONDITIONAL_GO/NO_GO)
- [x] F2. Blockers resolved or converted to target-state gaps with owner/date/evidence
- [x] F3. Canonical and STAGING updated with run IDs and artifact links

## 2026-05-04 Continuation Notes

- Validation gates re-run on current head: lint/build/doc-authority/route-role strict all pass.
- Baseline capture re-run with shared fallback credentials:
	- `PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK=1 bunx playwright test tests/e2e/phase3-ux-baseline-capture.spec.ts --project=chromium --reporter=list`
	- `node scripts/import-phase3-baseline.mjs --input test-results/phase3-ux-baseline.json --run-id local-2026-05-04-phase3-baseline`
- Remaining open gate: D1 click-depth medians are still pending because baseline run currently navigates directly to routes in this environment.
