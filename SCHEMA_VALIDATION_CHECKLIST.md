# Schema & Wiring Validation Checklist

## Quick Reference for Audit Findings

### 🔴 Critical Mismatches to Monitor

#### 1. COALESCE Type Drift (Observations Insert)
**Problem**: Database triggers expect INTEGER for compliance fields, but columns are TEXT
**Files**: 
- `supabase/functions/vehicle-ingest/index.ts` - Main insert logic
- `supabase/functions/_shared/observationInsert.ts` - Error detection and recovery
- Migrations: 20260312, 20260313, 20260401 (fixes)

**Validation**:
```sql
-- Check column types in observations table
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'observations' 
AND column_name IN ('nights_stayed_this_month', 'consecutive_nights', 'is_compliant', 'self_contained', 'breach_type')
ORDER BY column_name;
```

**Expected**: All should be TEXT or compatible type
**If Broken**: vehicle-ingest will fail with COALESCE error, falls back to omitting columns

---

#### 2. Breach Type Constraint Validation
**Problem**: breach_alerts.breach_type has CHECK constraint limiting values
**Files**:
- `supabase/functions/scan-breaches/index.ts` - Creates breach alerts
- `supabase/functions/_shared/compliance.ts` - Type validation
- Migrations: 20260217, 20260331

**Valid Values** (from compliance.ts):
```
'consecutive_nights'
'monthly_limit'
'self_contained'
'after_hours'
'day_visit_violation'
'allowed_days_violation'
```

**Validation**:
```sql
SELECT constraint_name, constraint_definition 
FROM information_schema.table_constraints 
JOIN information_schema.check_constraints USING (constraint_name)
WHERE table_name = 'breach_alerts';
```

**If Broken**: Invalid breach_type inserts fail at database level

---

#### 3. Observations Table Schema Drift
**Problem**: Multiple column additions across migrations; schema cache may lag
**Files**:
- Migrations: 20260312, 20260315, 20260330, 20260331 (fixes)
- `supabase/functions/vehicle-ingest/index.ts` - Insert with retry logic

**Expected Columns**:
```
id, plate_number, zone_id, organization_id, recorded_at, recorded_by,
gps_latitude, gps_longitude, photo_url (NOT NULL),
is_compliant, compliance_summary (JSON),
breach_type, breach_reason,
processing_status, processing_error, incident_id,
weather_conditions, sticker_presence, sticker_color,
movement_*, embedding_*, created_at
```

**Validation**:
```sql
SELECT COUNT(*) as column_count FROM information_schema.columns 
WHERE table_name = 'observations';
-- Should be 40+ columns

-- Check for critical columns
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'observations' 
AND column_name IN ('gps_latitude', 'gps_longitude', 'photo_url', 'compliance_summary', 'incident_id');
```

**If Missing**: vehicle-ingest catches with extractMissingSchemaColumn() and retries

---

#### 4. Compliance Results Schema Alignment
**Problem**: compliance_results and observations.compliance_summary must be in sync
**Files**:
- Migration: 20260220_add_compliance_summary_to_observations.sql
- `supabase/functions/recalculate-compliance-v3/index.ts`

**Expected Fields**:
```
observations:
  - is_compliant (boolean)
  - compliance_summary (JSON): { is_compliant, breach_type, breach_reason, ... }

compliance_results:
  - is_compliant, breach_type, breach_reason
  - self_contained, nights_stayed_this_month, consecutive_nights
  - is_homeless_exempt, flagged_support
```

**Validation**:
```sql
-- Spot check: observations and compliance_results should align
SELECT COUNT(*) as obs_count FROM observations WHERE is_compliant IS NULL;
SELECT COUNT(*) as result_count FROM compliance_results WHERE is_compliant IS NULL;
-- Both should be 0
```

**If Broken**: Compliance UI shows stale data

---

#### 5. Organization Overnight Verification Mode
**Problem**: Compliance logic varies by organization mode, but mode must be read from organizations table
**Files**:
- Migration: 20260309_add_overnight_verification_mode_to_organizations.sql
- `supabase/functions/recalculate-compliance-v3/index.ts` - Reads from organizations

**Valid Modes**:
```
'two_photo_verification' (requires 2 observations same zone/day)
'one_photo_per_day_inference' (requires 1 photo + AI inference)
```

**Validation**:
```sql
SELECT DISTINCT overnight_verification_mode 
FROM organizations 
WHERE overnight_verification_mode IS NOT NULL;
-- Should only show the two valid modes above

SELECT organization_id, overnight_verification_mode 
FROM organizations 
WHERE overnight_verification_mode IS NULL;
-- Should be minimal (only legacy orgs)
```

**If Broken**: Compliance recalculation uses wrong rule set per org

---

#### 6. Zone Compliance Matrix Versioning
**Problem**: Multiple effective_from/effective_to dates per zone; wrong version selected → wrong rules applied
**Files**:
- Migration: 20260301_align_zone_compliance_matrix.sql
- `supabase/functions/recalculate-compliance-v3/index.ts` - Selects version by recorded_at date

