# Homeless Data Consolidation Plan

## Current Problem: Data Fragmentation

Homeless vehicle data is currently scattered across **4 different locations**:

### 1. `canonical_vehicles` (✅ CORRECT - Single Source of Truth)
```sql
- homeless_status: 'none' | 'claimed' | 'confirmed'
- homeless_confirmed_at: timestamp
- homeless_confirmed_by: uuid (FK to user_profiles)
- homeless_notes: text
```

### 2. `flagged_vehicles` (❌ REDUNDANT)
```sql
- confirmed_homeless: boolean
```

### 3. `vehicle_records` (❌ DEPRECATED TABLE)
```sql
- homeless_claimed: boolean
- homeless_confirmed: boolean
- homeless_confirmed_by: uuid
- homeless_confirmed_at: timestamp
- homeless_confirmation_notes: text
```

### 4. `vehicle_observations_v2` (❌ REDUNDANT)
```sql
- has_homeless_claim: boolean
- homeless_claim_notes: text
```

---

## Solution: Consolidate to `canonical_vehicles`

### Phase 1: Database Migration (SQL)

**Goal:** Make `canonical_vehicles` the single source of truth for homeless status

#### 1.1 Add Missing Trigger to Sync Homeless Status
```sql
-- Auto-update canonical_vehicles.homeless_status when observation has homeless claim
CREATE OR REPLACE FUNCTION sync_homeless_status_to_canonical()
RETURNS TRIGGER AS $$
BEGIN
  -- If observation has homeless claim, update canonical vehicle
  IF NEW.has_homeless_claim = true THEN
    UPDATE canonical_vehicles
    SET 
      homeless_status = CASE 
        WHEN homeless_status = 'confirmed' THEN 'confirmed' -- Don't downgrade confirmed status
        ELSE 'claimed'
      END,
      homeless_notes = COALESCE(homeless_notes || E'\n' || NEW.homeless_claim_notes, NEW.homeless_claim_notes),
      updated_at = now()
    WHERE plate_number = NEW.plate_number;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_sync_homeless_to_canonical
  AFTER INSERT OR UPDATE ON vehicle_observations_v2
  FOR EACH ROW
  WHEN (NEW.has_homeless_claim = true)
  EXECUTE FUNCTION sync_homeless_status_to_canonical();
```

#### 1.2 Migrate Existing Homeless Claims from Observations
```sql
-- One-time migration: sync all existing homeless claims to canonical
UPDATE canonical_vehicles cv
SET 
  homeless_status = CASE 
    WHEN cv.homeless_status = 'confirmed' THEN 'confirmed'
    ELSE 'claimed'
  END,
  homeless_notes = COALESCE(
    cv.homeless_notes || E'\n\n--- Migrated from observations ---\n' || string_agg(vo.homeless_claim_notes, E'\n---\n'),
    string_agg(vo.homeless_claim_notes, E'\n---\n')
  ),
  updated_at = now()
FROM vehicle_observations_v2 vo
WHERE vo.plate_number = cv.plate_number
  AND vo.has_homeless_claim = true
  AND cv.homeless_status = 'none'
GROUP BY cv.plate_number;
```

#### 1.3 Migrate Existing Homeless Status from Flagged Vehicles
```sql
-- One-time migration: sync flagged_vehicles.confirmed_homeless to canonical
UPDATE canonical_vehicles cv
SET 
  homeless_status = 'confirmed',
  updated_at = now()
FROM flagged_vehicles fv
WHERE fv.plate_number = cv.plate_number
  AND fv.confirmed_homeless = true
  AND cv.homeless_status != 'confirmed';
```

#### 1.4 Add View for Backward Compatibility (Optional)
```sql
-- Create view to maintain backward compatibility with old queries
CREATE OR REPLACE VIEW vehicle_homeless_status AS
SELECT 
  cv.plate_number,
  cv.homeless_status,
  cv.homeless_status = 'confirmed' AS homeless_confirmed,
  cv.homeless_status IN ('claimed', 'confirmed') AS homeless_claimed,
  cv.homeless_confirmed_by,
  cv.homeless_confirmed_at,
  cv.homeless_notes
FROM canonical_vehicles cv;
```

---

### Phase 2: Frontend Updates

#### 2.1 Update `VehicleDetailsPopup.tsx`

**Add homeless status badge display:**

