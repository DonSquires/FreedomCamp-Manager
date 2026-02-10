# COMPLIANCE REQUIREMENTS - SINGLE SOURCE OF TRUTH VERIFICATION

## ✅ Complete List of Compliance Checks

This document verifies that ALL compliance requirements from the entire chat history are implemented in the **`calculate_vehicle_compliance()`** database function.

---

## 1. ✅ DAY-VISIT-ONLY ZONES (HIGHEST PRIORITY)
**Requirement:** Zones marked as `day_visit_only = true` **PROHIBIT** overnight parking entirely.

**Check in Function:**
```sql
if v_zone.day_visit_only and v_stay.total_records_in_zone > 0 then
  v_is_compliant := false;
  v_violation_type := 'overnight_in_day_only_zone';
  v_violation_severity := 'critical';
  v_violation_message := format(
    'CRITICAL BREACH: Vehicle parked overnight in DAY-VISIT-ONLY zone (%s). Overnight parking strictly prohibited.',
    v_zone.name
  );
  v_fine_amount := 400;
```

**Status:** ✅ **IMPLEMENTED**

---

## 2. ✅ MONTHLY LIMIT (CALENDAR MONTH-BASED)
**Requirement:** Vehicle can stay maximum `nights_per_month` nights within a **calendar month** (February = 28 days, May = 31 days, etc.).

**Check in Function:**
```sql
elsif v_stay.current_month_nights > v_zone.nights_per_month then
  v_is_compliant := false;
  v_violation_type := 'monthly_limit_exceeded';
  v_violation_severity := 'critical';
  v_violation_message := format(
    'MONTHLY LIMIT BREACH: Vehicle has stayed %s nights in %s (max: %s nights per month). Exceeds zone rules.',
    v_stay.current_month_nights,
    to_char(p_check_date, 'Month YYYY'),
    v_zone.nights_per_month
  );
```

**Calculation:**
```sql
v_current_month_start := date_trunc('month', p_check_date)::date;

select 
  coalesce(array_length(array_agg(distinct recorded_at::date), 1), 0),
  coalesce(array_agg(distinct recorded_at::date order by recorded_at::date), array[]::date[])
into 
  v_current_month_nights,
  v_current_month_dates
from public.vehicle_records
where plate_number = upper(p_plate_number)
  and zone_id = p_zone_id
  and recorded_at::date >= v_current_month_start
  and recorded_at::date < (v_current_month_start + interval '1 month')::date;
```

**Status:** ✅ **IMPLEMENTED** - Correctly uses calendar month boundaries

---

## 3. ✅ CONSECUTIVE NIGHTS LIMIT
**Requirement:** Vehicle can stay maximum `max_consecutive_nights` nights **in a row**. Must leave for at least 1 night to reset.

**Check in Function:**
```sql
elsif v_stay.consecutive_nights > v_zone.max_consecutive_nights then
  v_is_compliant := false;
  v_violation_type := 'consecutive_nights_exceeded';
  v_violation_severity := 'critical';
  v_violation_message := format(
    'CONSECUTIVE NIGHTS BREACH: Vehicle has stayed %s consecutive nights (max: %s). Must leave zone for at least 1 night.',
    v_stay.consecutive_nights,
    v_zone.max_consecutive_nights
  );
```

**Calculation:**
```sql
-- Calculate consecutive nights using date array
for i in 2..array_length(v_unique_dates, 1) loop
  -- Check if dates are consecutive (1 day apart)
  if v_unique_dates[i] - v_unique_dates[i-1] = 1 then
    v_current_streak := v_current_streak + 1;
    v_streak_end := v_unique_dates[i];
    
    if v_current_streak > v_max_consecutive then
      v_max_consecutive := v_current_streak;
      v_consecutive_start := v_streak_start;
      v_consecutive_end := v_streak_end;
    end if;
  else
    -- Streak broken, start new streak
    v_current_streak := 1;
    v_streak_start := v_unique_dates[i];
    v_streak_end := v_unique_dates[i];
  end if;
end loop;
```

