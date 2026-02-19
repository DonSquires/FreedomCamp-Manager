# RPC 404 Fix Guide

## What Was Wrong

### Symptom
- Browser DevTools Network tab shows: `404 Not Found` for `/rest/v1/rpc/cohort_overstayers`
- Dashboard KPI tiles show **0** for Overstayers and Homeless (Exempt)
- Drill-down reports return **empty arrays**

### Root Cause
PostgREST (Supabase's REST API layer) couldn't find functions named:
- `cohort_overstayers`
- `cohort_homeless_exempt`
- `evaluate_observation_requirements`

This happened because recent migrations created functions with `_recalc` suffix, but UI was still calling the original names.

## What Was Fixed

Created **public wrapper functions** with the exact names the UI expects:
- `public.cohort_overstayers()` → delegates to `cohort_overstayers_recalc()`
- `public.cohort_homeless_exempt()` → delegates to `cohort_homeless_exempt_recalc()`
- `public.cohort_compliant()` → delegates to `cohort_compliant_recalc()`
- `public.cohort_all_breaches()` → unions overstayers + homeless_exempt
- `public.evaluate_observation_requirements()` → delegates to `_recalc` version

## Verification Steps

### 1. SQL Verification (Run in Supabase SQL Editor)

```sql
-- Check functions are visible and executable
SELECT 
  n.nspname as schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as executable
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'cohort_overstayers',
    'cohort_homeless_exempt',
    'cohort_compliant',
    'cohort_all_breaches',
    'evaluate_observation_requirements'
  )
ORDER BY p.proname;

-- Expected: 5 rows, all with executable = true
```

### 2. Browser DevTools Test

Open browser console on your app page and run:

```javascript
// Test overstayers RPC
const { data: overstayers, error: err1 } = await supabase.rpc('cohort_overstayers', {
  p_from: '2026-02-17T00:00:00+13:00',
  p_to: '2026-02-17T23:59:59+13:00',
  p_org_id: null,
  p_zone_id: null
});

console.log('✅ Overstayers:', overstayers?.length, overstayers);
console.log('❌ Error:', err1);

// Should see:
// ✅ Overstayers: 8 [{ observation_id: "..." }, ...]
// ❌ Error: null

// NOT:
// ❌ Error: { message: "404 Not Found" }
```

### 3. Network Tab Test

1. Open browser DevTools → Network tab
2. Navigate to **Unified Dashboard**
3. Set date: 17/02/2026 to 17/02/2026
4. Watch Network requests
5. Should see: `POST /rest/v1/rpc/cohort_overstayers` → **200 OK**
6. Response body should have `[{ observation_id: "..." }, ...]`

### 4. UI Tile Test

1. **Unified Dashboard**
2. Set date: 17/02/2026 to 17/02/2026
3. **Overstayers** tile shows non-zero count (e.g., 8)
4. **Homeless (Exempt)** tile shows non-zero count (e.g., 4)
5. **All Breaches** = Overstayers + Homeless (e.g., 12)

### 5. Drill-Down Test

1. Click **Overstayers** tile
2. Should navigate to `/reports/observations?from=2026-02-17&to=2026-02-17&kpi=overstayers`
3. Report shows **same count** as tile (e.g., 8)
4. Expanding any observation shows **Zone Requirements** with colored badges

## Troubleshooting

### Still Getting 404?

**Check 1: Function schema**
```sql
-- Make sure functions are in 'public' schema, not 'auth' or other
SELECT nspname, proname 
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE proname ILIKE 'cohort%';

-- If they're in wrong schema, drop and recreate in public
```

**Check 2: Function name case**
```sql
-- PostgREST is case-sensitive for quoted identifiers
-- Make sure functions are lowercase unquoted
SELECT proname 
FROM pg_proc 
WHERE proname ILIKE 'cohort_overstayers';

-- Should return: cohort_overstayers (not "Cohort_Overstayers")
```

**Check 3: API schema setting**
```sql
-- Check if Supabase is exposing 'public' schema
-- (This is default, but verify in Supabase Dashboard → API Settings)
```

### Tiles Still Show 0?

**Check 1: Recompute views have data**
```sql
-- Test base views
SELECT COUNT(*) FROM v_obs_base;
SELECT COUNT(*) FROM v_runs;
SELECT COUNT(*) FROM v_monthly_stays;

-- If 0, the views are filtering too aggressively
-- Check recorded_at >= '2025-12-01' filter
```

**Check 2: Homeless flag is set**
```sql
-- Check if canonical_vehicles.homeless_status is populated
SELECT 
  plate_number,
  homeless_status,
  COUNT(*) FILTER (WHERE homeless_status = 'confirmed') as confirmed_count
FROM canonical_vehicles
GROUP BY plate_number, homeless_status
LIMIT 10;

-- If all NULL, homeless_exempt cohort will be empty
```

**Check 3: Zone rules exist**
```sql
-- Check v_zone_rules_20251201 has rows
SELECT * FROM v_zone_rules_20251201 LIMIT 5;

-- If empty, zone_compliance_matrix doesn't have effective_from = 2025-12-01
```

### Zone Requirements Not Showing?

**Check 1: Function returns data**
```sql
-- Pick a known observation ID
SELECT * FROM evaluate_observation_requirements('<obs-id>')
ORDER BY sort_order;

-- Expected: 3 rows with non-NULL reasons
-- If 0 rows, check canonical_vehicles and zone_compliance_matrix
```

**Check 2: UI component is calling correct RPC**
```javascript
// In ZoneRequirementsChecklist.tsx, verify:
const { data, error } = await supabase.rpc('evaluate_observation_requirements', {
  p_obs_id: observationId  // ← param name must match SQL function
});

// NOT: obs_id, observation_id, etc.
```

## Performance Notes

- Wrapper functions add ~1ms overhead (negligible)
- Recompute views use indexed queries (fast for <10k observations)
- For 100k+ observations, consider materialized views

## Rollback Plan

If wrappers cause issues:

```sql
-- Drop wrappers (keeps _recalc versions)
DROP FUNCTION IF EXISTS public.cohort_overstayers(timestamptz, timestamptz, uuid, uuid);
DROP FUNCTION IF EXISTS public.cohort_homeless_exempt(timestamptz, timestamptz, uuid, uuid);

-- Update UI to call _recalc versions directly
// In frontend:
await supabase.rpc('cohort_overstayers_recalc', { ... });
```

## Migration Path

### Phase 1: Deploy Wrappers (Current)
- ✅ Create public wrappers with UI-expected names
- ✅ Grant permissions
- ✅ Verify 404s are gone

### Phase 2: Test in Production (Next)
- ✅ Verify tile counts match drill-downs
- ✅ Verify Zone Requirements render with reasons
- ✅ Verify homeless filtering works correctly

### Phase 3: Monitoring (After Deployment)
- ✅ Watch for new 404s (means new RPC added without wrapper)
- ✅ Monitor query performance (if slow, materialize views)
- ✅ Track cohort counts over time (should be stable)

## Success Criteria

✅ **No more 404s** in DevTools Network tab
✅ **Dashboard tiles show counts** (not 0)
✅ **Clicking tile → report shows same count**
✅ **Zone Requirements render** with colored badges + reasons
✅ **Overstayers excludes homeless-exempt**
✅ **Homeless tile shows only homeless-exempt breaches**