```typescript
// Load homeless status from canonical_vehicles
const [homelessStatus, setHomelessStatus] = useState<'none' | 'claimed' | 'confirmed'>('none');
const [homelessNotes, setHomelessNotes] = useState<string>('');

// In loadVehicleDetails():
if (vehicle) {
  setHomelessStatus(vehicle.homeless_status || 'none');
  setHomelessNotes(vehicle.homeless_notes || '');
}

// Add homeless status alert badge (similar to flagged/H&S alerts)
{homelessStatus === 'confirmed' && (
  <div className="mb-4 p-4 bg-purple-50 dark:bg-purple-950/30 border-2 border-purple-500 rounded-xl">
    <div className="flex items-center gap-3">
      <Home className="h-6 w-6 text-purple-600" />
      <div>
        <p className="font-bold text-purple-900 dark:text-purple-100">
          🏠 Homeless Status: CONFIRMED
        </p>
        <p className="text-sm text-purple-700 dark:text-purple-300 mt-1">
          FC Act 2011 exemption applies • Confirmed {new Date(vehicle.homeless_confirmed_at).toLocaleDateString('en-NZ')}
        </p>
        {homelessNotes && (
          <p className="text-xs text-purple-600 dark:text-purple-400 mt-2 italic">
            "{homelessNotes}"
          </p>
        )}
      </div>
    </div>
  </div>
)}

{homelessStatus === 'claimed' && (
  <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-500 rounded-xl">
    <div className="flex items-center gap-3">
      <AlertTriangle className="h-6 w-6 text-amber-600" />
      <div>
        <p className="font-bold text-amber-900 dark:text-amber-100">
          🏠 Homeless Status: PENDING REVIEW
        </p>
        <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
          Officer reported homeless claim • Awaiting admin verification
        </p>
        {homelessNotes && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 italic">
            "{homelessNotes}"
          </p>
        )}
      </div>
    </div>
  </div>
)}
```

#### 2.2 Update `ComplianceResultModal.tsx`

**Show homeless status in compliance modal:**

```typescript
interface ComplianceResultModalProps {
  // ... existing props
  homelessStatus?: 'none' | 'claimed' | 'confirmed';
  homelessNotes?: string;
}

// In modal content:
{homelessStatus === 'confirmed' && (
  <div className="mt-4 p-4 bg-purple-100 dark:bg-purple-900/30 rounded-lg border-2 border-purple-500">
    <p className="font-bold text-purple-900 dark:text-purple-100 flex items-center gap-2">
      <Home className="h-5 w-5" />
      FC Act 2011 Exemption Active
    </p>
    <p className="text-sm text-purple-700 dark:text-purple-300 mt-1">
      This vehicle is confirmed homeless and exempt from overnight stay limits
    </p>
  </div>
)}
```

#### 2.3 Update `process-field-scan` Edge Function

**Return homeless status from canonical_vehicles:**

```typescript
// In Edge Function response:
const canonicalVehicle = await supabaseAdmin
  .from('canonical_vehicles')
  .select('homeless_status, homeless_notes, homeless_confirmed_at, homeless_confirmed_by')
  .eq('plate_number', plateNumber)
  .single();

return new Response(
  JSON.stringify({
    // ... existing response
    homelessStatus: canonicalVehicle?.data?.homeless_status || 'none',
    homelessNotes: canonicalVehicle?.data?.homeless_notes,
    homelessConfirmedAt: canonicalVehicle?.data?.homeless_confirmed_at,
  }),
  { headers: corsHeaders }
);
```

#### 2.4 Update `PlateCapture.tsx`

**Pass homeless status to VehicleDetailsPopup:**

```typescript
const [currentVehicleDetails, setCurrentVehicleDetails] = useState({
  // ... existing fields
  homelessStatus: 'none' as 'none' | 'claimed' | 'confirmed',
  homelessNotes: '',
});

// In processImageUnified() or after scan:
setCurrentVehicleDetails({
  // ... existing fields
  homelessStatus: scanResult.homelessStatus || 'none',
  homelessNotes: scanResult.homelessNotes || '',
});

// Pass to VehicleDetailsPopup:
<VehicleDetailsPopup
  // ... existing props
  homelessStatus={currentVehicleDetails.homelessStatus}
  homelessNotes={currentVehicleDetails.homelessNotes}
/>
```

---

