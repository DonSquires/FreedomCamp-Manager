# Zero-Trust Compliance Recompute Guide

## Philosophy Change

**BEFORE**: Relied on pre-computed `compliance_results` table
- ❌ Legacy observations lacked compliance rows
- ❌ Backfill complexity and potential drift
- ❌ KPI tiles and drill-downs could diverge

**AFTER**: Recompute from minimal inputs (date, zone, plate)
- ✅ Works for ALL observations (legacy or new)
- ✅ Single source of truth (tiles + drill-downs use same logic)
- ✅ Deterministic (pinned rules from 1-Dec-2025)
- ✅ No dependency on backfill

## Architecture

### Data Flow
```
Observations → Minimal Inputs (date, zone, plate)
    ↓
Recompute Views (v_runs, v_monthly_stays)
    ↓
Pinned Zone Rules (v_zone_rules_20251201)
    ↓
Cohort Functions (overstayers_recalc, homeless_exempt_recalc)
    ↓
Dashboard Tiles + Report Drill-Downs (always aligned)
```

### Key Components

1. **v_obs_base**: Normalizes observations to NZ local dates, resolves homeless flag
2. **v_obs_nights**: Distinct nights per plate+zone (deduplicates multiple obs per day)
3. **v_runs**: Consecutive night runs using "islands & gaps" algorithm
4. **v_monthly_stays**: Monthly night counts per plate+org
5. **v_zone_rules_20251201**: Zone rules pinned to 1-Dec-2025 (frozen)
6. **cohort_*_recalc**: Recompute cohorts from views (no pre-computed compliance)

## Verification Steps

### 1. Test Consecutive Runs Logic
```sql
-- Pick a known plate with multiple observations
SELECT * 
FROM v_runs
WHERE plate_number = 'ABC123'
ORDER BY run_start DESC;

-- Expected: Shows all consecutive runs with start/end dates and lengths
```

### 2. Verify KPI Counts for 17/02/2026
```sql
-- Overstayers (breach but NOT homeless)
SELECT count(*) as overstayers
FROM cohort_overstayers_recalc(
  '2026-02-17T00:00:00+13',
  '2026-02-17T23:59:59+13',
  NULL, NULL
);

-- Homeless (breach AND homeless)
SELECT count(*) as homeless_exempt
FROM cohort_homeless_exempt_recalc(
  '2026-02-17T00:00:00+13',
  '2026-02-17T23:59:59+13',
  NULL, NULL
);

-- Compliant (no breaches)
SELECT count(*) as compliant
FROM cohort_compliant_recalc(
  '2026-02-17T00:00:00+13',
  '2026-02-17T23:59:59+13',
  NULL, NULL
);

-- ✅ overstayers + homeless_exempt should equal your "Breaches" count
```

### 3. Test Zone Requirements Checklist
```sql
-- Pick an observation from overstayers cohort
WITH overstayers AS (
  SELECT * FROM cohort_overstayers_recalc(
    '2026-02-17T00:00:00+13',
    '2026-02-17T23:59:59+13',
    NULL, NULL
  )
  LIMIT 1
)
SELECT * 
FROM evaluate_observation_requirements_recalc(
  (SELECT observation_id FROM overstayers)
)
ORDER BY sort_order;

-- Expected: 3 rows with non-NULL reasons:
-- - csc_required: status + detailed reason
-- - max_nights: BREACH with "4/3 consecutive nights (limit exceeded)"
-- - monthly_limit: YES/BREACH with actual counts
```

### 4. Compare Old vs New Cohorts
```sql
-- OLD (compliance_results-based)
SELECT count(*) FROM cohort_overstayers(
  '2026-02-17T00:00:00+13',
  '2026-02-17T23:59:59+13',
  NULL, NULL
);

-- NEW (recompute-based)
SELECT count(*) FROM cohort_overstayers_recalc(
  '2026-02-17T00:00:00+13',
  '2026-02-17T23:59:59+13',
  NULL, NULL
);

-- If counts differ significantly, investigate which plates are missing
```

## Frontend Integration

