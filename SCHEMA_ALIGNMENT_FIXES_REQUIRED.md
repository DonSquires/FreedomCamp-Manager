# SCHEMA ALIGNMENT FIXES REQUIRED

## Critical Issues Found

### 1. **EnforcementActions.tsx - Missing useNavigate**
**File:** `src/pages/EnforcementActions.tsx`  
**Line:** 545  
**Issue:** Code tries to use `navigate()` but `useNavigate` is commented out  
**Current:**
```typescript
// import { useNavigate } from 'react-router-dom';
...
onClick={() => navigate(`/admin/vehicles?plate=${breach.plate_number}`)}
```
**Fix:** Uncomment the import:
```typescript
import { useNavigate } from 'react-router-dom';

export default function EnforcementActions() {
  const navigate = useNavigate();
  // ... rest of code
}
```

---

### 2. **useBreaches.ts - References Deprecated vehicle_records**
**File:** `src/hooks/useBreaches.ts`  
**Line:** 18-23  
**Issue:** Query references `vehicle_records` table which is deprecated  
**Current:**
```typescript
vehicle_record:vehicle_records(plate_number, vehicle_make, vehicle_model, vehicle_color)
```
**Fix:** Update to use `canonical_vehicles`:
```typescript
vehicle:canonical_vehicles!breach_alerts_plate_number_fkey(
  plate_number,
  make,
  model,
  colour
)
```

---

### 3. **Multiple Files Using observations**
**Impact:** High - 50+ occurrences  
**Issue:** Database table is named `observations` but should be `observations`  
**Schema Status:** Database has BOTH tables:
- ✅ `observations` (new simplified table - PRIMARY)
- ⚠️ `observations` (legacy table - should migrate away)

**Affected Files:**
- `src/components/features/ComplianceMetricsSummary.tsx`
- `src/components/features/ComplianceDrillDownModal.tsx`
- `src/components/features/VehicleDetailsPopup.tsx`
- `src/pages/VehicleManagement.tsx`
- `src/pages/ComplianceHeatMap.tsx`
- `src/lib/csvExport.ts`
- `src/lib/fullExport.ts`
- `supabase/functions/zone-correction/index.ts`
- `supabase/functions/recalculate-compliance/index.ts`
- `supabase/functions/duplicate-detection/index.ts`
- `supabase/functions/check-zone-corrections/index.ts`

**Strategy:** 
1. Keep using `observations` for NOW (it has data)
2. Create migration plan to move to `observations`
3. Add to migration backlog

---

### 4. **canonical_vehicles Schema Mismatch**
**Issue:** Some code uses wrong column names  
**Schema:**
```sql
canonical_vehicles:
  - plate_number (PRIMARY KEY)
  - id (UNIQUE - UUID)
  - make (NOT vehicle_make)
  - model (NOT vehicle_model)
  - colour (NOT vehicle_color)
  - homeless_status
  - is_flagged
```

**Affected Queries:** Check all queries for:
- ❌ `vehicle_make` → ✅ `make`
- ❌ `vehicle_model` → ✅ `model`
- ❌ `vehicle_color` → ✅ `colour`

---

### 5. **breach_alerts Foreign Key References**
**Schema Check:**
```sql
breach_alerts:
  - plate_number → canonical_vehicles(plate_number) ON DELETE SET NULL
  - observation_id → observations(observation_id) ON DELETE CASCADE
  - vehicle_record_id → vehicle_records(id) ON DELETE CASCADE
  - zone_id → zones(id) ON DELETE CASCADE
```

**Issue:** `vehicle_record_id` column exists but references deprecated `vehicle_records` table  
**Impact:** Low (column is nullable and not actively used)

---

### 6. **enforcement_actions Schema**
**Schema:**
```sql
enforcement_actions:
  - id (PRIMARY KEY)
  - plate_number (TEXT)
  - vehicle_record_id → vehicle_records(id) ON DELETE CASCADE
  - observation_id (UUID)
  - compliance_result_id (UUID)
```

**Issue:** Has `vehicle_record_id` foreign key to deprecated table  
**Fix Needed:** Schema migration to remove or update this FK

---

### 7. **observations Table - Current Schema**
**Confirmed Schema:**
```sql
observations:
  - id UUID PRIMARY KEY
  - idempotency_key TEXT NOT NULL UNIQUE
  - plate_number TEXT NOT NULL
  - photo_url TEXT NOT NULL
  - photo_hash TEXT NOT NULL
  - recorded_at TIMESTAMPTZ NOT NULL
  - zone_id UUID → zones(id) ON DELETE CASCADE
  - organization_id UUID → organizations(id) ON DELETE CASCADE
  - gps_latitude NUMERIC(10,8) NOT NULL
  - gps_longitude NUMERIC(11,8) NOT NULL
  - gps_accuracy NUMERIC(10,2)
  - recorded_by UUID → user_profiles(id) ON DELETE CASCADE
  - officer_notes TEXT
  - weather_conditions TEXT
  - vehicle_make TEXT
  - vehicle_model TEXT
  - vehicle_year INTEGER
  - vehicle_color TEXT
  - self_contained BOOLEAN DEFAULT false
  - self_contained_expiry DATE
  - is_compliant BOOLEAN DEFAULT true
  - breach_type TEXT
  - breach_reason TEXT
  - nights_stayed_this_month INTEGER DEFAULT 0
  - consecutive_nights INTEGER DEFAULT 0
```

**Files Using Correct Schema:** ✅
- `src/hooks/useVehicles.ts`
- `src/pages/ObservationsPage.tsx`
- `src/pages/VehicleRegistryFiltered.tsx`
- `src/pages/HotspotsMap.tsx`
- `src/pages/BreachAlertsReport.tsx`

---

## Priority Fixes

### 🔴 CRITICAL (Do Now)
1. Fix `EnforcementActions.tsx` - Add missing `useNavigate` import
2. Fix `useBreaches.ts` - Update to use `canonical_vehicles` instead of `vehicle_records`

### 🟡 HIGH (This Week)
3. Audit all `canonical_vehicles` queries for correct column names (make/model/colour)
4. Create migration plan for `observations` → `observations`

### 🟢 MEDIUM (Next Sprint)
5. Schema migration to remove `vehicle_records` foreign keys from `breach_alerts` and `enforcement_actions`
6. Add database migration to clean up deprecated columns

---

## Verification Checklist

- [ ] All queries use correct table names
- [ ] All column references match actual schema
- [ ] No queries reference deprecated tables
- [ ] All foreign keys are valid
- [ ] RLS policies align with current schema
- [ ] Edge functions use correct table/column names
- [ ] Hooks and components query correct columns

---

## Schema Reference Card (Quick Copy-Paste)

### canonical_vehicles
```typescript
.select('plate_number, make, model, colour, year, self_contained, self_contained_expiry, homeless_status, is_flagged, profile_photo')
```

### observations
```typescript
.select('id, plate_number, photo_url, recorded_at, zone_id, gps_latitude, gps_longitude, is_compliant, breach_type, officer_notes')
```

### breach_alerts
```typescript
.select(`
  *,
  zones(name),
  observations(photo_url),
  canonical_vehicles(make, model, colour, homeless_status, is_flagged)
`)
```

### enforcement_actions
```typescript
.select(`
  *,
  zones(name),
  user_profiles!enforcement_actions_assigned_to_fkey(first_name, last_name)
`)
```
