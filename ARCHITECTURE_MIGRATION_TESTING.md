# Architecture Migration Testing Checklist

## Overview
This checklist verifies the clean separation between **Section 1 (Data Gathering)** and **Section 2 (Reporting)** after the schema migration.

---

## ✅ Pre-Migration Verification

- [x] SQL migration applied: `20250213_clean_architecture_separation.sql`
- [x] Backup created: `vehicle_observations_v2_backup_20250213`
- [x] Columns removed from `vehicle_observations_v2`:
  - [x] `vehicle_make`, `vehicle_model`, `vehicle_year`, `vehicle_color`
  - [x] `self_contained`, `self_contained_expiry`
  - [x] `is_compliant`, `is_breach`, `breach_type`, `breach_details`
  - [x] `compliance_snapshot`, `breach_warning`, `breach_warning_reason`
- [x] View created: `vehicle_observations_with_details`
- [x] Trigger updated: `trigger_create_breach_alert_from_compliance`

---

## 📊 Database Integrity Checks

Run these queries in Supabase SQL Editor to verify data integrity:

### 1. Check Observations Table Structure
```sql
-- Should only show observation fields (no vehicle details, no compliance)
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'vehicle_observations_v2'
ORDER BY ordinal_position;
```

**Expected Columns:**
- `observation_id`, `plate_number`, `organization_id`, `zone_id`, `recorded_by`
- `photo`, `photo_hash`, `gps_latitude`, `gps_longitude`, `gps_accuracy`
- `recorded_at`, `officer_notes`, `has_notes`, `notes_reference_previous`
- `has_hs_incident`, `hs_incident_id`, `has_incident`, `incident_id`
- `has_homeless_claim`, `homeless_claim_notes`, `created_at`, `updated_at`

**Should NOT contain:**
- ❌ `vehicle_make`, `vehicle_model`, `vehicle_year`, `vehicle_color`
- ❌ `self_contained`, `self_contained_expiry`
- ❌ `is_compliant`, `is_breach`, `breach_type`, `breach_details`

---

### 2. Verify All Observations Have Canonical Records
```sql
-- Should return 0 orphaned observations
SELECT COUNT(*) as orphaned_observations
FROM vehicle_observations_v2 obs
LEFT JOIN canonical_vehicles cv ON obs.plate_number = cv.plate_number
WHERE cv.plate_number IS NULL;
```

**Expected:** `0 orphaned_observations`

---

### 3. Check Compliance Results Coverage
```sql
-- Count observations with/without compliance results
SELECT 
  COUNT(*) as total_observations,
  COUNT(cr.id) as with_compliance_results,
  COUNT(*) - COUNT(cr.id) as missing_compliance_results
FROM vehicle_observations_v2 obs
LEFT JOIN compliance_results cr ON obs.observation_id = cr.observation_id;
```

**Expected:** Most observations should have compliance results (unless very recent)

---

### 4. Verify View Works Correctly
```sql
-- Test the compatibility view
SELECT 
  observation_id,
  plate_number,
  vehicle_make,  -- Should come from canonical_vehicles
  vehicle_model,
  is_compliant,  -- Should come from compliance_results
  zone_name
FROM vehicle_observations_with_details
LIMIT 5;
```

**Expected:** All fields populated correctly via joins

---

## 🔧 Edge Function Tests

### Test `process-field-scan` Edge Function

1. **Create a test scan via Field Officer Portal**
   - Scan a vehicle
   - Click "Check"
   - Verify compliance modal shows correct data

2. **Verify Database Records**
```sql
-- Check the most recent observation
SELECT 
  obs.observation_id,
  obs.plate_number,
  obs.photo,
  obs.recorded_at,
  -- Vehicle details should be NULL (not in obs table)
  cv.vehicle_make,
  cv.vehicle_model,
  -- Compliance should be in separate table
  cr.is_compliant,
  cr.violation_reasons
FROM vehicle_observations_v2 obs
LEFT JOIN canonical_vehicles cv ON obs.plate_number = cv.plate_number
LEFT JOIN compliance_results cr ON obs.observation_id = cr.observation_id
ORDER BY obs.recorded_at DESC
LIMIT 1;
```

