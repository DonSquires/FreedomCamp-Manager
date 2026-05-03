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

- [ ] A1. UX triage list for high-impact readability/navigation issues
- [ ] A2. Role-specific path simplification for high-frequency operations
- [ ] A3. Visual hierarchy cleanup plan for dense pages

## B. Supporting Tasks

- [x] B1. Identify top-10 high-traffic routes from workflow matrix + route map
- [ ] B2. Capture route-level friction findings (time-to-task, click depth, error-prone actions)
- [ ] B3. Classify quick wins into now/next/later slices
- [ ] B4. Define measurable UX acceptance criteria by route family
- [ ] B5. Map role-specific path simplifications for admin, admin_officer, officer, master
- [ ] B6. Validate route/role alignment with docs/MODULE_ROADMAP.md and src/App.tsx
- [ ] B7. Run triad review on Phase 3 artifact before implementation commit

Evidence:

- B1 route verification: docs/PHASE3_TOP10_ROUTE_VERIFICATION_2026-05-03.md
- Baseline capture workbook (for B2-D4): docs/PHASE3_UX_BASELINE_CAPTURE_2026-05-03.md

## C. Validation Gates

- [ ] C1. npm run lint (or bun run lint in Bun-enabled host)
- [ ] C2. npm run build (or bun run build in Bun-enabled host)
- [ ] C3. DOC_AUTHORITY_STRICT=true bun run lint:doc-authority
- [ ] C4. node scripts/generate-route-role-matrix.mjs
- [ ] C5. node scripts/validate-roadmap-role-gates.mjs --strict

## D. Baseline Evidence Requirements (Before UX Code Changes)

- [ ] D1. Measured click depth for top-10 routes captured (not estimates)
- [ ] D2. Median time-to-primary-action per route family captured
- [ ] D3. Error-prone action count from operator walkthrough samples captured
- [ ] D4. Evidence snapshot recorded in STAGING session note

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

- [ ] F1. Triad decision recorded (GO/CONDITIONAL_GO/NO_GO)
- [ ] F2. Blockers resolved or converted to target-state gaps with owner/date/evidence
- [ ] F3. Canonical and STAGING updated with run IDs and artifact links
