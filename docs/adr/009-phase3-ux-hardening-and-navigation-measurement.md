# ADR 009: Phase 3 UX Hardening and Navigation Measurement

## Status

Accepted

## Context

Phase 3 delivered route-level UX improvements across the top-10 operator routes, but follow-on work revealed two governance gaps:

1. Shared list-card patterns were duplicated across dense operator pages, increasing maintenance drift.
2. Baseline click-depth capture could not reliably populate medians in the current E2E environment because some sidebar route links are not visible at measurement time.

The platform needed a durable decision for how to standardize dense list-card UI and how to treat click-depth instrumentation limits without blocking all Phase 3 progress.

## Decision

Adopt the following Phase 3 architecture decisions:

1. **Shared list-card shell first, page migration incrementally**.
   - Introduce `src/components/features/ListCardRow.tsx` as the compact row primitive for dense operator cards.
   - Migrate high-density pages in batches instead of a single large refactor.
2. **Non-direct navigation measurement as default baseline policy**.
   - Baseline spec must attempt app-shell navigation from `/admin` and `/admin/dashboard`.
   - Direct `page.goto(route)` fallback is not used for click-depth capture.
   - If route links are not visible in shell state, record partial metrics and explicitly document blocker state.
3. **Keep route-level UX progress and instrumentation blockers separately tracked**.
   - Route tranche UX completion can be marked shipped when behavior is delivered.
   - D1 click-depth remains open until navigation visibility instrumentation is resolved.

## Consequences

- Positive: shared row-card styling now has a single reusable shell for future normalization.
- Positive: baseline evidence quality improves by avoiding direct-route click-depth shortcuts.
- Tradeoff: D1 may remain partial in environments where navigation links are not visible during measurement runs.
- Constraint: all future baseline workbook imports must include run IDs and explicit blocker notes when `clickDepth` remains null.

## Verification

- `src/components/features/ListCardRow.tsx` created and adopted in:
  - `src/pages/BreachAlerts.tsx`
  - `src/pages/NoiseControlPortal.tsx`
- Baseline instrumentation updated in:
  - `tests/e2e/phase3-ux-baseline-capture.spec.ts`
- Evidence updated in:
  - `docs/PHASE3_UX_BASELINE_CAPTURE_2026-05-03.md`
  - `docs/PHASE3_UX_OPERATOR_EFFICIENCY_TODO_2026-05-03.md`
  - `docs/STAGING.md`

## Mermaid

```mermaid
flowchart TD
  A[Login as admin role] --> B[/admin shell]
  B --> C{Visible route link?}
  C -- Yes --> D[Click route link]
  C -- No --> E[/admin/dashboard shell]
  E --> F{Visible route link?}
  F -- Yes --> G[Click route link]
  F -- No --> H[Record clickDepth=null + blocker note]
  D --> I[Capture time-to-primary-action]
  G --> I
  I --> J[Import workbook with run ID]
```