### Update Dashboard Tiles
```typescript
// OLD
const { data: overstayers } = await supabase.rpc('cohort_overstayers', { ... });

// NEW
const { data: overstayers } = await supabase.rpc('cohort_overstayers_recalc', { 
  p_from: utcFrom,
  p_to: utcTo,
  p_org_id: orgId === 'ALL' ? null : orgId,
  p_zone_id: zoneId === 'ALL' ? null : zoneId
});
const overstayersCount = overstayers?.length ?? 0;
```

### Update ObservationsReport
```typescript
// OLD
const { data } = await supabase.rpc('cohort_overstayers', { ... });

// NEW
const { data } = await supabase.rpc('cohort_overstayers_recalc', {
  p_from: utcFromISO,
  p_to: utcToISO,
  p_org_id: orgId === 'ALL' ? null : orgId,
  p_zone_id: zoneId === 'ALL' ? null : zoneId
});

// Then fetch full observation records by IDs
const observationIds = data?.map(d => d.observation_id) ?? [];
const { data: observations } = await supabase
  .from('vehicle_observations_v2')
  .select('*')
  .in('observation_id', observationIds)
  .order('recorded_at', { ascending: false });
```

### Update ZoneRequirementsChecklist
```typescript
// OLD
await supabase.rpc('evaluate_observation_requirements', { p_obs_id });

// NEW
await supabase.rpc('evaluate_observation_requirements_recalc', { p_obs_id });
```

## Performance Notes

### View Materialization (Optional)
If recompute views become slow (10k+ observations), consider materialization:

```sql
CREATE MATERIALIZED VIEW mv_runs AS
SELECT * FROM v_runs;

CREATE INDEX idx_mv_runs_plate_zone ON mv_runs(plate_number, organization_id, zone_id);

-- Refresh nightly
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_runs;
```

### Index Recommendations
```sql
-- Already created in migration:
CREATE INDEX idx_obs_v2_recorded_at_plate_zone 
  ON vehicle_observations_v2(recorded_at, plate_number, zone_id, organization_id)
  WHERE recorded_at >= '2025-12-01';
```

## Rollback Plan

If you need to revert to old cohort functions:

```sql
-- Re-enable old functions (replace _recalc with original names)
-- In frontend, switch back to:
// supabase.rpc('cohort_overstayers') instead of cohort_overstayers_recalc
```

## Migration Path

### Phase 1: Verify (Current)
1. Run verification queries above
2. Compare cohort counts (old vs new)
3. Test drill-downs in UI
4. Verify Zone Requirements checklist shows proper reasons

### Phase 2: Switch Frontend (After Verification)
1. Update UnifiedDashboard.tsx to use `*_recalc` functions
2. Update ObservationsReport.tsx to use `*_recalc` functions
3. Update ZoneRequirementsChecklist.tsx to use `evaluate_observation_requirements_recalc`
4. Deploy and smoke test

### Phase 3: Backfill (Optional, After Stabilization)
Once recompute approach is stable, optionally backfill compliance_results for query speed:

```sql
-- Populate compliance_results from recompute results
INSERT INTO compliance_results (
  observation_id,
  is_breach,
  is_homeless_exempt,
  analytics_only,
  created_at
)
SELECT 
  obs_id,
  true,
  true,
  true,
  now()
FROM cohort_homeless_exempt_recalc(
  '2025-12-01T00:00:00+13',
  '2026-12-31T23:59:59+13',
  NULL, NULL
);

-- But keep UI using recompute functions to prevent future drift
```

## Benefits

1. **No More Backfill Hell**: Works immediately for all observations
2. **Zero Drift**: Dashboard and drill-downs always use same logic
3. **Deterministic**: Pinned rules ensure consistent results
4. **Minimal Data**: Only needs (date, zone, plate)
5. **Legacy-Friendly**: CSC shows as "no data" instead of false breach
6. **Auditable**: SQL views are transparent and testable

## Gotchas to Avoid

1. **Timezone Consistency**: Always convert NZ local → UTC in same way
2. **NULL Handling**: Use COALESCE for all nullable fields
3. **Homeless Flag**: Ensure canonical_vehicles.homeless_status is up-to-date
4. **Zone Rules**: Verify v_zone_rules_20251201 has rows for all zones
5. **Performance**: For 100k+ observations, consider materialized views
