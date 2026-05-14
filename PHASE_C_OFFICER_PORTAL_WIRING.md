# Phase C: Officer Portal Boundary Context Wiring & Validation

**Date**: 2026-07-14  
**Status**: Planning  
**Goal**: Integrate strict geofence enforcement RPCs into officer portal UI, validate E2E boundary transitions, and document compliance readiness.

---

## Context

Phase B delivered:
- Schema additions for strict boundary verification (`operational_rules`, `strict_boundary_enabled` columns)
- Forward-enforcement CHECK constraints (backward-compatible, NOT VALID)
- 8 new RPCs for boundary context, verified patrol transitions, and location-context upserts
- 2 new React hooks: `useBoundaryPolicyContext()`, `useZoneOperationalPolicy()`
- Frontend geofence runtime updated to use verified RPCs with legacy fallback

**Current state**:
- Build: ✅ passing
- Lint: ✅ passing
- Migrations: Staged (awaiting deployment confirmation)
- Officer UI: Not yet wired to new context hooks

---

## Phase C Deliverables

### 1. Boundary Context Integration — Officer Portal Screens

**Screens to update** (search for `useVehicles`, `useZones`, `usePatrols` patterns):

#### a) OfficerHomePage
- Display current zone boundary status on patrol summary
- Wire `useBoundaryPolicyContext()` to show onsite/offsite indicator
- Show operational rules inline (freedom camping nights/self-contained rules)

#### b) LivePatrolMonitor
- Real-time boundary/verification status for active patrols
- Display patrol check-in/out boundary context (`check_in_verified`, `check_out_verified` flags)
- Show zone policy details (bylaw ref, land manager, parking rules)

#### c) PatrolNavigation / DispatchMonitor
- Zone policy context card on job assignment
- Show parking, alarm response, noise control rules from `operational_rules`
- Display jurisdiction/bylaw reference for compliance context

#### d) IncidentReports / IncidentManagement
- Pre-populate incident location with boundary/zone context
- Show resolved zone + geo_zone metadata
- Display jurisdiction org for escalation routing

### 2. Geofence Enforcement Validation Suite

**Tests to create** (Vitest + Playwright):

#### Unit Tests: `src/lib/__tests__/geofence-strict.test.ts`
```
- test("is_point_inside_zone works for circle radius")
- test("is_point_inside_zone works for polygon geometry")
- test("is_point_inside_geo_zone resolves correct geo_zone")
- test("resolve_boundary_context returns matched=true inside zone")
- test("resolve_boundary_context returns parking/alarm rules from operational_rules")
- test("patrol_auto_checkin_verified requires inside boundary")
- test("patrol_auto_checkout_verified requires outside boundary")
- test("upsert_incident_location_context resolves zone + jurisdiction")
```

#### E2E Tests: `tests/e2e/geofence-strict-enforcement.test.ts`
```
- Officer enters geofence → patrol auto-checkin verified ✓
- Officer exits geofence → patrol auto-checkout verified outside required ✓
- Incident location resolved with correct zone/jurisdiction context ✓
- Zone operational rules displayed in officer UI ✓
- Policy fallback to legacy patrol RPCs when verified unavailable ✓
```

### 3. Documentation & Compliance Readiness

#### a) Update STAGING.md
Add Phase C results section with:
- Officer portal integration checklist
- Post-deployment validation command output
- E2E test evidence
- Known limitations (backward compatibility with legacy patrol RPCs)

#### b) ADR: Officer Context Enforcement (`docs/adr/XXX-strict-officer-context.md`)
- Decision: Use forward-enforcement constraints for gradual adoption
- Rationale: Backward compatibility + audit trail for legacy rows
- Tradeoffs: Legacy data still lacks boundary verification; new writes enforced strictly
- Alternatives considered: Hard DROP + RECREATE (breaks live tenants)

