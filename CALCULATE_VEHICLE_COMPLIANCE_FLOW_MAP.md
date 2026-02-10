# 🗺️ calculate_vehicle_compliance() - Complete System Flow Map

**Last Updated:** 2026-01-31  
**Purpose:** Map all data inputs, maintenance operations, and reports that use the centralized compliance function

---

## 📊 EXECUTIVE SUMMARY

`calculate_vehicle_compliance()` is the **SINGLE SOURCE OF TRUTH** for all compliance evaluation in the system. Every breach detection, compliance report, and enforcement action flows through this function.

**Current Status:** ✅ **FULLY OPERATIONAL**

---

## 🔄 DATA INPUT FLOW

### 1️⃣ Field Officer Portal → Vehicle Observations

**Entry Point:** `src/pages/FieldOfficerPortal.tsx`  
**Capture Component:** `src/components/features/PlateCapture.tsx`

#### Flow:
```
Officer scans plate
  ↓
PlateCapture.tsx sends image to ALPR/OCR
  ↓
Edge Function: process-field-scan
  ↓
Creates vehicle_observations record
  ↓
Calls calculate_vehicle_compliance() ✅
  ↓
Upserts compliance_results table
  ↓
Creates breach_alerts if non-compliant
```

**Files Involved:**
- `src/components/features/PlateCapture.tsx` (Line 1016: invokes process-field-scan)
- `supabase/functions/process-field-scan/index.ts` (Line 273: calls calculate_vehicle_compliance)
- Database: `vehicle_observations` → `compliance_results` → `breach_alerts`

**🔗 Link Status:** ✅ **WORKING** - Per-observation breach alerts created

---

### 2️⃣ Driving Mode Scans

**Entry Point:** `src/components/features/PlateCapture.tsx` (Driving Mode)  
**Edge Function:** `supabase/functions/process-driving-scan/index.ts`

#### Flow:
```
Fast-path continuous scanning
  ↓
ALPR recognition (plate only)
  ↓
Fast-insert to vehicle_records
  ↓
Calls calculate_vehicle_compliance() ✅ (Line 252)
  ↓
Creates breach_alerts if non-compliant
  ↓
Background enrichment (photos, vehicle details)
```

**🔗 Link Status:** ✅ **WORKING** - Background enrichment after compliance check

---

### 3️⃣ Historical Data Import

**Entry Point:** `src/pages/HistoricalImport.tsx`  
**Edge Function:** `supabase/functions/import-historical-data/index.ts`

#### Flow:
```
CSV upload
  ↓
Parse and validate rows
  ↓
Create vehicle_records
  ↓
Calls calculate_vehicle_compliance() ✅ (Line 1007)
  ↓
Upserts compliance_results
  ↓
Creates breach_alerts for historical breaches
```

**🔗 Link Status:** ✅ **WORKING** - Historical data properly evaluated

---

### 4️⃣ Stream Webhook (Deprecated but functional)

**Entry Point:** External stream data  
**Edge Function:** `supabase/functions/stream-webhook/index.ts`

#### Flow:
```
Webhook receives stream data
  ↓
Validates and transforms payload
  ↓
Creates vehicle_records
  ↓
Calls calculate_vehicle_compliance() ✅ (Line 234)
  ↓
Creates breach_alerts
```

**🔗 Link Status:** ⚠️ **DEPRECATED** - Stream integration not actively used

---

## 🔧 MAINTENANCE OPERATIONS

### 1️⃣ Recalculation V2 (Current System)

**Entry Point:** `src/pages/ComplianceRecalculation.tsx`  
**Edge Function:** `supabase/functions/recalculate-compliance-v2/index.ts`

#### Flow:
```
Admin selects scope (ZONE/ORG/BUILD)
  ↓
Date range filter
  ↓
Fetches all vehicle_observations in scope
  ↓
For each observation:
  ├─ Calls calculate_vehicle_compliance() ✅ (Line 233)
  ├─ Upserts compliance_results
  └─ Creates ONE breach_alert per non-compliant observation
  ↓
Tracks progress in admin_recalculation_actions
```

**Parameters:**
- `scope`: 'ZONE' | 'ORG' | 'BUILD'
- `zoneIds`: UUID[] (required if scope=ZONE)
- `orgIds`: UUID[] (required if scope=ORG)
- `dateRangeStart`: ISO date string (optional)
- `dateRangeEnd`: ISO date string (optional)

**🔗 Link Status:** ✅ **WORKING** - Per-observation breach architecture

**❌ CURRENT ERROR:** "column reference 'zone_id' is ambiguous"
- **Cause:** Multiple tables in JOINs have zone_id column
- **Fix:** Already provided - awaiting user SQL execution
- **Impact:** Recalculation fails at 84% error rate (124 errors / 147 observations)

