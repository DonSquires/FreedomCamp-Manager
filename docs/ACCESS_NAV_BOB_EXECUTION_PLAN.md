# Access/Nav Redesign Execution Plan (Bob-Assisted)

Status: handoff-ready execution plan for a second container.

Scope source: user-requested extra criteria

- Route-order correctness in route tree.
- Single source of truth for route access and menu visibility.
- Intentional parity between `master` and `grand_master`.
- Decoupled route-access tests from Bob UI scoring.
- Deterministic acceptance gates for role matrix + module route tests.

## 1. Why This Matters

Current access behavior is split across multiple files and patterns. This creates drift between:

- What the app allows (`App.tsx` guard logic)
- What users see (`AppLayout.tsx`, `AdminNavigationMenu.tsx`)
- What tests validate (`module-route-access.spec.ts` with Bob side effects)

The redesign objective is to make access and navigation behavior predictable, testable, and tenant-safe.

## 2. Grounded Evidence Summary

Repo-grounded anchors:

- Route and guard orchestration: `src/App.tsx`
- Primary nav role arrays and role remapping behavior: `src/components/features/AppLayout.tsx`
- Admin menu static links/groups: `src/components/features/AdminNavigationMenu.tsx`
- Route matrix E2E currently coupled to Bob scoring: `tests/e2e/module-route-access.spec.ts`
- Bob screenshot helper: `tests/e2e/bob-ui-assess.ts`

External guidance integrated:

- OWASP Authentication Cheat Sheet: centralized auth decisions and consistent enforcement boundaries.
- NIST SP 800-63B: authentication assurance and risk-based controls.
- Supabase Auth + RLS guidance: UI checks are advisory; backend/data checks remain authoritative.
- Auth0 architecture references: role/capability centralization and policy consistency patterns.

## 3. Target Design

### 3.1 Canonical Registry

Create one registry file:

- `src/config/accessRegistry.ts`

Minimum entry shape:

```ts
type AccessRegistryEntry = {
  path: string
  label?: string
  allowedRoles: Array<'officer' | 'admin_officer' | 'admin' | 'master' | 'grand_master' | 'nzscv_monitor' | 'client_viewer'>
  area?: string
  capability?: string
  navSurface: 'app-layout' | 'admin-menu' | 'both' | 'hidden'
  navGroup?: string
  aliasOf?: string
  redirectTo?: string
  enabled?: boolean
}
```

Design rule: no other file defines route-role access lists directly.

### 3.2 Enforcement Model

1. `App.tsx` route guards read allowed roles/area/capability from registry.
2. `AppLayout.tsx` visible items are filtered only from registry.
3. `AdminNavigationMenu.tsx` primary/more groups are generated from registry.
4. Alias routes are explicit via registry metadata (`aliasOf`, `redirectTo`) and rendered as redirects in route tree.

### 3.3 Role Parity Model

Policy (explicit):

- `grand_master`: platform-wide access with explicit exceptions (if any) documented in registry.
- `master`: operational super-admin with defined capability deltas vs `grand_master`.

No hidden remapping in components. Any delta must be expressed per-route in registry.

## 4. Bob in Planning + Delivery Workflow

### 4.1 Bob Responsibilities

Bob should be used for:

1. Adversarial review of plan artifacts before implementation.
2. Consistency checks after each phase (registry vs routes vs menus vs tests).
3. High-risk drift detection (routes visible but blocked, blocked but visible, alias mismatch).

Bob should not be in the critical path of route-access tests.

### 4.2 Bob Gatepoints

Gate A (before coding):

- Review this execution plan and checklist artifacts with Dr Bob.

Gate B (after registry + route refactor):

- Bob checks mismatch report:
  - route exists but missing registry entry
  - registry entry visible in menu but no route
  - role visibility mismatch between menu and guard

Gate C (after test harness split):

- Bob validates that route matrix suite has zero dependency on scoring services.

Gate D (pre-merge):

- Bob reviews final diff + acceptance evidence.

## 5. Execution Sequence (Other Container)

### Phase 1: Route-Tree Hygiene

Files:

- `src/App.tsx`

Tasks:

1. Move/keep catch-all route as last route in `<Routes>`.
2. Ensure alias redirects remain before catch-all.
3. Add comment documenting this invariant.

Deliverable:

- route order invariant established.

### Phase 2: Registry Introduction

Files:

- `src/config/accessRegistry.ts` (new)
- `src/App.tsx`
- `src/components/features/AppLayout.tsx`
- `src/components/features/AdminNavigationMenu.tsx`

Tasks:

1. Seed registry with existing navigable modules first.
2. Refactor guards to consume registry definitions.
3. Refactor both nav surfaces to consume registry filtering/grouping.
4. Remove duplicated static role arrays from drift files.

Deliverable:

- one canonical access/navigation source.

### Phase 3: Parity Hardening

Files:

- `src/config/accessRegistry.ts`
- `src/components/features/AppLayout.tsx`

Tasks:

1. Encode `master` vs `grand_master` parity as explicit route entries.
2. Remove implicit role translation logic where possible.
3. Add docs comments for intentional deltas.

Deliverable:

- deterministic parity behavior for routes and menus.

### Phase 4: Test Harness Split

Files:

- `tests/e2e/module-route-access.spec.ts`
- `tests/e2e/bob-ui-assess.ts`
- `tests/e2e/bob-ui-assess.spec.ts` (new)

Tasks:

1. Remove `bobAssessPage` calls from route-access suite.
2. Keep access suite assertions focused on auth+routing only.
3. Create Bob scoring suite and guard by env toggle (`RUN_BOB_UI_ASSESS=1`).
4. Keep scoring artifacts in Bob suite only.

Deliverable:

- deterministic route tests independent of Bob service health.

### Phase 5: Acceptance Verification

Tasks:

1. Build and lint clean.
2. Role-matrix tests pass repeatedly.
3. Menu-to-route parity validated for each role.
4. Alias behavior is explicit and documented.

Deliverable:

- merge-ready evidence package.

## 6. Acceptance Matrix

For each role (`grand_master`, `master`, `admin`, `admin_officer`, `officer`, `client_viewer`, `nzscv_monitor`):

1. Visible menu items map to accessible routes.
2. Hidden menu items are inaccessible directly (or redirect intentionally).
3. Alias routes redirect to canonical routes consistently.
4. No route exists with missing registry metadata.

## 7. Command Set

Core:

1. `bun run build`
2. `bun run lint`
3. `npx playwright test tests/e2e/module-route-access.spec.ts --repeat-each=2 --reporter=line`

Optional Bob scoring:

1. `RUN_BOB_UI_ASSESS=1 npx playwright test tests/e2e/bob-ui-assess.spec.ts --reporter=line`

## 8. Risks and Mitigations

Risk 1: Registry migration misses routes.

- Mitigation: generate route inventory and reconcile with registry before cutover.

Risk 2: Nav grouping regressions from static-to-dynamic conversion.

- Mitigation: snapshot menu expectations by role in E2E.

Risk 3: master/grand_master behavior drift.

- Mitigation: explicit parity tests + no implicit remapping logic.

Risk 4: Bob service instability affects CI.

- Mitigation: separate Bob suite and make it opt-in/non-blocking for route-access gate.

## 9. Definition of Done

1. Catch-all route is final and guarded by invariant comment.
2. One registry controls both route guards and menu visibility.
3. master/grand_master parity is explicit and test-backed.
4. Access-control tests are Bob-independent.
5. Bob review gates are completed and documented in PR notes.