#### c) RPC Usage Guide (`docs/OFFICER_CONTEXT_API.md`)
```markdown
## Officer Context API Usage

### resolve_boundary_context(org_id, service_type, lat, lng, zone_id)
**Purpose**: Get boundary + policy context for officer at specific location

**Returns**:
{
  matched: boolean,
  inside_boundary: boolean,
  zone: { id, name, operational_rules, freedom_camping_rules },
  geo_zone: { id, name, task_types },
  jurisdiction: { jurisdiction_org_id, bylaw_reference, service_endpoints },
  parking_rules, alarm_response_rules, noise_control_rules
}

**Usage in React**:
```typescript
const { data: context } = useBoundaryPolicyContext({
  organizationId: authStore.organization.id,
  latitude: gpsLat,
  longitude: gpsLng,
  serviceType: 'freedom_camping'
})
if (context?.inside_boundary) {
  // Show zone-specific rules + bylaw reference
}
```

### patrol_auto_checkin_verified(patrol_id, gps_lat, gps_lng)
**Purpose**: Auto sign-in officer only if GPS is inside patrol zone boundary

**Returns**: 
{
  success: boolean,
  reason: 'outside_geofence' | 'auto_checkin_disabled' | ...,
  context: boundary_context (if failed)
}

**Edge Function**: Called from geofence.ts every 30 seconds during location monitoring

### get_zone_operational_policy(zone_id, service_type)
**Purpose**: Retrieve zone's service-specific rules for UI rendering

**Returns**:
{
  found: boolean,
  freedom_camping_rules, parking_rules, alarm_response_rules, noise_control_rules,
  service_endpoints, jurisdiction_org_id
}
```

### 4. Officer Portal Wiring Map

**File modifications**:

| File | Hook/API | Purpose |
|------|----------|---------|
| OfficerHomePage.tsx | useBoundaryPolicyContext | Show current zone + rules |
| LivePatrolMonitor.tsx | useBoundaryPolicyContext | Real-time boundary status |
| DispatchMonitor.tsx | useZoneOperationalPolicy | Zone policy on job card |
| IncidentReports.tsx | resolve_boundary_context RPC | Pre-fill location context |
| PatrolNavigation.tsx | useBoundaryPolicyContext | Boundary indicator on map |

**Pattern to follow**:
```typescript
// Existing pattern (Phase A/B)
const { data: zone } = useZones()

// New pattern (Phase C)
const { data: boundaryContext } = useBoundaryPolicyContext({
  organizationId,
  latitude: patrol.gps_lat,
  longitude: patrol.gps_lng,
  serviceType: zone?.zone_type
})

// Render zone rules from context
<div>{boundaryContext?.zone?.operational_rules?.parking?.max_stay_minutes}m max</div>
```

---

## Execution Timeline

| Step | Owner | Duration | Blocker |
|------|-------|----------|---------|
| 1. Deploy Phase B migrations (confirm schema + RPCs live) | DevOps | 15min | — |
| 2. Unit tests for RPC logic (geofence-strict.test.ts) | Dev | 2h | Migrations deployed |
| 3. Wire OfficerHomePage + LivePatrolMonitor | Dev | 3h | Unit tests pass |
| 4. Wire DispatchMonitor + IncidentReports | Dev | 2h | UI tests pass |
| 5. E2E validation suite (geofence-strict-enforcement.test.ts) | QA | 3h | All screens wired |
| 6. ADR + API documentation | Tech Writer | 1h | Tests passing |
| 7. STAGING.md Phase C results + sign-off | PM | 30min | All validation complete |

**Total Phase C**: ~12h (2 business days)

---

## Validation Gates

**Before Phase D handoff**:
- [ ] Migration deployment confirmed (bunx supabase migration list shows 20260714000001/2 in Remote column)
- [ ] Unit tests: 8/8 passing for RPC behavior
- [ ] E2E tests: 5/5 patrol + incident scenarios passing
- [ ] Officer portal screens: All 5 modified screens render context without errors
- [ ] Legacy fallback: Verified RPC → legacy RPC path tested under error conditions
- [ ] Lint/build: Still passing after Phase C modifications

---

## Known Limitations & Backlog

1. **Backward compatibility**: Legacy patrol rows created before Phase B lack boundary verification. Migration adds constraints with NOT VALID, keeping legacy rows unverified. These will fail new writes but remain readable.
   - **Action (Phase D)**: Backfill verification on legacy rows as optional cleanup task.

2. **Strict mode toggle**: `strict_boundary_enabled` column allows orgs to opt-out of enforcement. Currently defaults to TRUE but not surfaced in admin UI.
   - **Action (Phase D)**: Add admin control to toggle enforcement per zone/org.

3. **Service-type aware rules**: `operational_rules` structure is extensible but rules for `parking`, `alarm_response`, `noise_control` are placeholders.
   - **Action (Phase D)**: Integrate with domain-specific rule engines (parking pay-by-plate, noise decibel limits, etc).

---

## Next Phase Hypothesis (Phase D)

**Title**: Multi-Org Policy Compliance Wiring  
**Goal**: Connect jurisdictional enforcement policies to backend dispatch/billing workflows  
**Scope**: 
- Admin UI for zone operational_rules editing
- Compliance report generation (by jurisdiction/bylaw)
- Automated escalation on policy breaches
- Multi-org audit trail for service-specific rules

