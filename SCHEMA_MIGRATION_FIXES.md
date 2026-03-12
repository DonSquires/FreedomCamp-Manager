# 🔧 SCHEMA MIGRATION FIXES - COMPLETE EDGE FUNCTION AUDIT

## Migration Summary

**OLD SCHEMA → NEW SCHEMA**
- `canonical_vehicles_backup_20250203` (vehicle_id UUID PK) → `canonical_vehicles` (plate_number TEXT PK)
- `vehicle_observations` (references vehicle_id) → `observations` (references plate_number)
- `vehicle_records` (deprecated) → use `observations` instead
- `vehicle_monthly_stays` (new table, references plate_number)

## ✅ WORKING Edge Functions (No Changes Needed)

1. **recalculate-compliance-v2** - ✅ Uses observations + canonical_vehicles correctly
2. **check-zone-corrections** - ✅ Uses observations correctly  
3. **check-data-integrity** - ✅ Uses canonical_vehicles + observations correctly

## ❌ BROKEN Edge Functions (Require Fixes)

### 1. scan-breaches
**Issue**: Line 53 - Uses `vehicle_records` table (deprecated)
**Fix**: Replace with query to `observations` table
**Impact**: CRITICAL - Breach scanning completely broken

### 2. process-homeless-data  
**Issue**: Lines 169, 219 - Uses `vehicle_records` table
**Fix**: Update to query `canonical_vehicles` table instead (homeless status is on canonical_vehicles now)
**Impact**: HIGH - Homeless data import broken

### 3. import-data
**Issue**: Line 244 - Creates records in `vehicle_records` table
**Fix**: Update to create records in `observations` table using plate_number
**Impact**: CRITICAL - All data imports broken

### 4. recalculate-compliance (OLD VERSION)
**Issue**: Lines 184-185, 222, 239, 285, 292, 306 - Uses `vehicle_observations` table
**Fix**: Replace with `observations` and update foreign key references
**Impact**: HIGH - Old recalculation process broken (but v2 works)
**Recommendation**: DELETE this file, use recalculate-compliance-v2 exclusively

### 5. correct-zone-assignments
**Issue**: Lines 180, 235, 252 - Uses `vehicle_records` table  
**Fix**: Replace with `observations` table
**Impact**: HIGH - Zone correction workflow broken

### 6. get-compliance-statistics
**Issue**: Line 57 - Uses `vehicle_records` table
**Fix**: Replace with `observations` table, update aggregation logic
**Impact**: HIGH - Compliance reporting broken

### 7. update-compliance-policy
**Issue**: Lines 28, 96 - Uses `vehicle_records` table
**Fix**: Replace with `observations` table
**Impact**: MEDIUM - Policy updates won't apply

### 8. stream-webhook
**Issue**: Lines 104, 126, 204, 248 - Uses `vehicle_records` table
**Fix**: Replace with `observations` table
**Impact**: CRITICAL - Real-time ALPR stream processing broken

### 9. generate-leadership-pack
**Issue**: Line 71 - Uses `vehicle_observations` table
**Fix**: Replace with `observations` table
**Impact**: LOW - PDF reporting broken

## 🔍 DATABASE FUNCTION ISSUES

The `calculate_vehicle_compliance` database function likely ALSO uses old schema references.

**CRITICAL**: Need to check database function definition:
```sql
SELECT pg_get_functiondef(oid) 
FROM pg_proc 
WHERE proname = 'calculate_vehicle_compliance';
```

## 📋 FIX PRIORITY

**Priority 1 (CRITICAL - System Broken)**
1. import-data (all imports broken)
2. stream-webhook (real-time ALPR broken)
3. scan-breaches (breach detection broken)

**Priority 2 (HIGH - Core Features Broken)**  
4. process-homeless-data
5. correct-zone-assignments
6. get-compliance-statistics

**Priority 3 (MEDIUM - Secondary Features)**
7. update-compliance-policy
8. generate-leadership-pack

**Priority 4 (CLEANUP)**
9. DELETE recalculate-compliance (old version)

## 🎯 RECOMMENDED ACTION PLAN

### Phase 1: Fix Critical Edge Functions (30 min)
- Fix import-data
- Fix stream-webhook  
- Fix scan-breaches

### Phase 2: Fix Core Features (30 min)
- Fix process-homeless-data
- Fix correct-zone-assignments
- Fix get-compliance-statistics

### Phase 3: Fix Secondary Features (15 min)
- Fix update-compliance-policy
- Fix generate-leadership-pack

### Phase 4: Cleanup (5 min)
- Delete old recalculate-compliance function
- Verify all frontend pages use correct table names

### Phase 5: Database Function Check (15 min)
- Check calculate_vehicle_compliance function definition
- Update if needed to use canonical_vehicles + plate_number

## 📊 FRONTEND MIGRATION STATUS

**Also need to check frontend files:**
- src/components/features/IncidentCreationForm.tsx - Line 229 uses vehicle_observations
- src/components/features/DuplicateScanModal.tsx - Line 60 uses vehicle_observations
- src/components/features/SessionList.tsx - Line 92 uses vehicle_observations
- src/pages/IncidentReports.tsx - Line 206 uses vehicle_observations
- src/components/features/VehicleDetailsPopup.tsx - Line 155 uses vehicle_observations
- src/lib/fullExport.ts - Line 48 uses vehicle_observations
- src/pages/VehicleManagement.tsx - Multiple lines use vehicle_observations

## ✅ VERIFICATION CHECKLIST

After all fixes:
- [ ] Run data integrity check
- [ ] Test import workflow end-to-end
- [ ] Test ALPR stream webhook
- [ ] Test breach scanning
- [ ] Test compliance recalculation
- [ ] Verify all frontend pages work
- [ ] Check database function definitions
- [ ] Run full system smoke test
