# ALPR Vehicle Attribute Integration Testing Checklist

This checklist verifies that Plate Recognizer (ALPR) vehicle attributes (make, model, color, orientation) are correctly integrated into the FreedomCamp system when Railway inference fails to detect a plate.

## Overview

**When ALPR Triggers**: If the Railway inference service fails to detect a plate in the photo, the system automatically calls the Plate Recognizer API (ALPR) as a fallback.

**What's Being Tested**: 
- ALPR correctly extracts make/model/color/orientation from the number plate image
- These attributes flow into the observation record
- Source attribution correctly shows "Plate Recognizer" for these fields
- No data integrity issues occur when ALPR is the sole source

---

## Pre-Test Setup

### ✅ Prerequisites

- [ ] **Supabase Edge Functions deployed**: Latest `process-officer-scan` function live (commit 29280e3 or later)
- [ ] **migrations/20260417000001_add_vehicle_attribute_sources.sql applied**: Column exists in observations table
  ```sql
  SELECT vehicle_attribute_sources FROM observations LIMIT 1;
  ```
  Should NOT return "column does not exist" error.
- [ ] **Plate Recognizer API key active**: Check in Railway env → `PLATE_RECOGNIZER_API_KEY` is set
- [ ] **Field portal running**: Dev server or production deployment accessible
- [ ] **Test vehicle with clear, readable plate**: Insurance/temp plate preferred (less PII risk)

### Database Check

Run this in Supabase SQL editor to verify schema:

```sql
-- Verify observations table has new column
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'observations' 
  AND column_name IN ('vehicle_attribute_sources', 'vehicle_make', 'vehicle_model', 'vehicle_color');

-- Expected output:
-- vehicle_attribute_sources | jsonb
-- vehicle_make              | character varying
-- vehicle_model             | character varying
-- vehicle_color             | character varying
```

---

## Test Scenario: Force ALPR Fallback

**Goal**: Capture a photo that causes Railway inference to fail, forcing ALPR backup to trigger.

### Method 1: High-Glare / Oblique Angle Photo

1. Find a parked vehicle with a **readable number plate** but:
   - Photo taken at **extreme angle** (>45°) to hide vehicle body
   - Strong **lens glare** over windshield/body
   - Only plate clearly visible

2. In field portal, tap **"DETAIL SCAN"** (camera icon)

3. Open frame and carefully compose shot so:
   - [ ] Number plate is **sharp and centered**
   - [ ] Vehicle body is **blurred or angled away**
   - [ ] No vehicle type/color visible (should cause inference to fail)

4. Tap capture

### Method 2: Partially Obscured Vehicle Body

1. Park behind vehicle and capture:
   - [ ] Front number plate clearly visible
   - [ ] Only rear bumper/license plate area in frame
   - [ ] No visible engine hood, windshield, or roof (minimal vehicle context)

2. Alternatively, use a vehicle that's **parked in shadow** so:
   - [ ] Plate is visible
   - [ ] Body is too dark to detect clearly

3. Tap capture

### Method 3: Extreme Distance Shot

1. Capture plate from **40+ meters away** (e.g., from across parking lot)
2. Vehicle body will be too small to detect
3. Plate should still be readable (if not, invalid test)

---

## Expected Behavior After Capture

### Phase 1: Photo Upload (10 seconds)

- [ ] **Panel opens**: Shows thumbnail, "Detecting…" badge
- [ ] **No errors**: Toast notification should be ✅ green, status "capturing…"

### Phase 2: Railway Inference (5-15 seconds)

- [ ] **Plate detection attempted**: Logs show `Inference result: plate=null or plate=<detected>`
  - If Railway **succeeds** (plate found): ALPR won't trigger; test inconclusive
  - If Railway **fails** (no plate): Continue to Phase 3

### Phase 3: ALPR Fallback (3-5 seconds)

Watch Supabase function logs (`Dashboard → Functions → process-officer-scan → Logs`):

