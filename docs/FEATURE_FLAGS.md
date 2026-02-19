# Feature Flags - Core Pipeline Rebuild

## Overview

This document defines all feature flags for the phased rollout of the Core Pipeline Rebuild. Each flag controls a specific phase of functionality, enabling safe incremental deployment with independent backout capability.

---

## Flag Definitions

### **Phase 1: Officer Core Loop**

#### `FEATURE_OFFICER_OUTBOX`
- **Purpose**: Enable offline queue (outbox) and background sync worker in Officer App
- **Impact**: Officers can continue capturing observations offline; syncs when connection restored
- **Dependencies**: None
- **Default States**:
  - Development: `true`
  - Staging: `true` (pilot officers only)
  - Production: `false` (enable after gate passes)

#### `FEATURE_INGEST_V2`
- **Purpose**: Route Officer App to new photo-first Edge Function (`plate-scanner-photo-first`)
- **Impact**: Changes observation ingest from legacy `plate-scanner-complete` to new Layer 1 handler
- **Dependencies**: `FEATURE_OFFICER_OUTBOX` (recommended, not required)
- **Default States**:
  - Development: `true`
  - Staging: `true` (pilot officers only)
  - Production: `false` (enable after gate passes)
- **Routing Logic**:
  ```typescript
  const ingestUrl = FEATURE_INGEST_V2 
    ? 'plate-scanner-photo-first' 
    : 'plate-scanner-complete';
  ```

---

### **Phase 2: Geofenced Patrol + Camera Overlay**

#### `FEATURE_PATROL_GEOFENCE`
- **Purpose**: Enable automatic patrol start/stop based on zone entry/exit
- **Impact**: Reduces manual patrol management; auto-tracks officer movements
- **Dependencies**: GPS permissions enabled
- **Default States**:
  - Development: `true`
  - Staging: `true` (pilot officers only)
  - Production: `false` (enable after gate passes)
- **UI Changes**:
  - Camera overlay shows zone name + GPS accuracy (green/amber/red)
  - Patrol status banner visible in Officer mode

---

### **Phase 3: Admin↔Officer Mode Switch**

#### `FEATURE_PORTAL_SWITCH`
- **Purpose**: Enable in-session mode switching between Admin and Officer portals
- **Impact**: Single login; no re-authentication; RBAC enforced; last route per mode preserved
- **Dependencies**: Session management (`auth.getSession()`)
- **Default States**:
  - Development: `true`
  - Staging: `true`
  - Production: `false` (enable after gate passes)
- **UI Changes**:
  - Mode switcher in header (dropdown or toggle)
  - URL parameter `?mode=officer|admin` respected
  - Audit log entries via `log_mode_switch(from, to)`

---

### **Phase 4: Enforcement Lifecycle**

#### `FEATURE_ENFORCEMENT`
- **Purpose**: Enable enforcement case management, notice generation, and payment tracking
- **Impact**: Officers can create cases from breaches, issue notices, track resolutions
- **Dependencies**: Compliance evaluation (Layer 3), `enforcement_cases` tables
- **Default States**:
  - Development: `true`
  - Staging: `false` (enable after pilot approval)
  - Production: `false` (enable after gate passes)
- **UI Changes**:
  - "Create Enforcement Case" button on breach observations
  - Case management page in Admin portal
  - Notice templates and PDF generation
  - Enforcement guard prevents issuing notices to EXEMPT observations

---

### **Phase 5: Incidents & People**

#### `FEATURE_INCIDENTS`
- **Purpose**: Enable incident report creation with attachments and linking to vehicles/zones
- **Impact**: Officers can log H&S incidents, attach photos, link persons
- **Dependencies**: `incidents`, `incident_attachments` tables
- **Default States**:
  - Development: `true`
  - Staging: `false` (enable after pilot approval)
  - Production: `false` (enable after gate passes)

#### `FEATURE_PERSON_CANONICAL`
- **Purpose**: Enable canonical person records and vehicle⇄person linkages
- **Impact**: Track individuals separately from vehicles; link multiple persons to same vehicle
- **Dependencies**: `canonical_persons`, `person_observations`, `person_vehicle_links` tables
- **Default States**:
  - Development: `true`
  - Staging: `false` (enable after pilot approval)
  - Production: `false` (enable after gate passes)

---

### **Phase 6: KPI Recompute & Analytics Stabilization**

#### `FEATURE_KPI_RECOMPUTE`
- **Purpose**: Enable historical compliance recomputation job
- **Impact**: Backfills `compliance_results` for all observations since effective date; stabilizes KPI tiles
- **Dependencies**: Layer 3 compliance engine, `recompute_all_compliance_since_effective_date()` RPC
- **Default States**:
  - Development: `false` (run manually)
  - Staging: `false` (run manually)
  - Production: `false` (run once in maintenance window)
- **Execution**:
  ```sql
  -- Disable alert trigger
  ALTER TABLE compliance_results DISABLE TRIGGER trigger_auto_create_breach_alert;
  
  -- Run recompute (batched)
  SELECT recompute_all_compliance_since_effective_date('2025-12-01'::date);
  
  -- Re-enable alert trigger
  ALTER TABLE compliance_results ENABLE TRIGGER trigger_auto_create_breach_alert;
  ```