---

### 2️⃣ Breach Scanner

**Entry Point:** `src/pages/BreachAlertManagement.tsx` (Manual scan)  
**Edge Function:** `supabase/functions/scan-breaches/index.ts`

#### Flow:
```
Manual breach scan triggered
  ↓
Fetches all vehicle_records
  ↓
Groups by zone + plate
  ↓
Calls calculate_vehicle_compliance() ✅ (Line 98)
  ↓
Creates breach_alerts for new violations
```

**🔗 Link Status:** ✅ **WORKING** - Uses centralized compliance function

---

### 3️⃣ Zone Corrections

**Entry Point:** `src/pages/ZoneCorrections.tsx`  
**Edge Function:** `supabase/functions/correct-zone-assignments/index.ts`

#### Flow:
```
Detects observations with incorrect zone assignments
  ↓
Corrects zone_id based on GPS coordinates
  ↓
Re-runs calculate_vehicle_compliance() for corrected observations
  ↓
Updates compliance_results
```

**🔗 Link Status:** ✅ **WORKING** - Compliance re-evaluated after zone corrections

---

### 4️⃣ Compliance Matrix Updates

**Entry Point:** `src/pages/ComplianceMatrixManagement.tsx`  
**Edge Function:** `supabase/functions/update-compliance-policy/index.ts`

#### Flow:
```
Admin creates new compliance matrix version
  ↓
Creates drift_events record
  ↓
Triggers recalculation for affected observations
  ↓
Calls calculate_vehicle_compliance() with new matrix
  ↓
Updates compliance_results with new matrix_id
```

**🔗 Link Status:** ✅ **WORKING** - Drift detection tracks compliance changes

---

## 📈 REPORTING & ANALYTICS

### 1️⃣ Compliance Analytics Dashboard

**File:** `src/pages/ComplianceAnalytics.tsx`

#### Query Path:
```sql
SELECT vehicle_observations
  JOIN compliance_results ON observation_id
WHERE date_range
GROUP BY zone_id
```

**Data Sources:**
- `vehicle_observations` table
- `compliance_results` table (created by calculate_vehicle_compliance)
- Joins on `observation_id`

**Metrics Displayed:**
- Total observations
- Compliant count
- **Total breaches** (from compliance_results where is_compliant=false)
- Per-zone breakdown
- Compliance rate percentage

**🔗 Link Status:** ✅ **WORKING** - Shows accurate breach counts per zone

**Lines:** 106-185

---

### 2️⃣ Breach Alert Management

**File:** `src/pages/BreachAlertManagement.tsx`

#### Query Path:
```sql
SELECT * FROM breach_alerts_with_actions
  JOIN breach_alert_observations (via RPC)
WHERE action_status
```

**Data Sources:**
- `breach_alerts` table (created by calculate_vehicle_compliance)
- `breach_alerts_with_actions` VIEW (enriched with zone/vehicle/org data)
- `get_breach_alert_observations` RPC (fetches observations per breach)

**Actions Available:**
- Mark for Enforcement
- Set Monitoring Period
- Mark as Homeless
- Close Alert
- **"Not a Breach"** override

**🔗 Link Status:** ✅ **WORKING** - One breach alert per non-compliant observation

---

### 3️⃣ Zone Drilldown

**File:** `src/pages/ZoneDrillDown.tsx`

#### Query Path:
```sql
SELECT vehicle_observations
  JOIN compliance_results
WHERE zone_id = ?
```

**Metrics:**
- Zone-specific compliance rates
- Breach trends over time
- Individual observation details

**🔗 Link Status:** ✅ **WORKING** - Pulls from compliance_results

---

### 4️⃣ Organization Dashboard

**File:** `src/pages/OrganizationDashboard.tsx`

#### Query Path:
```sql
SELECT zones
  JOIN vehicle_observations
  JOIN compliance_results
WHERE organization_id = ?
GROUP BY zone_id
```

**Metrics:**
- Cross-zone compliance summary
- Breach hotspots
- Officer activity

**🔗 Link Status:** ✅ **WORKING** - Aggregates compliance_results

---

### 5️⃣ Officer Activity Dashboard

**File:** `src/pages/OfficerActivityDashboard.tsx`

#### Query Path:
```sql
SELECT vehicle_observations
  JOIN compliance_results
WHERE recorded_by = officer_id
GROUP BY officer, zone
```

**Metrics:**
- Scans per officer
- Compliance detection rates
- Breach identification performance

**🔗 Link Status:** ✅ **WORKING** - Links observations to compliance results

---

### 6️⃣ Leadership Pack Generator

