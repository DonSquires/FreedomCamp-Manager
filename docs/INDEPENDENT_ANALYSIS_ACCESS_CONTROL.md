# Independent Analysis: FieldOps Manager Access Control Redesign

**Date:** 2026-04-25  
**Reviewer:** GitHub Copilot (Independent Analysis)  
**Scope:** Full schema audit + comparison with industry best practices + forward-looking evolution  

---

## Executive Summary

FieldOps Manager has a **strong foundation** (81 lines of code audit across RoleRoute, AreaRoute, App.tsx route guards, Supabase RLS). However, it has **three critical gaps** that create UX friction and maintenance debt:

1. **Menu Visibility Gap**: All 60+ menu items visible to all authenticated users; access enforced at route level, not UI level → silent redirects, confusion
2. **Org-Scoped Routing Gap**: 4 organization hooks exist (useOrganization, useOrganizations, etc.) but organization context is NOT part of route filtering logic
3. **Schema Fragmentation**: Access control metadata scattered across App.tsx (route guards), AppLayout.tsx (org switching), AdminNavigationMenu.tsx (role-based visibility assumptions)

**Recommendation**: The revised checklist correctly targets all three gaps. Additional consideration: **future-proof the schema** with extensible fields (e.g., `visibleInMenuFor`, `requiredCapabilities`) to avoid Phases 2–3 refactoring later.

---

## Part 1: Codebase Schema Audit

### 1.1 Role Hierarchy as Currently Implemented

| Role | Auth Scope | Org Scope | Capabilities | Route Bypass | Menu Visibility |
|------|-----------|-----------|--------------|--------------|-----------------|
| `grand_master` | Global | All orgs | All routes | Implicit bypass in AreaRoute (line 363) | ⚠️ Sees all hardcoded items (no filtering) |
| `master` | Global | Switchable via globalFiltersStore | Most routes except master-restricted | Limited to allowed routes | ⚠️ Same as grand_master |
| `admin` | Global | Restricted to org_id | Admin-scoped routes | Route-level checks only | ⚠️ Same as grand_master |
| `admin_officer` | Portal-specific | Org-scoped | Admin + Officer routes (portal choice required) | Route-level checks | ⚠️ Same as grand_master |
| `officer` | Portal-specific | Org-scoped | Officer-only routes | Route-level checks | ⚠️ Same as grand_master |
| `nzscv_monitor` | Whitelist-only | Org-specific | Monitoring routes only | Route-level checks | N/A (no nav menu) |
| `client_viewer` | Portal-only | Portal-specific | Read-only routes | Route-level checks | N/A (no nav menu) |

**Issues**:
- (A) Grand Master bypass is **implicit** (`if (role === 'grand_master') return true` in AreaRoute), not documented
- (B) Menu visibility is **decoupled** from allowed routes (all items shown, but many unreachable)
- (C) `authorized_work_locations` and `extra_organization_ids` defined in DB schema but not used in guards

### 1.2 Route Guard Layers (Current Implementation)

**File**: `src/App.tsx`  
**Pattern**: Three-tier protection

```
Public Routes (2)
  ↓
RoleRoute (ValidatesAllowedRoles array)
  ↓
AreaRoute (Extends RoleRoute + portal_access checks)
  ↓
Individual Route Components
  ↓
Route-Level Access Context (useAuth, useOrganization hooks)
```

**Complexity**: Medium (121 routes, 90%+ protected)  
**Current: Works**. Route guards are solid.  
**Gap**: No pre-filtering at menu render time → all items visible, filtering happens post-click

### 1.3 Organization Context Implementation

**Files**: 
- `src/hooks/useOrganization.ts` - current org from auth + useContext
- `src/hooks/useOrganizations.ts` - all orgs user can access
- `src/stores/globalFiltersStore.ts` - master/grand_master org switcher
- `src/hooks/useOrganizationBoundary.ts` - geospatial (GeoJSON to bounding box)

**Current Flow**:
```
1. User logs in → Supabase JWT includes organizations[] claim
2. useAuth() reads JWT → authStore.user.organizations
3. globalFiltersStore allows master/grand_master to switch org context
4. useOrganization() returns current org (from JWT or store)
5. Component queries: WHERE org_id = user.org_id (enforced at DB + component)
```