```
🔄 No plate from inference — running ALPR backup...
✅ ALPR backup found plate: ABC123 {
  duration_ms: 2340,
  make: "Toyota",
  model: "Camper",
  colour: "White",
  orientation: "0°"
}
```

**Verify**:
- [ ] Log shows `ALPR backup found plate`
- [ ] `make` field is populated (not null)
- [ ] `model` field is populated (not null)
- [ ] `colour` field is populated (not null)
- [ ] `duration_ms` is < 5000 (should be 1-3 sec for Plate Recognizer)

### Phase 4: UI Display (0-2 seconds)

Wait for panel to show "✅ Compliant" or "🚨 Breach" badge (processing complete).

**Check vehicle detail row**:

```
Make: Toyota    [Plate Recognizer]
Model: Camper   [Plate Recognizer]
Year: —
Color: White    [Plate Recognizer]
```

Expected:
- [ ] **Make** field shows vehicle make (e.g., "Toyota")
- [ ] **Model** field shows vehicle model (e.g., "Camper", "Hiace")
- [ ] **Color** field shows color (e.g., "White", "Silver")
- [ ] **Year** shows "—" (ALPR doesn't provide year; no other source available)
- [ ] **Badges show source**: "Plate Recognizer" (light blue) for make/model/color

---

## Validation Tests

### ✅ Test 1: Attributes Correctly Flow to Database

After test vehicle capture completes:

```sql
SELECT 
  plate_number,
  vehicle_make,
  vehicle_model,
  vehicle_color,
  vehicle_attribute_sources
FROM observations
WHERE plate_number = 'ABC123'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected output**:
```
plate_number          | ABC123
vehicle_make          | Toyota
vehicle_model         | Camper
vehicle_color         | White
vehicle_attribute_sources | {
                      |   "make_source": "alpr",
                      |   "model_source": "alpr",
                      |   "color_source": "alpr",
                      |   "year_source": null
                      | }
```

**Verify**:
- [ ] `vehicle_make` is NOT NULL
- [ ] `vehicle_model` is NOT NULL
- [ ] `vehicle_color` is NOT NULL
- [ ] `vehicle_attribute_sources` JSON correctly shows `"alpr"` for all three
- [ ] `year_source` is null (ALPR can't detect year)

### ✅ Test 2: Source Priority Respected (ALPR ≠ Override)

**Scenario**: NZSCV registry has "Honda Civic" on file, but ALPR detects "Toyota Camper".

Expected behavior: **NZSCV wins, Camper is NOT stored** (ALPR should be ignored, not override).

1. Find a vehicle registered in NZ vehicle registry as "Honda Civic"
2. Modify ALPR to return wrong model (manual edit for test)
3. Capture with ALPR fallback active
4. Verify in database:
   ```sql
   SELECT vehicle_make, vehicle_model FROM observations 
   WHERE plate_number = 'ABC123';
   ```
   Should show "Honda Civic", NOT the ALPR-detected model.

**Context**: This test validates the source priority chain works. If available, skip if ALPR result aligns with NZSCV.

### ✅ Test 3: No Data Corruption

**Check discrepancy flags** - if ALPR attributes differ from NZSCV, system should NOT flag mismatches for mere differences:

```sql
SELECT 
  plate_number,
  has_discrepancies,
  discrepancy_flags
FROM observations
WHERE plate_number = 'ABC123'
ORDER BY created_at DESC
LIMIT 1;
```

Expected:
- [ ] `has_discrepancies` is FALSE (ALPR fallback should not create false alarms)
- [ ] `discrepancy_flags` is NULL or empty (ALPR is only used as fallback, not cross-checked)

### ✅ Test 4: Multiple ALPR Scans

Capture **3-5 different vehicles** using ALPR fallback:

- [ ] All plates correctly captured
- [ ] All make/model/color correctly extracted
- [ ] No failed records in observations table
- [ ] All have `vehicle_attribute_sources` JSON populated correctly
- [ ] Response times all < 5 seconds

---

## Edge Cases to Test

### Edge Case 1: Plate Recognizer API Down

**Simulate by**: Temporarily disabling ALPR API key in Railway.

Expected:
- [ ] **No crash**: Function returns gracefully
- [ ] **No hang**: Returns within 30 seconds
- [ ] **Observation created**: Record saved even without ALPR
- [ ] **Manual entry required**: Plate shows "MANUAL_REQUIRED"

Check logs:
```
⚠️ ALPR backup failed: API error 503
Plate remains undetected; officer must enter manually
```

### Edge Case 2: Extremely Poor Image Quality

Capture with:
- [ ] Heavily blurred number plate
- [ ] Overexposed white plate image
- [ ] Plate at 80+ degree angle

Expected:
- [ ] ALPR API responds with low confidence or null
- [ ] System gracefully falls back to manual entry
- [ ] **No crashes or 500 errors**

### Edge Case 3: Non-NZ Plate Format

If system receives foreign plate (e.g., Australian):

Expected:
- [ ] ALPR extracts data anyway (Plate Recognizer works globally)
- [ ] System processes without errors
- [ ] Attributes stored normally
- [ ] No conflict with NZ-specific validation

---

## Sign-Off Checklist

### Development Team

- [ ] All validation tests passed
- [ ] No SQL errors in logs
- [ ] No edge cases causing crashes
- [ ] Response times acceptable (<5 sec)
- [ ] Source attribution badges display correctly in UI

### QA / Testing

- [ ] 5+ different vehicles tested
- [ ] At least 1 ALPR-only scenario (no NZSCV match)
- [ ] At least 1 source-conflict scenario (ALPR ≠ NZSCV, NZSCV wins)
- [ ] Edge cases tested (API down, poor image, foreign plate)
- [ ] Field officers confirm UI is clear and intuitive

### Business Acceptance

- [ ] Attributes improve officer confidence in vehicle ID
- [ ] Source labels help officers understand data origin
- [ ] No additional manual verification required for ALPR attributes
- [ ] System is production-ready

---

## Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| Plate still shows "Detecting…" after 30 sec | ALPR timeout or API down | Check Railway logs, verify API key, restart service |
| Attributes show null in UI but data in DB | UI not polling for updates | Refresh browser, check console errors, run `bun run build` |
| Source badge shows "Unknown" instead of "Plate Recognizer" | Migration not deployed | Run `20260417000001_add_vehicle_attribute_sources.sql` in Supabase |
| ALPR overriding NZSCV data | Source priority broken | Check process-officer-scan logic, redeploy function |
| ALPR attributes missing color/make/model | Plate Recognizer API returned sparse data | Verify image quality, test with higher-quality photo |

---

## Success Criteria

✅ **All criteria met = ALPR integration verified**

1. [ ] Attributes flow from Plate Recognizer to observations
2. [ ] Source attribution correctly shows "Plate Recognizer" in UI
3. [ ] No data corruption or discrepancy false alarms
4. [ ] Source priority chain works (ALPR doesn't override NZSCV)
5. [ ] UI displays sources clearly and intuitively
6. [ ] Edge cases handled gracefully
7. [ ] Response times < 5 seconds

---

## Related Documentation

- [AI Attribute Inference Setup](./AI_ATTRIBUTE_INFERENCE_SETUP.md) — Configure OpenAI GPT-4o for vehicle attributes
- [Source Attribution Architecture](./SOURCE_ATTRIBUTION_ARCHITECTURE.md) — Technical details on data flow
- [Field Officer Portal](./FIELD_OFFICER_PORTAL_COMPLETE_SYSTEM_MAP.md) — Full UI reference

---

**Test Status**: ⏳ Pending (Ready to execute)  
**Last Updated**: 2026-03-17  
**Tested By**: (fill in your name after testing)