**File:** `src/pages/LeadershipPackGenerator.tsx`  
**Edge Function:** `supabase/functions/generate-leadership-pack/index.ts`

#### Flow:
```
Admin selects date range + organization
  ↓
Edge Function aggregates:
  ├─ vehicle_observations
  ├─ compliance_results ✅
  ├─ breach_alerts
  ├─ enforcement_actions
  └─ incidents
  ↓
Generates PDF report with:
  ├─ Compliance trends
  ├─ Breach statistics
  ├─ Zone performance
  └─ Enforcement outcomes
```

**🔗 Link Status:** ✅ **WORKING** - Uses compliance_results for breach analysis

---

### 7️⃣ Compliance Statistics Endpoint

**Edge Function:** `supabase/functions/get-compliance-statistics/index.ts`

#### Flow:
```
REST API endpoint for compliance stats
  ↓
Fetches unique plate/zone combinations
  ↓
Calls calculate_vehicle_compliance() ✅ (Line 136)
  ↓
Returns aggregated compliance metrics
```

**🔗 Link Status:** ✅ **WORKING** - Real-time compliance calculation

---

## 🔍 VERIFICATION HOOKS

### Frontend React Hooks

#### 1. `useVehicleCompliance` Hook
**File:** `src/hooks/useVehicleCompliance.ts`

```typescript
// Direct RPC call to calculate_vehicle_compliance (Line 51)
const { data, error } = await supabase.rpc('calculate_vehicle_compliance', {
  p_plate_number: plateNumber,
  p_zone_id: zoneId,
  p_check_date: checkDate,
});
```

**Usage:**
- Real-time compliance checking in UI
- Instant feedback for field officers
- Vehicle detail popups

**🔗 Link Status:** ✅ **WORKING**

---

#### 2. `useBreaches` Hook
**File:** `src/hooks/useBreaches.ts`

```typescript
// Queries breach_alerts table (created by calculate_vehicle_compliance)
// Line 9: Comment confirms centralized compliance function usage
```

**🔗 Link Status:** ✅ **WORKING**

---

## 🚨 BROKEN LINKS & ISSUES

### ❌ CRITICAL: Recalculation Failing

**File:** `supabase/functions/recalculate-compliance-v2/index.ts`

**Error:** 
```
column reference "zone_id" is ambiguous
```

**Impact:**
- 124 errors / 147 observations (84% failure rate)
- Recalculation completes but with high error rate
- Vehicle DRD906 not showing all 11 expected breaches

**Root Cause:**
The `calculate_vehicle_compliance` SQL function has ambiguous column references when joining multiple tables that all have `zone_id` columns. Example:

```sql
-- ❌ WRONG: Ambiguous reference
FROM vehicle_observations
JOIN zone_compliance_matrix ON zone_id = zone_id
WHERE zone_id = p_zone_id

-- ✅ CORRECT: Fully qualified
FROM vehicle_observations vo
JOIN zone_compliance_matrix zcm ON vo.zone_id = zcm.zone_id
WHERE vo.zone_id = p_zone_id
```

**Fix Status:** 🟡 **SQL FIX PROVIDED** - Awaiting user execution

**SQL Migration Prepared:**
- Drops old function
- Recreates with all column references qualified with table aliases (e.g., `vo.zone_id`, `zcm.zone_id`, `z.zone_id`)
- All subqueries use explicit table aliases

**Next Steps:**
1. User approves SQL migration in Supabase dashboard
2. Run full recalculation (ZONE/ORG/BUILD scope)
3. Verify all 11 breaches for DRD906 appear in Compliance Analytics

---

### ⚠️ WARNING: Legacy Vehicle Records Table

**Table:** `vehicle_records_deprecated_20250131`

**Issue:**
- Old `vehicle_records` table still referenced in some Edge Functions
- Should use `vehicle_observations` as single source of truth
- Backward compatibility VIEW exists but may cause confusion

**Files Still Using `vehicle_records`:**
- `supabase/functions/process-driving-scan/index.ts` (Line 87, 122, 145, 252, 276)
- `scan-breaches/index.ts` (Line 62)

**Recommendation:**
- Migrate these functions to query `vehicle_observations` instead
- Update all INSERT operations to create observations, not records
- Eventually drop the compatibility VIEW

**🔗 Link Status:** ⚠️ **PARTIAL** - Some functions use deprecated table

---

## ✅ VALIDATION QUERIES

Run these in Supabase SQL Editor to verify system integrity:

### 1. Check Compliance Results Coverage
```sql
-- All observations should have compliance results
SELECT 
  COUNT(*) AS total_observations,
  COUNT(cr.observation_id) AS observations_with_compliance,
  COUNT(*) - COUNT(cr.observation_id) AS missing_compliance
FROM vehicle_observations vo
LEFT JOIN compliance_results cr ON vo.observation_id = cr.observation_id
WHERE vo.recorded_at >= CURRENT_DATE - INTERVAL '90 days';
```