**Issues**:
- (C) Org filtering happens in **data layer** (Supabase queries), not **routing layer**
- (D) Route guards don't check org_id; they only check role
- (E) Example: Grand Master user on Org A could theoretically see routes for Org B if RLS were bypassed

### 1.4 Menu Architecture (Critical Gap)

**Files**: `src/components/features/AdminNavigationMenu.tsx` (60+ hardcoded items)

**Current State**:
```typescript
// All items visible to all authenticated users
const primaryLinks = [
  { label: 'Patrols', to: '/admin/patrols', icon: MapIcon },
  { label: 'Incidents', to: '/admin/incidents', icon: AlertIcon },
  // ... 58 more items (no role checks here)
];

// Route guards enforce access at destination
<Route path="/admin/patrols" element={<RoleRoute allowedRoles={['admin', 'master']} ... />} />
```

**Flow**:
1. User clicks "Patrols" in menu → navigates to `/admin/patrols`
2. If user role not in allowedRoles → RoleRoute silently redirects to home
3. **No toast, no error message** → UX confusion ("Why doesn't this work?")

**Impact**:
- ⚠️ Officer sees "Incidents" (admin-only) → clicks → redirected (silent failure)
- ⚠️ ClientViewer sees entire admin menu (but can't access anything)
- ⚠️ No "requires admin role" hint or disabled button state

### 1.5 Test Infrastructure

**Files**: `tests/e2e/module-route-access.spec.ts`, `tests/e2e/auth.ts`

**Current State**:
- ✅ 6 test credentials (master, adminOrg1, adminOrg2, officer, clientViewer, clientStaff)
- ✅ Auth helper validates role + org during login
- ✅ Module route access tests iterate through all protected routes
- ✅ Bob UI assessment integrated (bobAssessPage helper)

**Issues**:
- (F) Bob scoring mixed with route access tests → if Bob service fails, entire suite fails
- (G) No test fixtures for multi-org scenarios (admin for 2+ orgs, officers for multiple locations)
- (H) No verification that menu items are filtered (only route guards tested)

---

## Part 2: Comparison with Industry Best Practices

### 2.1 Gap Analysis vs. NIST SP 800-162 & Cloud Providers

| Best Practice | FieldOps Current | Status | Impact |
|---|---|---|---|
| Centralized access matrix (registry) | Scattered (App.tsx, AppLayout, menu) | ❌ No registry | Maintenance burden; drift risk |
| Separate authN from authZ | Separate (JWT for authN, guards for authZ) | ✅ Correct | Good |
| Role inheritance / capability matrix | Roles hardcoded; no inheritance | ⚠️ Partial | Added complexity when capabilities evolve |
| Org context in every query | RLS + component queries | ✅ Correct | Prevents leakage |
| Menu derived from registry | Hardcoded menu | ❌ No registry | Menu ≠ actual access; UX gap |
| Test org × role combinations | Limited test data | ⚠️ Partial | Multi-org scenarios not tested |
| Minimal privilege by default | All menu items visible | ❌ Inverse | Shows more than user can access |

### 2.2 Recommended Schema Evolution (Future State)

The revised checklist proposes this schema:

```typescript
// Current (scattered)
App.tsx: allowedRoles = ['admin', 'master']
AdminNavigationMenu.tsx: if (role === 'admin') show(item)
AppLayout.tsx: switch(role) { case 'grand_master': ... }

// Proposed (consolidated)
src/config/accessRegistry.ts:
{
  path: '/admin/incidents',
  label: 'Incidents',
  area: 'compliance',
  allowedRoles: ['grand_master', 'admin', 'master'],
  orgScoped: true,
  navSurface: 'admin-menu',
  visibleInMenuFor: ['admin', 'master'],  // NEW: menu-level visibility
  requiredCapabilities: ['incident_view'],  // NEW: future-proofing
}

// Usage
<MenuItem 
  visible={registry.entry.visibleInMenuFor.includes(user.role) && user.has(registry.entry.requiredCapabilities)}
/>
<Route 
  guard={user.canAccess(registry.entry)}
/>
```

---

## Part 3: What the Revised Checklist Does Right

### Blocker 1: Ground in `system_state.json`

**Why it matters**: Creates a **single source of truth** for what the schema contains.  
**Implementation**: Add `access_config` section to system_state.json; reference it in code comments.  
**Future benefit**: Enables tooling (e.g., audit scripts) to validate registry against system_state.

### Blocker 2: Test Isolation

**Why it matters**: Route access tests should **not depend on Bob service**.  
**Implementation**: Gate Bob suite with `RUN_BOB_UI_ASSESS=1`; keep route tests pure.  
**Future benefit**: CI/CD can run route tests even when Bob service is down.

### Blocker 3: Multi-Org Scope

**Why it matters**: Org context must be **part of routing logic**, not just data queries.  
**Implementation**: Add `getAccessibleRoutes()` that filters by role + org before rendering.  
**Future benefit**: Enables org-scoped routes, org-restricted dashboards, multi-tenant data governance.

### Gap: Menu Filtering (Not in Checklist)

**Should be added**: 
- Filter menu items by `visibleInMenuFor` + user role/org BEFORE rendering
- Add `disabled` state for routes where user lacks required role but menu item persists (discoverable)
- Add optional toast/error boundary at route level to explain access denial

---

## Part 4: Evolution Roadmap (Beyond This Task)

### Phase 1: This Checklist (Consolidation)
- ✅ Centralize route metadata
- ✅ Separate menu from route guards
- ✅ Isolate Bob scoring tests
- ✅ Add multi-org filtering

### Phase 2: Capability-Based Access (Months 3–6)
- Add `requiredCapabilities` to registry (e.g., `['incident_view', 'patrol_create']`)
- Create `CapabilityMatrix` (role → capabilities mapping)
- Replace role enum checks with capability checks in guards
- **Example**: Instead of `allowedRoles: ['admin']`, use `requiredCapabilities: ['incident_admin']`

### Phase 3: Fine-Grained Org Access (Months 6–12)
- Implement location-based access via `authorized_work_locations`
- Create `AccessPolicy` type: `{ role: string, org_id: string, locations: string[], capabilities: string[] }`
- Enforce at query level: `WHERE org_id = ? AND location IN (user.locations) AND ...`
- Add audit logging for access decisions

### Phase 4: Access Control Visualization (Months 12–18)
- Build admin dashboard: role matrix view (role × route × capability)
- Role diff tool: "What access changes if I promote Officer → Admin?"
- Access test report: "Which role / org combos are untested?"

---

## Part 5: Potential Risks & Mitigations

| Risk | Current State | Mitigation | Owner |
|---|---|---|---|
| **Silent redirects from menu clicks** | High risk (all items visible) | Filter menu by role + org during render | Implementation task |
| **Grand Master bypass is implicit** | Medium risk (undocumented) | Add explicit comment: "grand_master bypasses all checks" in code + docs | Implementation task |
| **Org fields unused** (authorized_work_locations) | Low risk now, High if ignored | Add to registry schema now; enforce in Phase 3 | Design task |
| **Test fixtures are hardcoded** | Medium risk (brittle tests) | Create factories for (role, org) combinations | Test task |
| **Capability matrix undefined** | Low risk now, blocker if ignored | Document in ADR now; implement in Phase 2 | Architecture task |
| **Multi-org test coverage missing** | High risk (org admins see wrong routes) | Add matrix: adminOrg1 sees Org1 routes, not Org2 | Test task |

---

## Part 6: Recommendation

### Immediate (This Task)
✅ **Proceed with revised checklist**. All three blockers are valid and address the main gaps.

### Extension (Parallel Path)
🟡 **Add two items to checklist** (optional but recommended):
1. **Menu Filtering**: Filter AdminNavigationMenu by role + org before render
2. **Capability Documentation**: Add `requiredCapabilities` field to registry schema now (even if not enforced yet)

### Future (Phase 2+)
🟢 **Consider ADR for access control evolution**: Document the roadmap (Phases 2–4) in `docs/adr/` so future implementers understand the direction.

---

## Conclusion

The current codebase is **80% aligned** with industry best practices. The revised checklist closes the **20% gap** (consolidation + isolation + multi-org scope). **One additional gap**—menu visibility filtering—should be considered for this task or Phase 1 extension.

**Sign-off**: This analysis supports the revised checklist **with recommended extensions** (menu filtering, capability schema).
