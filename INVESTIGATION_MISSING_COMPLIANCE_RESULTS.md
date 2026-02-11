# Investigation: Missing compliance_results Records

## Problem Statement

**Symptom:** ComplianceMatrixManagement page shows "Total observations: 0" despite vehicle scans being recorded in the field.

**Expected Behavior:** Every vehicle observation should have a corresponding `compliance_results` record created during scan processing.

---

## Root Cause Analysis

### 1. Compliance Results Creation Flow

```
Field Officer Scans Plate
    ↓
PlateCapture.tsx → calls process-field-scan Edge Function
    ↓
process-field-scan Edge Function:
    1. Creates/updates canonical_vehicle record
    2. Creates vehicle_observation record
    3. Calls calculate_vehicle_compliance() database function ← CRITICAL STEP
    4. Creates compliance_results record with evaluation
    ↓
Returns result to frontend
```

**If compliance_results is empty, the failure is at step 3 or 4.**

### 2. Diagnostic Queries

Run these queries to identify where the breakdown occurs:

```sql
-- Query 1: Check total observations vs compliance results
SELECT 
  'vehicle_observations' as table_name,
  COUNT(*) as record_count
FROM vehicle_observations
UNION ALL
SELECT 
  'compliance_results' as table_name,
  COUNT(*) as record_count
FROM compliance_results;

-- Expected: Both should have similar counts
-- If compliance_results is 0 or much lower → Issue confirmed


-- Query 2: Check observations WITHOUT compliance results
SELECT 
  vo.observation_id,
  vo.recorded_at,
  cv.plate_number,
  z.name as zone_name,
  cr.id as compliance_result_id
FROM vehicle_observations vo
JOIN canonical_vehicles cv ON cv.vehicle_id = vo.vehicle_id
JOIN zones z ON z.id = vo.zone_id
LEFT JOIN compliance_results cr ON cr.observation_id = vo.observation_id
WHERE cr.id IS NULL
ORDER BY vo.recorded_at DESC
LIMIT 20;

-- All rows returned = observations missing compliance results
-- Note the observation_ids and zones for further investigation


-- Query 3: Check if zone compliance matrix exists
SELECT 
  z.name as zone_name,
  zcm.id as matrix_id,
  zcm.version,
  zcm.effective_from,
  zcm.effective_to,
  CASE 
    WHEN zcm.effective_to IS NULL THEN 'ACTIVE'
    ELSE 'INACTIVE'
  END as status
FROM zones z
LEFT JOIN zone_compliance_matrix zcm ON zcm.zone_id = z.id
WHERE z.is_active = true
ORDER BY z.name, zcm.version DESC;

-- If any zone shows NULL matrix_id → That zone has NO compliance matrix
-- Observations in zones without matrices cannot be evaluated


-- Query 4: Check process-field-scan success rate
SELECT 
  date_trunc('day', vo.recorded_at) as scan_date,
  COUNT(vo.observation_id) as total_observations,
  COUNT(cr.id) as observations_with_compliance,
  ROUND(100.0 * COUNT(cr.id) / COUNT(vo.observation_id), 2) as success_rate
FROM vehicle_observations vo
LEFT JOIN compliance_results cr ON cr.observation_id = vo.observation_id
GROUP BY date_trunc('day', vo.recorded_at)
ORDER BY scan_date DESC
LIMIT 30;

-- Success rate should be 100%
-- Lower rate indicates Edge Function failures


-- Query 5: Check if calculate_vehicle_compliance() function exists
SELECT 
  routine_name,
  routine_type,
  data_type as return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'calculate_vehicle_compliance';

-- Should return 1 row with routine_type = 'FUNCTION'
-- If empty → Database function missing (critical!)
```

---

## Possible Root Causes

### Cause 1: Zone Has No Compliance Matrix
**Symptoms:**
- Zone exists and is active
- Observations are being recorded
- No compliance_results created
- Query 3 shows NULL matrix_id for that zone

**Why This Happens:**
- Zone was created before implementing matrix system
- Matrix was created but not activated (effective_to is not NULL)
- Matrix was deleted or deactivated

