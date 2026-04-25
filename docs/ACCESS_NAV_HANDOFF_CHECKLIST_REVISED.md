# Access + Navigation Handoff Checklist (Revised)

**Status:** Revised to address Bob adversarial review blockers  
**Date:** 2026-04-25  
**Owner expectation:** Execute in order and do not skip validation gates. Bob's 3 blockers must be resolved before implementation.

---

## Bob Blocker Resolution Checklist

### Blocker 1: Ground `accessRegistry.ts` in `system_state.json`

**Action:** Before creating `src/config/accessRegistry.ts`, update `system_state.json`:

1. Add a new top-level key:
   ```json
   "access_config": {
     "registry_path": "src/config/accessRegistry.ts",
     "schema_version": "1.0.0",
     "fields": ["path", "label", "area", "allowedRoles", "navSurface", "aliasOf", "redirectTo"],
     "last_updated": "2026-04-25"
   }
   ```

2. Ensure `src/config/accessRegistry.ts` exports a constant-named registry (e.g., `REGISTRY_V1`) that is referenced in code comments linking to `system_state.json`.

3. Add a comment at the top of `accessRegistry.ts`:
   ```typescript
   // FieldOps Manager Access Registry v1
   // Grounded in: system_state.json::access_config
   // Last validated: 2026-04-25
   ```

**Validation:** `system_state.json` schema includes access_config, and registry.ts includes backref.

---

### Blocker 2: Robust Test Isolation

**Action:** Implement test gating with environment flag and clear separation:

1. **Create gates in test infrastructure:**
   - Edit `tests/e2e/module-route-access.spec.ts`:
     - Remove all `bob-ui-assess` imports and calls.
     - Keep only auth + navigation + redirect assertions.
     - Add comment: `// Route access tests are isolated; Bob scoring is gated separately`.

   - Create new file `tests/e2e/bob-ui-assess.spec.ts`:
     - Gate all tests with: `test.skip(process.env.RUN_BOB_UI_ASSESS !== '1', ...)`
     - Artifact attachment and scoring happens only in this suite.
     - Add note: `// This suite requires RUN_BOB_UI_ASSESS=1 and is optional`.

2. **Document in README** or test harness docs:
   ```
   Run all tests:  npx playwright test
   Run bob-ui-assess only:  RUN_BOB_UI_ASSESS=1 npx playwright test bob-ui-assess.spec.ts
   Run without bob-ui-assess:  npx playwright test --ignore='**/bob-ui-assess.spec.ts'
   ```

3. **Prevent flakiness:**
   - Configure bob-ui-assess tests with `retries: 0` (no retry loop; if Bob service is unavailable, skip gracefully).
   - Add skip logic: `test.skip(!process.env.INFERENCE_SERVICE_URL, 'Bob service not available')`.

**Validation:** Route access suite passes without Bob service. Bob suite runs only when gated.

---

### Blocker 3: Multi-org Scope Consideration

**Action:** Add org-context filtering to route access logic:

1. **Update `src/App.tsx`:**
   - After user auth, fetch the user's org(s) from `useOrganization()` hook (create if missing).
   - Create helper function:
     ```typescript
     function getAccessibleRoutes(user, userOrgs) {
       // Filter REGISTRY entries:
       // 1. Check role access (allowedRoles)
       // 2. Check org context: if route has `orgScoped: true` and route.orgId !== userOrgs[0].id, hide it
       // 3. Return filtered list
     }
     ```

   - Use `getAccessibleRoutes()` to build dynamic route list before rendering `<Routes>`.

2. **Update `src/config/accessRegistry.ts` schema:**
   - Add optional field: `orgScoped?: boolean` (default: false).
   - Add optional field: `requiredOrgCapability?: string` (e.g., `"admin"`, `"monitor"`).
   - Document in comments which routes are org-scoped vs global.

3. **Update `AppLayout.tsx` and `AdminNavigationMenu.tsx`:**
   - Pass `user.org` context when filtering menu items from registry.
   - Example:
     ```typescript
     const visibleMenuItems = registry.filter(
       entry => entry.allowedRoles.includes(user.role) 
              && (!entry.orgScoped || entry.orgScoped === false || entry.orgId === user.org.id)
     )
     ```

4. **Test multi-org scenarios:**
   - Add test credentials for multiple orgs (e.g., `adminOrg1`, `adminOrg2`).
   - Verify Org1 admin sees only Org1-scoped routes.
   - Verify Grand Master sees all routes (global bypass).

**Validation:** Multi-org filtering works; org admins see only their org's routes.

---

## 0. Preconditions (Updated)

1. Use a dedicated branch for this work.
2. Ensure `system_state.json` is updated with `access_config` (Blocker 1 resolution).
3. Ensure local test credentials are available for: master, grand_master, adminOrg1, adminOrg2, admin_officer, officer, client_viewer, nzscv_monitor.
4. Confirm baseline tests run before edits:
   - `bun run build`
   - `bun run lint`
   - `npx playwright test tests/e2e/module-route-access.spec.ts --reporter=line`

---

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

---

## 2. Single Source of Truth Registry

Drift points to remove:

- `src/App.tsx`
- `src/components/features/AppLayout.tsx`
- `src/components/features/AdminNavigationMenu.tsx`

Create:

- `src/config/accessRegistry.ts` (grounded in `system_state.json` per Blocker 1 resolution)

Registry contract (minimum, updated with org scope):

1. `path`
2. `label`
3. `area` or `capability` key
4. `allowedRoles`
5. `navSurface` (for example `admin-layout`, `admin-menu`, `both`, `hidden`)
6. `aliasOf` (optional)
7. `redirectTo` (optional explicit alias redirect)
8. `orgScoped?: boolean` (optional, default: false; part of Blocker 3 resolution)
9. `requiredOrgCapability?: string` (optional, for org-level access gates)

Actions:

1. Move route access metadata into registry entries.
2. Replace hardcoded role arrays in `AppLayout.tsx` with registry-derived filtering (using `getAccessibleRoutes()` for org context).
3. Replace static `primaryLinks` and `moreGroups` in `AdminNavigationMenu.tsx` with registry-derived sections.
4. Update `App.tsx` route guard wrappers to read allowed roles/capabilities from registry and apply org filtering.
5. Keep non-navigable utility routes out of visible menu by `navSurface` rules.

Validation:

1. There is one canonical definition for role access per route.
2. No duplicate hardcoded role lists remain in the three drift files.
3. Org-scoped routes are filtered correctly per user's org (Blocker 3 validation).

---

## 3. Role Parity Rules (master vs grand_master)

Primary mismatch anchor:

- `src/components/features/AppLayout.tsx`

Required parity policy:

1. Document intended behavior explicitly in code comments and registry docs:
   - Global bypass scope for `grand_master` (sees all routes, all orgs).
   - Intended `master` parity or deltas by capability.
   - Intended multi-org consideration: master may be org-limited.
2. Use the same parity policy for:
   - Route access checks.
   - Menu visibility checks.
   - Org-context filtering.
3. Remove implicit remapping patterns that can drift (for example role substitution without explicit capability mapping).

Validation:

1. `master` and `grand_master` see intentionally correct menus for all shared modules.
2. Any deltas are explicit in registry entries, not hidden in component logic.
3. Org-scoped routes display correctly for limited-scope roles (Blocker 3).

---

## 4. Harness Split (Access tests vs Bob scoring)

Current coupling to remove (Blocker 2 resolution):

- `tests/e2e/module-route-access.spec.ts` must be decoupled from Bob UI assessment.
- `tests/e2e/bob-ui-assess.ts` becomes optional and gated.

Actions:

1. Remove Bob UI scoring calls from `module-route-access.spec.ts`.
2. Keep route-access assertions pure (auth + navigation + redirects only).
3. Create a separate gated suite for Bob scoring:
   - File: `tests/e2e/bob-ui-assess.spec.ts`
   - Gate: `test.skip(process.env.RUN_BOB_UI_ASSESS !== '1', ...)`
4. Add graceful skip logic if Bob service is unavailable:
   - `test.skip(!process.env.INFERENCE_SERVICE_URL, 'Bob service not available')`
5. Configure bob-ui-assess tests with `retries: 0`.
6. Document gating in README or test harness docs.
7. Keep artifact attachment behavior in Bob suite only.

Validation:

1. Route access suite passes with no Bob service availability.
2. Bob scoring suite can run independently when env is configured (`RUN_BOB_UI_ASSESS=1`).
3. No test flakiness due to Bob service outages.

---

## 5. Acceptance Gates

Functional gates:

1. Every visible menu link either:
   - Loads a valid page, or
   - Intentionally redirects as an explicit alias with documented `aliasOf`/`redirectTo`.
2. No user sees menu items they cannot access.
3. No user sees routes scoped to other organizations (Blocker 3 validation).
4. Route guards and menu visibility are consistent for each role and org.

Test gates:

1. Role matrix route tests pass reliably with local credentials (including multi-org scenarios).
2. Module route access tests are deterministic across repeated runs.
3. Bob UI scoring side effects do not affect route access pass/fail.
4. Route access tests pass without Bob service running.

Suggested commands:

1. `bun run build`
2. `bun run lint`
3. `npx playwright test tests/e2e/module-route-access.spec.ts --repeat-each=2 --reporter=line`
4. `RUN_BOB_UI_ASSESS=1 npx playwright test tests/e2e/bob-ui-assess.spec.ts --reporter=line` (when Bob service is available)
5. `npx playwright test --ignore='**/bob-ui-assess.spec.ts'` (run all tests except Bob-dependent)

---

## 6. Definition of Done

1. Catch-all route is final in route tree.
2. Access registry is canonical, grounded in `system_state.json`, and consumed by routing and both navigation surfaces.
3. Multi-org filtering is implemented and tested (Blocker 3 resolved).
4. `master` and `grand_master` parity is intentional and documented.
5. Access tests are isolated from Bob scoring (Blocker 2 resolved).
6. Acceptance gates pass and are reproducible locally.
7. Bob's conditional pass sign-off is achieved by resolving all 3 blockers.

---

## Notes

- **Blocker Resolution Tracking:** Each blocker has a dedicated section above. Mark resolution as complete when actions are done and validations pass.
- **Multi-org Scope:** This is a critical gap in the original checklist. Ensure `useOrganization()` hook is available or create it before step 2.
- **Test Isolation:** The gating mechanism prevents Bob service outages from breaking route access tests.