**Table Structure**:
```
zone_compliance_matrix:
  - id, zone_id, effective_from, effective_to, version
  - self_contained_required, requires_csc, nights_per_month
  - max_consecutive_nights, day_visit_only, allowed_days
  - homeless_exemption
```

**Validation**:
```sql
-- Check for overlapping date ranges per zone
SELECT zone_id, COUNT(*) as version_count, 
       MIN(effective_from) as oldest, MAX(effective_to) as newest
FROM zone_compliance_matrix
GROUP BY zone_id
ORDER BY version_count DESC;

-- Verify no date gaps: effective_to of version N+1 = effective_from of version N
SELECT z1.zone_id, z1.version, z1.effective_to, z2.version, z2.effective_from
FROM zone_compliance_matrix z1
JOIN zone_compliance_matrix z2 ON z1.zone_id = z2.zone_id 
  AND z2.version = z1.version + 1
WHERE z1.effective_to != z2.effective_from;
```

**If Broken**: Compliance rules stale/inconsistent across date ranges

---

#### 7. Canonical Vehicles vs Observations Denormalization
**Problem**: observations.plate_number is denormalized; not an FK to canonical_vehicles
**Files**:
- Migration: 20250203_rebuild_vehicle_architecture.sql
- `supabase/functions/scan-breaches/index.ts` - Uses plate_number directly

**Current Design**:
```
observations.plate_number → plate_number (TEXT, NOT FK)
↓ lookup by plate number
canonical_vehicles.plate_number (PK component)
↓ denormalized for perf
observations also store: homeless_status (nullable), self_contained (boolean)
```

**Validation**:
```sql
-- Check for orphaned observations (plate not in canonical_vehicles)
SELECT DISTINCT obs.plate_number, obs.recorded_at
FROM observations obs
LEFT JOIN canonical_vehicles cv ON obs.plate_number = cv.plate_number
WHERE cv.id IS NULL
LIMIT 10;
-- Should be empty or minimal

-- Verify canonical_vehicles is the source of truth for homeless flag
SELECT cv.plate_number, cv.homeless_status, COUNT(obs.id) as obs_count
FROM canonical_vehicles cv
LEFT JOIN observations obs ON cv.plate_number = obs.plate_number
WHERE cv.homeless_status IS NOT NULL
GROUP BY cv.plate_number
LIMIT 10;
```

**If Broken**: Homeless exemption logic inconsistent between vehicle detail and compliance calc

---

#### 8. RLS Policy Coverage
**Problem**: RLS policies may be too permissive or restrictive; multiple iterations in migrations
**Files**:
- Migrations: 20260218, 20260227, 20260307, 20260314, 20260320 (iterations)
- All sensitive tables: observations, compliance_results, breach_alerts, enforcement_actions

**Key Tables with RLS**:
- user_profiles (own profile + admin view all)
- organizations (own org + parent orgs if hierarchy)
- zones (own org zones)
- observations (own org observations)
- compliance_results (own org results)
- breach_alerts (own org alerts)
- enforcement_actions (own org actions)
- incident_evidence (own org evidence)

**Validation**:
```sql
-- Check RLS is enabled on all sensitive tables
SELECT table_name, row_security
FROM information_schema.tables
WHERE table_name IN (
  'user_profiles', 'observations', 'compliance_results', 
  'breach_alerts', 'enforcement_actions', 'incident_evidence'
)
ORDER BY table_name;
-- All should have row_security = 't' (true)

-- Verify no public SELECT policies
SELECT table_name, policy_name, permissive, roles
FROM pg_policies
WHERE table_name IN (
  'user_profiles', 'observations', 'compliance_results', 
  'breach_alerts', 'enforcement_actions'
)
AND permissive = true;
-- Review for overly broad role/condition grants
```

**If Broken**: Officers can see other orgs' data; admins can't access child org data

---

#### 9. Officer Compliance Credential Tracking
**Problem**: COA/warrant fields should be non-null for enforcement officers; verification tracking required
**Files**:
- Migration: 20260215_enhanced_compliance_credentials.sql
- Tables: user_profiles (coa_*, warrant_*)

**Required Fields for Enforcement Role**:
```
coa_number, coa_expiry, coa_document_url, coa_required, coa_verified
warrant_number, warrant_expiry, warrant_document_url, warrant_required, warrant_verified
```

**Validation**:
```sql
-- Check enforcement officers have credentials
SELECT up.id, up.email, up.role, 
       coa_number IS NOT NULL as has_coa,
       warrant_number IS NOT NULL as has_warrant
FROM user_profiles up
WHERE role IN ('officer', 'admin_officer')
AND (coa_number IS NULL OR warrant_number IS NULL);
-- Should be empty; any result indicates incomplete profile

-- Check expiry dates in future
SELECT id, email, coa_expiry, warrant_expiry
FROM user_profiles
WHERE role IN ('officer', 'admin_officer')
AND (coa_expiry < NOW() OR warrant_expiry < NOW());
-- Should be empty; use for expiry alerts
```

**If Broken**: Enforcement operations lack legal authority documentation

---