---

## Configuration Keys (App Config)

These are **not** feature flags but configuration values that change behavior when flags are enabled.

### `INGEST_V1_URL`
- **Value**: `"plate-scanner-complete"`
- **Purpose**: Legacy observation ingest endpoint

### `INGEST_V2_URL`
- **Value**: `"plate-scanner-photo-first"`
- **Purpose**: Photo-first observation ingest endpoint (Layer 1)

### `DEFAULT_TIMEZONE`
- **Value**: `"Pacific/Auckland"`
- **Purpose**: NZ timezone for all date/time operations

---

## Rollout Sequence

| Phase | Flag(s) | Pilot Size | Duration | Gate Criteria |
|-------|---------|------------|----------|---------------|
| **Phase 0** | *(migration)* | N/A | Day 0-1 | All 7 RPCs callable; telemetry flowing |
| **Phase 1** | `FEATURE_OFFICER_OUTBOX`, `FEATURE_INGEST_V2` | 2 officers, 1 shift | Day 2-3 | Queue drains; p95 ≤5s; upload success ≥99% |
| **Phase 2** | `FEATURE_PATROL_GEOFENCE` | Same 2 officers | Day 4 | ≥95% correct zone overlays; auto start/stop works |
| **Phase 3** | `FEATURE_PORTAL_SWITCH` | All admin users | Day 5 | Switch instant; audit logged; RBAC enforced |
| **Phase 4** | `FEATURE_ENFORCEMENT` | Admin users + 5 officers | Day 6-7 | Case creation works; notices issued; no EXEMPT bypass |
| **Phase 5** | `FEATURE_INCIDENTS`, `FEATURE_PERSON_CANONICAL` | All officers | Day 6-7 | Incidents created; attachments stored; person links work |
| **Phase 6** | `FEATURE_KPI_RECOMPUTE` | Production DB | Day 8-9 | KPI tiles = drill-downs; Zone Requirements render |

---

## Backout Strategy

Each flag can be **disabled independently** without affecting other phases:

### **Immediate Rollback** (Toggle flag to `false`)
1. Update environment variable or config file
2. Restart application (if required)
3. Verify fallback behavior active

### **Fallback Behavior per Flag**

| Flag | Fallback Behavior |
|------|-------------------|
| `FEATURE_OFFICER_OUTBOX` | Direct-send observations (no queue); same as current behavior |
| `FEATURE_INGEST_V2` | Use legacy `plate-scanner-complete` endpoint |
| `FEATURE_PATROL_GEOFENCE` | Manual patrol start/stop; no camera overlay |
| `FEATURE_PORTAL_SWITCH` | Login-time portal selection only; no in-session switching |
| `FEATURE_ENFORCEMENT` | Enforcement menu hidden; data preserved; no new cases |
| `FEATURE_INCIDENTS` | Incident menu hidden; data preserved; no new incidents |
| `FEATURE_PERSON_CANONICAL` | Person management hidden; data preserved; no new records |
| `FEATURE_KPI_RECOMPUTE` | Pause/resume recompute job; tiles work with existing data |

---

## Monitoring & Alerts

### **Telemetry Metrics**
- Queue depth (outbox size)
- Upload success rate
- Evaluation latency (p50, p95, p99)
- RPC error rate (404s, 500s)
- Mode switch frequency

### **Alert Thresholds**
- **Warning**: p95 evaluation latency > 5s
- **Critical**: Upload success rate < 95%
- **Critical**: RPC error rate > 1%
- **Warning**: Queue depth > 50 items per officer

---

## Testing Checklist

Before enabling any flag in production:

- [ ] **Phase 0**: Run `supabase/acceptance-tests/phase-gates.sql` (Section: Phase 0)
- [ ] **Phase 1**: Verify queue drains, latency p95 ≤5s, upload success ≥99%
- [ ] **Phase 2**: Spot-check geofence accuracy ≥95%, camera overlay correct
- [ ] **Phase 3**: Verify mode switch instant, audit logged, RBAC blocks unauthorized
- [ ] **Phase 4**: Create test case, issue notice, verify EXEMPT guard blocks
- [ ] **Phase 5**: Create incident + person, verify attachments + vehicle links
- [ ] **Phase 6**: Run KPI validation (all_breaches ⊇ overstayers, homeless_exempt)

---

## API Freeze Commitment

After Phase 6 sign-off, the following RPCs are **frozen** (no name changes, signature changes, or deprecation):

1. `cohort_overstayers(p_from, p_to, p_org_id, p_zone_id)`
2. `cohort_homeless_exempt(p_from, p_to, p_org_id, p_zone_id)`
3. `cohort_all_breaches(p_from, p_to, p_org_id, p_zone_id)`
4. `evaluate_observation_requirements(p_observation_id)`
5. `get_observation_result(p_observation_id)`

Any future logic changes will be implemented **behind** these same function names.

---

## Questions & Support

For rollout issues, contact the Core Pipeline Rebuild team or reference:
- Migration: `supabase/migrations/20260220_core_pipeline_rebuild.sql`
- Acceptance Tests: `supabase/acceptance-tests/phase-gates.sql`
- Edge Function: `supabase/functions/plate-scanner-photo-first/index.ts`