**Fix:**
```sql
-- Create compliance matrix for zone
INSERT INTO zone_compliance_matrix (
  zone_id,
  organization_id,
  version,
  effective_from,
  effective_to,
  self_contained_required,
  nights_per_month,
  max_consecutive_nights,
  day_visit_only,
  allowed_days,
  homeless_exemption,
  created_by,
  change_reason
)
SELECT 
  z.id,
  z.organization_id,
  1, -- version
  CURRENT_TIMESTAMP,
  NULL, -- active matrix
  z.self_contained_required,
  z.nights_per_month,
  z.max_consecutive_nights,
  z.day_visit_only,
  z.allowed_days,
  TRUE, -- homeless_exemption
  (SELECT id FROM user_profiles WHERE role = 'master' LIMIT 1),
  'Initial matrix creation for existing zone'
FROM zones z
WHERE z.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM zone_compliance_matrix zcm 
    WHERE zcm.zone_id = z.id AND zcm.effective_to IS NULL
  );
```

Then run recalculation for affected zones.

---

### Cause 2: calculate_vehicle_compliance() Function Missing
**Symptoms:**
- Query 5 returns no rows
- Edge Function logs show RPC errors
- All observations missing compliance results

**Why This Happens:**
- Database migrations not applied
- Function was dropped accidentally
- Wrong database connection

**Fix:**
```sql
-- Check if function exists
SELECT proname FROM pg_proc WHERE proname = 'calculate_vehicle_compliance';

-- If missing, check migration files:
-- supabase/migrations/20250127_critical_fixes.sql (or similar)
-- should contain function definition

-- Re-run migrations:
-- supabase db reset (WARNING: drops all data!)
-- OR manually copy function definition from migration file and execute
```

**Prevention:**
- Always apply migrations after deployment
- Test database functions exist after deployment
- Add health check endpoint to verify critical functions

---

### Cause 3: Edge Function Error During Compliance Evaluation
**Symptoms:**
- Observations are created successfully
- Some compliance results exist, but not all
- Edge Function logs show errors like:
  - "Compliance calculation failed"
  - "RPC error"
  - "Failed to insert compliance_results"

**Why This Happens:**
- Database function throws error for certain inputs
- Unique constraint violation on compliance_results
- Permission/RLS issue when inserting

**Debug Steps:**
1. Check Edge Function logs:
   ```bash
   supabase functions logs process-field-scan --limit 100
   ```

2. Look for patterns:
   - Does it fail for specific zones?
   - Does it fail for specific plate numbers?
   - Does it fail at specific times?

3. Test calculate_vehicle_compliance() directly:
   ```sql
   -- Test with known plate/zone that's missing compliance
   SELECT * FROM calculate_vehicle_compliance(
     p_plate_number := 'ABC123',
     p_zone_id := 'zone-uuid-here',
     p_check_date := '2025-01-27'
   );
   
   -- Should return compliance result
   -- If ERROR → Function has logic bug
   ```

**Fix:**
- Review error logs to identify failure pattern
- Fix database function or Edge Function logic
- Re-run recalculation for affected observations

---

### Cause 4: Matrix Created After Observations
**Symptoms:**
- Older observations have no compliance_results
- Recent observations (after matrix creation) have compliance_results
- Query 4 shows low success_rate for past dates, 100% for recent dates

**Why This Happens:**
- System was deployed without compliance matrix
- Observations were recorded during this period
- Matrix was created later
- Historical observations were never evaluated

**Timeline Example:**
```
Jan 1-15:  Observations recorded → NO matrix exists → NO compliance_results
Jan 16:    Matrix created
Jan 17-31: Observations recorded → Matrix exists → compliance_results created ✓
```

**Fix:**
Run recalculation for historical observations:
1. Scope: **Entire System** or specific zones
2. Date Range: From first observation to matrix creation date
3. This backfills missing compliance_results

---

### Cause 5: process-field-scan Not Calling Compliance Function
**Symptoms:**
- vehicle_observations created successfully
- NO compliance_results created (not even recent ones)
- Edge Function logs show success but no compliance calculation

**Why This Happens:**
- Code path in process-field-scan skips compliance calculation
- Silent error catch in Edge Function
- Wrong branch of conditional logic executed

**Check process-field-scan Code:**
```typescript
// In supabase/functions/process-field-scan/index.ts
// Look for this section around line 223:

const { data: complianceData, error: complianceError } = await supabaseAdmin
  .rpc('calculate_vehicle_compliance', {
    p_plate_number: plateNumber,
    p_zone_id: zoneId,
    p_check_date: new Date().toISOString().split('T')[0]
  });

if (complianceError) {
  console.error('❌ Compliance calculation failed:', complianceError);
  // THIS SHOULD NOT BE A SILENT FAILURE
  // Should still throw or at least log prominently
}
```

**Fix:**
- Add more logging around compliance calculation
- Ensure errors are not caught silently
- Add validation that compliance_results was created
- Re-deploy Edge Function