#### 10. Photo Integrity & Not Null Enforcement
**Problem**: observations.photo_url enforced NOT NULL since 20260219
**Files**:
- Migration: 20260219_enforce_photo_not_null.sql
- `supabase/functions/vehicle-ingest/index.ts` - Photo upload required

**Validation**:
```sql
-- Verify NOT NULL constraint
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'observations' AND column_name = 'photo_url';
-- Should show is_nullable = 'NO'

-- Check for null photos (legacy data or insert bugs)
SELECT COUNT(*) as null_photo_count FROM observations WHERE photo_url IS NULL;
-- Should be 0 for recent data; investigate any non-zero counts
```

**If Broken**: Photo storage inconsistent; photo-first enforcement workflow fails

---

### 🟡 Moderate Risk Items

#### 11. Homeless Exemption Alignment
**Problem**: Homeless flag lives on canonical_vehicles; exemption logic must read from there
**Files**:
- Migration: 20260310_align_homeless_exemption_auto_compliance.sql
- `supabase/functions/recalculate-compliance-v3/index.ts`
- Tables: canonical_vehicles (homeless_status), compliance_results (is_homeless_exempt)

**Validation**:
```sql
-- Verify homeless vehicles get exemption
SELECT cv.plate_number, cv.homeless_status, cr.is_homeless_exempt, COUNT(cr.id)
FROM canonical_vehicles cv
JOIN observations obs ON cv.plate_number = obs.plate_number
LEFT JOIN compliance_results cr ON obs.id = cr.observation_id
WHERE cv.homeless_status IS NOT NULL AND cv.homeless_status != ''
GROUP BY cv.plate_number
LIMIT 10;
-- is_homeless_exempt should be true for all rows
```

---

#### 12. Observation Idempotency Key
**Problem**: Offline-first architecture requires idempotency; duplicate prevention via key
**Files**:
- Migration: 20260330_fix_observations_idempotency_key.sql
- `supabase/functions/vehicle-ingest/index.ts` - Generates idempotency_key

**Validation**:
```sql
-- Check idempotency constraint
SELECT indexname FROM pg_indexes 
WHERE tablename = 'observations' 
AND indexname LIKE '%idempotency%';
-- Should exist

-- Find duplicate inserts (same key = retry success)
SELECT idempotency_key, COUNT(*) as count
FROM observations
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1
LIMIT 10;
-- Should be empty; any duplicates = sync issue
```

---

#### 13. Observation Zone Assignment
**Problem**: Zone assignment may drift; auto-correction in correct-zone-assignments function
**Files**:
- Migration: 20260320_fix_observation_zone_assignments.sql
- Migration: 20260321_reassign_observations_to_current_zones.sql
- `supabase/functions/correct-zone-assignments/index.ts`

**Validation**:
```sql
-- Check zone assignments are within org's zones
SELECT obs.id, obs.zone_id, obs.organization_id, z.name
FROM observations obs
LEFT JOIN zones z ON obs.zone_id = z.id AND obs.organization_id = z.organization_id
WHERE z.id IS NULL
LIMIT 10;
-- Should be empty; any results = zone assignment broken
```

---

### 🟢 Lower Risk Items

#### 14. Performance Indexes
**Problem**: Complex queries may be slow without indexes
**Files**:
- Migration: 20260222_performance_indexes.sql

**Validation**:
```sql
-- Verify key indexes exist
SELECT indexname FROM pg_indexes 
WHERE tablename IN ('observations', 'compliance_results', 'breach_alerts')
ORDER BY tablename, indexname;
-- Should include indexes on (zone_id, recorded_at), (organization_id, recorded_at), etc.
```

---

#### 15. Storage Bucket RLS
**Problem**: scans/ and evidence/ buckets need proper RLS for officer access
**Files**:
- Migration: 20260306_scans_bucket_rls.sql
- Migration: 20260326_evidence_bucket_import_policy.sql

**Validation**:
```sql
-- Check storage policy grants
SELECT * FROM storage.objects LIMIT 1;
-- Can execute means RLS configured

-- Verify upload policies work for officers
-- (Manual test: officer uploads photo → should succeed)
```

---

## Summary: Top 5 Things to Check in Production

1. **COALESCE Type Drift** - Run COALESCE check in #1 above; if fails, apply 20260313 hotfix
2. **Breach Type Constraint** - Ensure all breaches created use valid types from compliance.ts
3. **RLS Coverage** - Run #8 validation; ensure no public access on sensitive tables
4. **Zone Compliance Matrix** - Verify no date gaps in versioning; recalc uses correct version
5. **Photo Integrity** - Ensure photo_url NOT NULL; no legacy nulls breaking photo-first workflow

## Deployment Readiness

- ✅ Schema complete and stable (115 migrations applied)
- ✅ RLS policies in place (latest iteration: 20260320)
- ✅ Error handling for schema drift (observationInsert.ts)
- ✅ All external integrations wired (ALPR, ParkPow, MotorWeb, NZSCV)
- ⚠️ Monitor schema cache in vehicle-ingest logs
- ⚠️ Verify v3 compliance engine is canonical (v1, v2 deprecated)