### Phase 3: Admin Interface Updates

#### 3.1 Update `HomelessSupport.tsx`

**Query canonical_vehicles instead of vehicle_records:**

```typescript
// Replace vehicle_records query with:
const { data: vehicles } = await supabase
  .from('canonical_vehicles')
  .select(`
    plate_number,
    vehicle_make,
    vehicle_model,
    vehicle_color,
    homeless_status,
    homeless_notes,
    homeless_confirmed_by,
    homeless_confirmed_at,
    user_profiles:homeless_confirmed_by (first_name, last_name)
  `)
  .in('homeless_status', ['claimed', 'confirmed'])
  .order('homeless_confirmed_at', { ascending: false });
```

#### 3.2 Update `UrgentFollowUps.tsx`

**Show homeless claims from canonical_vehicles:**

```typescript
const { data: homelessClaims } = await supabase
  .from('canonical_vehicles')
  .select(`
    plate_number,
    vehicle_make,
    vehicle_model,
    homeless_notes,
    total_observations,
    last_seen_at
  `)
  .eq('homeless_status', 'claimed')
  .order('last_seen_at', { ascending: false });
```

---

### Phase 4: Cleanup (Optional - After Verification)

**Once consolidation is verified working:**

1. **Deprecate redundant fields** (but keep for audit trail):
   - Mark `vehicle_records.homeless_*` fields as deprecated in docs
   - Mark `vehicle_observations_v2.has_homeless_claim` as deprecated
   - Mark `flagged_vehicles.confirmed_homeless` as deprecated

2. **Add database comments**:
```sql
COMMENT ON COLUMN canonical_vehicles.homeless_status IS 'Single source of truth for homeless status (none/claimed/confirmed)';
COMMENT ON COLUMN vehicle_records.homeless_confirmed IS 'DEPRECATED - Use canonical_vehicles.homeless_status instead';
COMMENT ON COLUMN flagged_vehicles.confirmed_homeless IS 'DEPRECATED - Use canonical_vehicles.homeless_status instead';
```

---

## Benefits of Consolidation

✅ **Single Source of Truth** - No more sync issues or conflicting data  
✅ **Better UX** - Officers see homeless status immediately in scan popup  
✅ **Compliance Exemption** - Automatic FC Act 2011 exemption when confirmed  
✅ **Audit Trail** - Full history tracked in canonical_vehicles  
✅ **Admin Efficiency** - One place to manage all homeless vehicles  
✅ **Data Integrity** - Triggers ensure automatic sync from observations  

---

## Migration Checklist

- [ ] Phase 1: Run database migration SQL
- [ ] Phase 1: Verify triggers working correctly
- [ ] Phase 2: Update VehicleDetailsPopup with homeless badges
- [ ] Phase 2: Update ComplianceResultModal
- [ ] Phase 2: Update process-field-scan Edge Function
- [ ] Phase 2: Update PlateCapture to pass homeless status
- [ ] Phase 3: Update HomelessSupport admin page
- [ ] Phase 3: Update UrgentFollowUps admin page
- [ ] Phase 4: Test end-to-end workflow
- [ ] Phase 4: Verify compliance exemption applies correctly
- [ ] Phase 4: Add deprecation notices (optional)

---

## Example User Experience (After Consolidation)

**Scenario: Officer scans a homeless vehicle**

1. **Plate scan** → `process-field-scan` runs
2. **Query canonical_vehicles** → Returns `homeless_status = 'confirmed'`
3. **VehicleDetailsPopup shows**:
   - 🏠 Purple "HOMELESS STATUS: CONFIRMED" badge
   - "FC Act 2011 exemption applies"
   - Homeless notes from admin review
   - Prior observations count
4. **Officer clicks Check** → `ComplianceResultModal` shows:
   - ✅ Compliant (even if overstaying)
   - 🏠 "FC Act 2011 Exemption Active" notice
   - No breach warnings
5. **Continue scanning** → Workflow uninterrupted

**Admin confirms homeless claim:**
1. **Admin opens HomelessSupport** → Sees "claimed" vehicles
2. **Admin clicks Confirm** → Updates `canonical_vehicles.homeless_status = 'confirmed'`
3. **Next scan by officer** → Automatically shows confirmed status
4. **Compliance engine** → Automatically applies exemption

**Result:** Seamless, real-time sync with zero manual intervention
