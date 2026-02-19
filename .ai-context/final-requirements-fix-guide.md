# Final Requirements & KPI Fix Guide

## What Was Fixed

### Problem 1: Zone Requirements Not Showing
- **Symptom**: Observation cards showed "No details available" instead of requirement reasons
- **Root Cause**: Function existed but permissions not granted / RPC call failing silently
- **Fix**: Granted EXECUTE permission + added diagnostic tool

### Problem 2: KPI Cohorts Using Wrong Source
- **Symptom**: Overstayers/Homeless tiles show 0 while Breaches shows 12
- **Root Cause**: Earlier cohort RPCs used `canonical_vehicles.homeless_status` instead of `compliance_results.is_homeless_exempt`
- **Fix**: Rewrote cohort RPCs to INNER JOIN compliance_results and check is_homeless_exempt flag

## What Changed

### SQL Functions
1. **cohort_overstayers()** - Now uses `compliance_results.is_homeless_exempt = false`
2. **cohort_homeless_exempt()** - Now uses `compliance_results.is_homeless_exempt = true`
3. **cohort_compliant()** - Unchanged (uses observation.is_compliant)
4. **cohort_all_breaches()** - Unchanged (uses observation.is_breach)
5. **evaluate_observation_requirements()** - Permissions granted
6. **check_requirements_health()** - NEW diagnostic tool

### Frontend
- No changes needed (already calling correct RPCs)
- ZoneRequirementsChecklist.tsx already correct
- ObservationsReport.tsx already using cohort RPCs for KPI filters

## Verification Steps

### 1. Run Diagnostic
```sql
-- Quick health check
SELECT * FROM check_requirements_health();

-- Expected output:
-- test_name              | status    | details
-- -----------------------|-----------|----------------------------------
-- Sample Observation     | ✅ PASS   | Found observation: <uuid>
-- Requirements Function  | ✅ PASS   | 3 requirements with non-NULL reasons
-- RLS Permissions        | ✅ PASS   | Function is SECURITY DEFINER, permissions OK
```

### 2. Test Requirements Function Directly
```sql
-- Replace <obs-id> with a real observation UUID from your list
SELECT * 
FROM evaluate_observation_requirements('<obs-id>')
ORDER BY sort_order;

-- Expected: 3 rows with non-NULL reasons:
-- observation_id | requirement_code | requirement_label              | status         | reason                                          | sort_order
-- ---------------|------------------|--------------------------------|----------------|-------------------------------------------------|-----------
-- <uuid>         | csc_required     | Self-contained vehicle required| breach         | CSC required by zone bylaw; no current cert...  | 10
-- <uuid>         | max_nights       | Maximum consecutive nights     | yes            | 2/3 consecutive nights (compliant)              | 20
-- <uuid>         | monthly_limit    | Monthly stays limit            | breach_exempt  | 32/28 nights; homeless exemption applies        | 30
```

### 3. Test KPI Cohorts
```sql
-- Overstayers (should exclude homeless-exempt)
SELECT count(*) FROM cohort_overstayers(
  '2026-02-17T00:00:00+13',
  '2026-02-17T23:59:59+13',
  NULL, NULL
);

-- Homeless exempt (should only include homeless breaches)
SELECT count(*) FROM cohort_homeless_exempt(
  '2026-02-17T00:00:00+13',
  '2026-02-17T23:59:59+13',
  NULL, NULL
);

-- All breaches (sum should equal overstayers + homeless_exempt)
SELECT count(*) FROM cohort_all_breaches(
  '2026-02-17T00:00:00+13',
  '2026-02-17T23:59:59+13',
  NULL, NULL
);
```

### 4. Test in UI
1. Open **Observations Report**
2. Set date: 17/02/2026 to 17/02/2026
3. No KPI filter selected - should show all observations
4. Expand any observation card
5. **Zone Requirements** section should show:
   - ✅ Color-coded badges (green/amber/red/purple)
   - ✅ Requirement labels (Self-contained vehicle required, Max consecutive nights, etc.)
   - ✅ Detailed reason text (not "No details available")

6. Click **Unified Dashboard**
7. **Overstayers** tile shows non-zero count (e.g., 8)
8. Click Overstayers tile → drill-down shows **same count** in report
9. **Homeless (Exempt)** tile shows non-zero count (e.g., 4)
10. Click Homeless tile → drill-down shows **same count** in report
11. Overstayers + Homeless ≈ All Breaches

## Troubleshooting

### Zone Requirements Still Not Showing

**Check 1: Is the function being called?**
```javascript
// Open browser DevTools → Network
// Expand an observation card
// Look for: POST /rest/v1/rpc/evaluate_observation_requirements
// Status should be 200
// Response should have data array with 3 items
```

**Check 2: Are permissions granted?**
```sql
-- Should return 't'
SELECT has_function_privilege('authenticated', 'evaluate_observation_requirements(uuid)', 'EXECUTE');
```

**Check 3: Does the observation have canonical data?**
```sql
-- Replace <plate> with observation's plate_number
SELECT plate_number, vehicle_make, homeless_status, nzscv_warrant_type
FROM canonical_vehicles
WHERE plate_number = '<plate>';

-- If NULL, the observation won't have zone rules to evaluate
```

### KPI Tiles Show 0

**Check 1: Does observation have compliance_results row?**
```sql
-- Replace <obs-id> with observation UUID
SELECT observation_id, is_breach, is_homeless_exempt, analytics_only
FROM compliance_results
WHERE observation_id = '<obs-id>';

-- If NULL, run backfill:
SELECT * FROM backfill_all_compliance_from_dec_2025(1000);
```

**Check 2: Is timezone conversion correct?**
```typescript
// Dashboard and Report should both use:
const utcFrom = zonedTimeToUtc(startOfDay(nzDate), 'Pacific/Auckland');
const utcTo = zonedTimeToUtc(endOfDay(nzDate), 'Pacific/Auckland');

// Check formatted values:
console.log('UTC range:', utcFrom, utcTo);
// Should be: 2026-02-17T00:00:00+13:00 to 2026-02-17T23:59:59+13:00
```

**Check 3: Are org/zone filters carried through URL?**
```javascript
// When clicking KPI tile, URL should be:
/reports/observations?from=2026-02-17&to=2026-02-17&org=ALL&kpi=overstayers

// Report should parse these and pass to RPC
```

## Performance Notes

- **compliance_results index** created for fast breach filtering
- **cohort RPCs** use INNER JOIN (fast with index)
- **evaluate_observation_requirements** runs per-observation (3 queries total)
- For bulk loads (1000+ observations), consider pagination

## Next Steps (Optional)

1. **Materialized View** for requirements (if 10k+ observations per load)
2. **Scheduled Refresh** for compliance_results (nightly recalculation)
3. **Audit Trail** for requirement status changes over time
4. **PDF Export** with requirements checklist embedded in court packs