**Status:** ✅ **IMPLEMENTED**

---

## 4. ✅ AT CONSECUTIVE/MONTHLY LIMIT (WARNINGS)
**Requirement:** When vehicle is **AT** the maximum but hasn't exceeded yet, show warning.

**Check in Function:**
```sql
-- At consecutive limit
elsif v_stay.consecutive_nights = v_zone.max_consecutive_nights and v_stay.is_currently_present then
  v_is_compliant := true; -- Still compliant but at limit
  v_violation_type := 'at_consecutive_limit';
  v_violation_severity := 'warning';

-- At monthly limit
elsif v_stay.current_month_nights = v_zone.nights_per_month and v_stay.is_currently_present then
  v_is_compliant := true;
  v_violation_type := 'at_monthly_limit';
  v_violation_severity := 'warning';
```

**Status:** ✅ **IMPLEMENTED**

---

## 5. ✅ SELF-CONTAINED REQUIREMENT
**Requirement:** Zones marked `self_contained_required = true` require vehicles to have self-contained certification (green/blue sticker).

**Check in Function:**
```sql
elsif v_zone.self_contained_required and not coalesce(v_latest_record.is_self_contained, false) then
  v_is_compliant := false;
  v_violation_type := 'not_self_contained';
  v_violation_severity := 'moderate';
  v_violation_message := format(
    'NON-COMPLIANT: Vehicle is not self-contained but zone (%s) requires self-contained certification.',
    v_zone.name
  );
  v_fine_amount := 200;
```

**Status:** ✅ **IMPLEMENTED**

---

## 6. ✅ APPROACHING LIMITS (ADVISORIES)
**Requirement:** When vehicle is **close to** limits, show advisory warnings.

**Check in Function:**
```sql
-- Approaching consecutive limit (1 night away)
elsif v_stay.consecutive_nights >= (v_zone.max_consecutive_nights - 1) and v_stay.is_currently_present then
  v_is_compliant := true;
  v_violation_type := 'approaching_consecutive_limit';
  v_violation_severity := 'advisory';

-- Approaching monthly limit (2 nights away)
elsif v_stay.current_month_nights >= (v_zone.nights_per_month - 2) and v_stay.is_currently_present then
  v_is_compliant := true;
  v_violation_type := 'approaching_monthly_limit';
  v_violation_severity := 'advisory';
```

**Status:** ✅ **IMPLEMENTED**

---

## 7. ✅ CURRENTLY PRESENT CHECK
**Requirement:** Some warnings only apply if vehicle is **currently present** (seen within last 24 hours).

**Check in Function:**
```sql
-- Check if vehicle is currently present (seen within last 24 hours)
if v_last_seen is not null then
  is_currently_present := (v_last_seen >= (now() - interval '24 hours'));
else
  is_currently_present := false;
end if;
```

**Status:** ✅ **IMPLEMENTED**

---

## 8. ⚠️ GPS LOCATION VIOLATIONS (NOT IN CENTRALIZED FUNCTION)
**Requirement:** If vehicle remains in same GPS location for >24 hours, check compliance.

**Current Implementation:** This is checked **separately** in `EvidenceCollection.tsx` via `checkLocationViolations()` function.

**Status:** ⚠️ **PARTIALLY IMPLEMENTED** - Not in centralized function, handled in UI

---

## 9. ⚠️ TIME-BASED COMPLIANCE (NOT IN CENTRALIZED FUNCTION)
**Requirement:** Recording time determines overnight stay (9pm-5am NZ time = overnight).

**Current Implementation:** This is checked in `EvidenceCollection.tsx` via `checkTimeBasedCompliance()` function.

**Status:** ⚠️ **PARTIALLY IMPLEMENTED** - Not in centralized function, handled in UI

---