**Expected:**
- ✅ `obs` fields contain ONLY observation data (photo, plate, location, time, notes)
- ✅ `cv` fields contain vehicle details (make/model/color)
- ✅ `cr` fields contain compliance evaluation (is_compliant, violations)

---

## 🎯 Frontend Query Tests

### Test Each Report/Page

#### 1. **Compliance Analytics** (`src/pages/ComplianceAnalytics.tsx`)
- [ ] Navigate to Admin Portal → Analytics Hub → Compliance Analytics
- [ ] Verify summary stats load correctly
- [ ] Check compliance rate calculation
- [ ] Verify homeless vehicle counts show correctly
- [ ] Test zone breakdown displays properly
- [ ] Export CSV and verify all columns present

**Query Pattern to Verify:**
```typescript
// Should use vehicle_observations_with_details OR manual joins
const { data } = await supabase
  .from('vehicle_observations_with_details')
  .select('plate_number, vehicle_make, is_compliant, homeless_status')
  .gte('recorded_at', startDate)
  .lte('recorded_at', endDate);
```

---

#### 2. **Vehicle Activity Report** (`src/pages/VehicleActivityReport.tsx`)
- [ ] Navigate to Analytics Hub → Vehicle Activity Report
- [ ] Search for a specific plate number
- [ ] Click "View Details" on a vehicle
- [ ] Verify observation history shows correctly
- [ ] Check compliance badges (compliant/non-compliant)
- [ ] Verify homeless status badges appear

**Query Pattern:**
```typescript
// Should join canonical_vehicles for vehicle details
const { data } = await supabase
  .from('vehicle_observations_v2')
  .select(`
    observation_id,
    plate_number,
    recorded_at,
    canonical_vehicles(vehicle_make, vehicle_model, homeless_status)
  `)
  .eq('plate_number', plateNumber);
```

---

#### 3. **Enforcement Hub** (`src/pages/EnforcementHub.tsx`)
- [ ] Navigate to Admin Portal → Enforcement Hub
- [ ] Check "Active Breaches" tab loads
- [ ] Verify breach vehicles show correct details
- [ ] Check "Assigned Jobs" tab
- [ ] Verify "Completed" tab shows historical data

**Query Pattern:**
```typescript
// Should join both canonical_vehicles AND compliance_results
const { data } = await supabase
  .from('vehicle_observations_v2')
  .select(`
    observation_id,
    plate_number,
    canonical_vehicles(vehicle_make, vehicle_model),
    compliance_results(is_compliant, violation_reasons)
  `)
  .eq('organization_id', orgId);
```

---

#### 4. **CSV Exports** (`src/lib/csvExport.ts`)
- [ ] Export Dashboard CSV (Organization Dashboard)
- [ ] Verify all vehicle details appear in export
- [ ] Check compliance status columns
- [ ] Verify homeless status columns
- [ ] Open CSV in Excel to verify formatting

---

## 🧪 End-to-End Workflow Test

### Complete Field Officer → Admin Workflow

1. **Field Officer Portal** (Mobile Simulation)
   - [ ] Scan a vehicle with Details Mode
   - [ ] VehicleDetailsPopup shows enriched data from `canonical_vehicles`
   - [ ] Click "Check"
   - [ ] ComplianceResultModal shows evaluation from `compliance_results`
   - [ ] Verify homeless vehicles show purple "FC Act Exempt" badge
   - [ ] Verify breach vehicles show red "Non-Compliant" status