---

## Comprehensive Fix Strategy

### Step 1: Immediate Data Fix
Run recalculation to populate missing compliance_results:

```bash
# Via AdminRecalculation UI:
# 1. Scope: Entire System
# 2. Date Range: All Time
# 3. Click "Start Recalculation"

# Or via CURL (if UI fails):
curl -X POST "https://xbfnlzmpumthnjmtqufp.supabase.co/functions/v1/recalculate-all-compliance" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"scope":"BUILD","performedBy":"your-user-id"}'
```

### Step 2: Verify Fix
After recalculation completes:

```sql
-- Re-run diagnostic queries
SELECT 
  COUNT(DISTINCT vo.observation_id) as total_observations,
  COUNT(DISTINCT cr.observation_id) as observations_with_compliance,
  ROUND(100.0 * COUNT(DISTINCT cr.observation_id) / COUNT(DISTINCT vo.observation_id), 2) as coverage_percent
FROM vehicle_observations vo
LEFT JOIN compliance_results cr ON cr.observation_id = vo.observation_id;

-- Expected: coverage_percent = 100.00
```

### Step 3: Prevent Future Issues

**Add Health Check:**
```sql
-- Create monitoring view
CREATE OR REPLACE VIEW compliance_health_check AS
SELECT 
  z.name as zone_name,
  z.is_active,
  CASE 
    WHEN zcm.id IS NULL THEN 'NO MATRIX'
    WHEN zcm.effective_to IS NOT NULL THEN 'MATRIX INACTIVE'
    ELSE 'OK'
  END as matrix_status,
  COUNT(DISTINCT vo.observation_id) as observations_count,
  COUNT(DISTINCT cr.id) as compliance_results_count,
  COUNT(DISTINCT vo.observation_id) - COUNT(DISTINCT cr.id) as missing_results
FROM zones z
LEFT JOIN zone_compliance_matrix zcm ON zcm.zone_id = z.id AND zcm.effective_to IS NULL
LEFT JOIN vehicle_observations vo ON vo.zone_id = z.id
LEFT JOIN compliance_results cr ON cr.observation_id = vo.observation_id
WHERE z.is_active = true
GROUP BY z.id, z.name, z.is_active, zcm.id, zcm.effective_to
HAVING COUNT(DISTINCT vo.observation_id) > 0
ORDER BY missing_results DESC, z.name;

-- Run daily to detect issues
SELECT * FROM compliance_health_check WHERE missing_results > 0;
```

**Add Validation to process-field-scan:**
```typescript
// After creating observation, verify compliance was created
const { data: verifyCompliance } = await supabaseAdmin
  .from('compliance_results')
  .select('id')
  .eq('observation_id', observationId)
  .single();

if (!verifyCompliance) {
  console.error('❌ CRITICAL: compliance_results not created for observation:', observationId);
  // Retry or alert admin
}
```

**Add Matrix Existence Check:**
```typescript
// Before creating observation, verify zone has active matrix
const { data: activeMatrix } = await supabaseAdmin
  .from('zone_compliance_matrix')
  .select('id')
  .eq('zone_id', zoneId)
  .is('effective_to', null)
  .single();

if (!activeMatrix) {
  throw new Error(`Zone ${zoneId} has no active compliance matrix`);
}
```

---

## Summary Checklist

Run these checks in order:

- [ ] Run Query 1: Compare observation count vs compliance count
- [ ] Run Query 2: Find observations missing compliance results
- [ ] Run Query 3: Verify all active zones have compliance matrices
- [ ] Run Query 4: Check success rate over time
- [ ] Run Query 5: Verify calculate_vehicle_compliance() function exists
- [ ] Check Edge Function logs for errors
- [ ] Test calculate_vehicle_compliance() with sample data
- [ ] Run recalculation (Scope: BUILD, Date: All Time)
- [ ] Verify recalculation completed successfully
- [ ] Re-run Query 1 to confirm fix
- [ ] Create compliance_health_check view for monitoring
- [ ] Add validation logic to process-field-scan
- [ ] Deploy updated Edge Function
- [ ] Test new scan to verify compliance_results created

---

## Expected Outcome

After completing investigation and fixes:

1. ✅ ComplianceMatrixManagement shows correct observation counts
2. ✅ All observations have corresponding compliance_results
3. ✅ Future scans automatically create compliance_results
4. ✅ Health check catches issues before they become visible to users
5. ✅ Drift Dashboard shows compliance changes over time