## 10. ✅ HOMELESS STATUS TRACKING
**Requirement:** Track claimed vs confirmed homeless status.

**Database Fields:**
- `homeless_claimed` - User/vehicle claims homeless status
- `homeless_confirmed` - Admin confirms after review
- `homeless_confirmed_by` - Which admin confirmed
- `homeless_confirmed_at` - When confirmed

**Status:** ✅ **IMPLEMENTED** - Fields exist, tracking in place

---

## 11. ✅ FINE AMOUNTS
**Requirement:** Different violations have different fine amounts.

**Implemented Fines:**
- Day-visit-only violation: **$400**
- Monthly limit exceeded: **$400**
- Consecutive nights exceeded: **$400**
- Not self-contained: **$200**
- Warnings/advisories: **$0**

**Status:** ✅ **IMPLEMENTED**

---

## 12. ✅ RECOMMENDED ACTIONS
**Requirement:** Each violation type has recommended enforcement action.

**Examples:**
- "Immediate tow notice or $400 fine"
- "Issue $400 fine and require vehicle to leave zone until next month"
- "Advise owner they must leave tomorrow or face $400 fine"

**Status:** ✅ **IMPLEMENTED**

---

## PRIORITY ORDER OF CHECKS (CRITICAL)

The function checks violations in **strict priority order**:

1. **Day-visit-only** (highest priority)
2. **Monthly limit exceeded**
3. **Consecutive nights exceeded**
4. **At consecutive limit** (warning)
5. **At monthly limit** (warning)
6. **Self-contained requirement**
7. **Approaching consecutive limit** (advisory)
8. **Approaching monthly limit** (advisory)

**Status:** ✅ **IMPLEMENTED**

---

## WHAT'S MISSING / NEEDS FIXING

### ❌ Issue 1: GPS Location Violations Not Centralized
**Problem:** `checkLocationViolations()` in `EvidenceCollection.tsx` is separate from the centralized function.

**Solution:** Should either:
1. Move GPS violation logic into `calculate_vehicle_compliance()` function
2. OR create a separate `calculate_gps_violations()` function
3. OR keep as client-side check but ensure it updates `vehicle_records.is_compliant`

### ❌ Issue 2: Time-Based Compliance Not Centralized
**Problem:** `checkTimeBasedCompliance()` checks recording time but doesn't update compliance status.

**Solution:** Should update `vehicle_records.is_compliant` based on time checks.

### ❌ Issue 3: vehicle_records.is_compliant Column Not Auto-Updated
**Problem:** The `is_compliant` column is only updated when:
1. Evidence is submitted
2. Manual recalculation is triggered

**Solution:** Consider adding a database trigger to recalculate compliance when records are inserted/updated.

### ❌ Issue 4: Reports Reading Stored Values
**Problem:** Dashboard and reports read `vehicle_records.is_compliant` which may be outdated.

**Solution:** Either:
1. Always call `calculate_vehicle_compliance()` function for reports
2. OR ensure `is_compliant` is always up-to-date via triggers
3. OR run nightly recalculation job

---

## NEXT STEPS TO FIX REPORTS

1. **Trigger recalculation** using the new "Recalculate All Compliance" button
2. **Verify breach counts** match actual violations
3. **Check homeless counts** are correct
4. **Review each zone's** compliance rate
5. **Add database trigger** to auto-update compliance on record changes

---

## HOW TO TEST

1. Go to **Compliance Dashboard**
2. Click **"Recalculate All Compliance"** button
3. Wait for completion (should show summary)
4. Refresh dashboard to see updated counts
5. Verify:
   - Breach count > 0 if there are violations
   - Compliance rate < 100% if there are violations
   - Homeless counts match database records
   - Zone-by-zone rates are accurate

---

**CONCLUSION:** The centralized compliance function `calculate_vehicle_compliance()` **correctly implements all core compliance requirements**, but the `is_compliant` column in the database is **outdated**. Running the recalculation will fix the reports.
