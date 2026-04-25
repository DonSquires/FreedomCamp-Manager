# Access + Navigation Handoff Checklist

Purpose: execution checklist for container handoff to implement route-order fix, unified authorization registry, role parity, and test harness decoupling.

Owner expectation: execute in order and do not skip validation gates.

## 0. Preconditions

1. Use a dedicated branch for this work.
2. Ensure local test credentials are available for: master, grand_master, adminOrg1, admin_officer, officer, client_viewer, nzscv_monitor.
3. Confirm baseline tests run before edits:
   - `bun run build`
   - `bun run lint`
   - `npx playwright test tests/e2e/module-route-access.spec.ts --reporter=line`

## 1. Route Order Fix (App.tsx)

Target file: `src/App.tsx`

Actions:

1. Locate catch-all route `path="*"` (currently near end of route tree).
2. Ensure the catch-all is the final route inside `<Routes>` with no routes declared after it.
3. Keep explicit alias redirects (for example `/diagnostics`, `/photo-reingest`) above the catch-all.
4. Add a short comment above catch-all route:
   - `// Keep catch-all as final route to prevent shadowing valid paths.`

Validation:

1. Deep-link a known route and verify it does not fall through to catch-all.
2. Visit an unknown path and verify redirect behavior matches current intent.

## 2. Single Source of Truth Registry

Drift points to remove:

- `src/App.tsx`
- `src/components/features/AppLayout.tsx`
- `src/components/features/AdminNavigationMenu.tsx`

Create:

- `src/config/accessRegistry.ts`

Registry contract (minimum):

1. `path`
2. `label`
3. `area` or `capability` key
4. `allowedRoles`
5. `navSurface` (for example `admin-layout`, `admin-menu`, `both`, `hidden`)
6. `aliasOf` (optional)
7. `redirectTo` (optional explicit alias redirect)

Actions:

1. Move route access metadata into registry entries.
2. Replace hardcoded role arrays in `AppLayout.tsx` with registry-derived filtering.
3. Replace static `primaryLinks` and `moreGroups` in `AdminNavigationMenu.tsx` with registry-derived sections.
4. Update `App.tsx` route guard wrappers to read allowed roles/capabilities from registry.
5. Keep non-navigable utility routes out of visible menu by `navSurface` rules.

Validation:

1. There is one canonical definition for role access per route.
2. No duplicate hardcoded role lists remain in the three drift files.

## 3. Role Parity Rules (master vs grand_master)

Primary mismatch anchor:

- `src/components/features/AppLayout.tsx`

Required parity policy:

1. Document intended behavior explicitly in code comments and registry docs:
   - Global bypass scope for `grand_master`.
   - Intended `master` parity or deltas by capability.
2. Use the same parity policy for:
   - Route access checks.
   - Menu visibility checks.
3. Remove implicit remapping patterns that can drift (for example role substitution without explicit capability mapping).

Validation:

1. `master` and `grand_master` see intentionally correct menus for all shared modules.
2. Any deltas are explicit in registry entries, not hidden in component logic.

## 4. Harness Split (Access tests vs Bob scoring)

Current coupling to remove:

- `tests/e2e/module-route-access.spec.ts` imports and invokes Bob UI assessment helper.
- `tests/e2e/bob-ui-assess.ts` introduces external service side effects in route access suite.

Actions:

1. Remove Bob UI scoring calls from `module-route-access.spec.ts`.
2. Keep route-access assertions pure (auth + navigation + redirects only).
3. Create a separate optional suite for Bob scoring, for example:
   - `tests/e2e/bob-ui-assess.spec.ts`
4. Gate Bob suite by explicit env flag (for example `RUN_BOB_UI_ASSESS=1`) and skip when unset.
5. Keep artifact attachment behavior in Bob suite only.

Validation:

1. Route access suite passes with no Bob service availability.
2. Bob scoring suite can run independently when env is configured.

## 5. Acceptance Gates

Functional gates:

1. Every visible menu link either:
   - Loads a valid page, or
   - Intentionally redirects as an explicit alias with documented `aliasOf`/`redirectTo`.
2. No user sees menu items they cannot access.
3. Route guards and menu visibility are consistent for each role.

Test gates:

1. Role matrix route tests pass reliably with local credentials.
2. Module route access tests are deterministic across repeated runs.
3. Bob UI scoring side effects do not affect route access pass/fail.

Suggested commands:

1. `bun run build`
2. `bun run lint`
3. `npx playwright test tests/e2e/module-route-access.spec.ts --repeat-each=2 --reporter=line`
4. `RUN_BOB_UI_ASSESS=1 npx playwright test tests/e2e/bob-ui-assess.spec.ts --reporter=line`

## 6. Definition of Done

1. Catch-all route is final in route tree.
2. Access registry is canonical and consumed by routing and both navigation surfaces.
3. `master` and `grand_master` parity is intentional and documented.
4. Access tests are isolated from Bob scoring.
5. Acceptance gates pass and are reproducible locally.