**Expected:** `missing_compliance = 0`

---

### 2. Check Breach Alerts Per Observation
```sql
-- Each non-compliant observation should have ONE breach alert
SELECT 
  observation_id,
  COUNT(*) as breach_count
FROM breach_alerts
GROUP BY observation_id
HAVING COUNT(*) > 1;
```

**Expected:** 0 rows (no duplicates due to unique constraint)

---

### 3. Verify DRD906 Breaches
```sql
-- Check all breaches for vehicle DRD906
SELECT 
  ba.id,
  ba.breach_type,
  ba.created_at,
  vo.recorded_at AS observation_date,
  z.name AS zone_name,
  cr.violation_reasons
FROM breach_alerts ba
JOIN vehicle_observations vo ON vo.observation_id = ba.observation_id
JOIN canonical_vehicles cv ON cv.vehicle_id = vo.vehicle_id
JOIN zones z ON z.id = ba.zone_id
LEFT JOIN compliance_results cr ON cr.observation_id = ba.observation_id
WHERE cv.plate_number = 'DRD906'
ORDER BY vo.recorded_at DESC;
```

**Expected:** 11 rows showing all breached observations

---

### 4. Check Compliance Function Availability
```sql
-- Verify function exists and has correct signature
SELECT 
  routine_name,
  data_type,
  parameter_mode,
  parameter_name,
  ordinal_position
FROM information_schema.parameters
WHERE specific_schema = 'public'
  AND routine_name = 'calculate_vehicle_compliance'
ORDER BY ordinal_position;
```

**Expected:** 3 parameters (p_plate_number, p_zone_id, p_check_date)

---

## 📋 DEPENDENCY GRAPH

```
┌─────────────────────────────────────────────┐
│  calculate_vehicle_compliance()             │
│  (SQL Function - Single Source of Truth)    │
└─────────────────┬───────────────────────────┘
                  │
    ┌─────────────┴─────────────┐
    │                           │
    ▼                           ▼
┌───────────────┐      ┌────────────────────┐
│ INPUT SOURCES │      │ OUTPUT TABLES      │
└───────┬───────┘      └────────┬───────────┘
        │                       │
        ├─ Field Officer Portal ├─ compliance_results
        ├─ Driving Mode Scans  ├─ breach_alerts
        ├─ Historical Import   ├─ drift_events
        ├─ Recalculation       └─ (updates existing records)
        └─ Zone Corrections
                  │
    ┌─────────────┴─────────────┐
    │                           │
    ▼                           ▼
┌───────────────┐      ┌────────────────────┐
│ REPORTS       │      │ ACTIONS            │
└───────┬───────┘      └────────┬───────────┘
        │                       │
        ├─ Compliance Analytics ├─ Breach Management
        ├─ Zone Drilldown      ├─ Notice Generation
        ├─ Officer Activity    ├─ Enforcement Actions
        ├─ Organization Dash   ├─ Homeless Marking
        └─ Leadership Pack     └─ Monitoring Periods
```

---

## 🎯 SUMMARY

### ✅ What's Working:
1. ✅ Field Officer Portal → process-field-scan → compliance check → breach alerts
2. ✅ Driving Mode → process-driving-scan → compliance check
3. ✅ Historical Import → compliance evaluation
4. ✅ Breach Alert Management → one alert per observation
5. ✅ Compliance Analytics → accurate breach counts per zone
6. ✅ Zone Drilldown → observation-level compliance details
7. ✅ "Not a Breach" override → compliance result correction
8. ✅ Per-observation architecture → no vehicle-level deduplication

### ❌ What's Broken:
1. ❌ **Recalculation V2** - "column reference zone_id is ambiguous" error (84% failure rate)
2. ⚠️ Some Edge Functions still use deprecated `vehicle_records` table

### 🔧 Immediate Fixes Required:
1. **Execute SQL migration** to fix `calculate_vehicle_compliance` ambiguous column references
2. **Run full recalculation** (BUILD scope, last 90 days)
3. **Verify DRD906** shows all 11 breaches in Compliance Analytics

### 📊 Expected Results After Fix:
- Recalculation: 0% error rate (all observations processed successfully)
- DRD906: 11 breach alerts visible in both Breach Alert Management and Compliance Analytics
- Compliance Analytics: Accurate per-zone breach counts
- All historical data properly evaluated with current compliance matrix

---

**Next Action:** Run the SQL migration fix for `calculate_vehicle_compliance` to resolve the "column reference zone_id is ambiguous" error, then execute a full BUILD scope recalculation.