2. **Database Verification**
   ```sql
   -- Check separation
   SELECT 
     'Observation' as source,
     observation_id,
     plate_number,
     photo,
     recorded_at,
     NULL as vehicle_make,  -- Should be NULL in observation
     NULL as is_compliant   -- Should be NULL in observation
   FROM vehicle_observations_v2
   WHERE plate_number = 'YOUR_TEST_PLATE'
   
   UNION ALL
   
   SELECT 
     'Canonical' as source,
     NULL,
     plate_number,
     NULL,
     NULL,
     vehicle_make,
     NULL
   FROM canonical_vehicles
   WHERE plate_number = 'YOUR_TEST_PLATE'
   
   UNION ALL
   
   SELECT 
     'Compliance' as source,
     observation_id,
     NULL,
     NULL,
     NULL,
     NULL,
     is_compliant::TEXT
   FROM compliance_results cr
   JOIN vehicle_observations_v2 obs ON cr.observation_id = obs.observation_id
   WHERE obs.plate_number = 'YOUR_TEST_PLATE';
   ```

3. **Admin Portal Verification**
   - [ ] Admin sees vehicle in Enforcement Hub (if breach)
   - [ ] Vehicle details accurate (from canonical_vehicles)
   - [ ] Compliance status accurate (from compliance_results)
   - [ ] Can assign enforcement job
   - [ ] Compliance Analytics shows correct stats

---

## 🚨 Regression Testing

Test scenarios that might break with new architecture:

### Scenario 1: Vehicle Without Canonical Record
- [ ] Manually insert observation with non-existent plate
- [ ] Verify system handles gracefully (should create canonical record)
- [ ] Check if vehicle details populate correctly

### Scenario 2: Observation Without Compliance Result
- [ ] Check if recent observations missing compliance_results
- [ ] Verify reports handle NULL compliance gracefully
- [ ] Confirm compliance evaluation ran for all scans

### Scenario 3: Homeless Vehicle Scanning
- [ ] Scan a confirmed homeless vehicle (e.g., DTQ338)
- [ ] Verify purple "FC Act Exempt" badge appears
- [ ] Check compliance_results shows exemption
- [ ] Confirm NO breach alert created

### Scenario 4: Matrix Rule Change
- [ ] Update a zone's compliance matrix
- [ ] Run recalculation
- [ ] Verify observations remain unchanged (pure data)
- [ ] Confirm compliance_results updated with new evaluation

---

## ✅ Success Criteria

Migration is successful when:

1. **Data Integrity**
   - ✅ All observations have canonical_vehicles records
   - ✅ No orphaned observations
   - ✅ Compliance_results present for all evaluated observations

2. **Separation of Concerns**
   - ✅ `vehicle_observations_v2` contains ONLY observation data
   - ✅ `canonical_vehicles` contains ONLY vehicle details
   - ✅ `compliance_results` contains ONLY compliance evaluation

3. **Frontend Works**
   - ✅ All reports load without errors
   - ✅ Vehicle details display correctly
   - ✅ Compliance status accurate
   - ✅ CSV exports contain all data

4. **Workflows Intact**
   - ✅ Field officers can scan vehicles
   - ✅ Admins can view/manage breaches
   - ✅ Compliance recalculation works
   - ✅ Homeless exemption applies correctly

---

## 🔄 Rollback Plan

If critical issues found:

1. **Restore from Backup**
   ```sql
   -- Drop modified table
   DROP TABLE vehicle_observations_v2 CASCADE;
   
   -- Restore from backup
   ALTER TABLE vehicle_observations_v2_backup_20250213 
   RENAME TO vehicle_observations_v2;
   
   -- Recreate triggers
   -- (Restore original trigger code)
   ```

2. **Notify Team**
   - Document issues encountered
   - Plan remediation strategy
   - Schedule re-migration

---

## 📝 Sign-Off

- [ ] Database verification passed
- [ ] Edge function tests passed
- [ ] Frontend query tests passed
- [ ] End-to-end workflow passed
- [ ] Regression tests passed
- [ ] CSV exports verified

**Tested By:** _________________  
**Date:** _________________  
**Approved By:** _________________  
**Date:** _________________  

---

## 📚 Reference

- **Migration SQL:** `supabase/migrations/20250213_clean_architecture_separation.sql`
- **Edge Function:** `supabase/functions/process-field-scan/index.ts`
- **Compatibility View:** `vehicle_observations_with_details`
- **Documentation:** `DATABASE_SCHEMA_AND_REPORTING_MAP.json`
