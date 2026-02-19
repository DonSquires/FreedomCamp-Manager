# Compliance Backfill Verification Guide

## What Was Fixed

### Problem
- **Overstayers KPI**: Showing 0 (should show ~12)
- **Homeless (Exempt) KPI**: Showing 0 (should show subset of 12)
- **Breaches Tab**: Showing 12 ✅ (correct but using different source)

### Root Cause
New cohort RPCs (`cohort_overstayers`, `cohort_homeless_exempt`) INNER JOIN to `compliance_results`, but legacy observations lack compliance rows.

### Solution Applied
1. ✅ Versioned zone rules from **1 Dec 2025 NZT**
2. ✅ Backfilled compliance for ALL observations >= 1 Dec 2025
3. ✅ Suppressed alerts during backfill (no spam)
4. ✅ Fixed homeless filtering (only excludes from Overstayers, not global)
5. ✅ Rebuilt monthly stays cache

---

## Verification Steps

### 1. Check Backfill Completion

```sql
-- How many observations were backfilled?
SELECT 
  COUNT(*) FILTER (WHERE analytics_only = true) as backfilled_count,
  COUNT(*) FILTER (WHERE analytics_only = false) as live_count,
  COUNT(*) as total
FROM compliance_results
WHERE recorded_at >= '2025-12-01';

-- Expected: backfilled_count > 0, total should match observation count
```

### 2. Verify Zone Rule Versioning

```sql
-- Check each zone has a version starting 1 Dec 2025
SELECT 
  z.name,
  zcm.effective_from,
  zcm.effective_to,
  zcm.version,
  zcm.requires_csc,
  zcm.max_consecutive_nights,
  zcm.nights_per_month
FROM zone_compliance_matrix zcm
JOIN zones z ON z.id = zcm.zone_id
WHERE effective_from = DATE '2025-12-01'
  AND effective_to IS NULL
ORDER BY z.name;

-- Expected: One active row per zone with effective_from = 2025-12-01
```

### 3. Test KPI Cohorts for 17/02/2026

```sql
-- Overstayers (breach but NOT homeless-exempt)
SELECT count(*) as overstayers_count
FROM cohort_overstayers(
  '2026-02-17T00:00:00+13',
  '2026-02-17T23:59:59+13',
  NULL, -- org_id (NULL = all)
  NULL  -- zone_id (NULL = all)
);

-- Homeless (Exempt) (breach AND homeless-exempt)
SELECT count(*) as homeless_exempt_count
FROM cohort_homeless_exempt(
  '2026-02-17T00:00:00+13',
  '2026-02-17T23:59:59+13',
  NULL,
  NULL
);

-- Combined should equal total breaches (~12)
-- Expected: overstayers_count + homeless_exempt_count ≈ 12
```

### 4. Verify Dashboard Tile Counts Match Report

**In UI:**
1. Open Unified Dashboard
2. Set date: 17/02/2026 to 17/02/2026
3. Note **Overstayers** tile count
4. Click Overstayers tile → Observations Report
5. Count should **EXACTLY MATCH** tile

Repeat for **Homeless (Exempt)** tile.

### 5. Check Zone Requirements Checklist

**Pick any observation from 17/02/2026:**
```sql
SELECT observation_id, plate_number, recorded_at
FROM vehicle_observations_v2
WHERE recorded_at::date = DATE '2026-02-17'
LIMIT 1;
```

**In UI:**
1. Navigate to Observations Report
2. Find that observation
3. Expand the card
4. Verify **Zone Requirements** section shows:
   - ✅ Color-coded chips (YES/NO/BREACH/BREACH_EXEMPT)
   - ✅ Detailed reasons (e.g., "4/3 consecutive nights (limit exceeded)")
   - ✅ Homeless exemption notes if applicable

### 6. Verify Enforcement Guard Still Blocks Non-Evidence

**Test legacy observation:**
```sql
-- Find a legacy observation (is_legacy_import = true)
SELECT observation_id, plate_number, evidence_state, is_legacy_import
FROM vehicle_observations_v2
WHERE is_legacy_import = true
  AND recorded_at >= '2025-12-01'
LIMIT 1;
```

**In UI:**
1. Try to create enforcement action for that observation
2. Should get **EnforcementGuardModal** blocking it with reason:
   - "Evidence integrity check failed: Legacy import"

---

## Expected Results Summary

| KPI | Before Fix | After Fix |
|-----|-----------|-----------|
| Overstayers | 0 ❌ | ~8-10 ✅ |
| Homeless (Exempt) | 0 ❌ | ~2-4 ✅ |
| All Breaches | 12 ✅ | 12 ✅ |
| Dashboard = Report | NO ❌ | YES ✅ |

---

## Troubleshooting

### If Overstayers still shows 0:

```sql
-- Debug: Check compliance_results exist
SELECT 
  COUNT(*) as total_obs,
  COUNT(cr.observation_id) as with_compliance,
  COUNT(*) FILTER (WHERE cr.is_breach = true AND cr.is_homeless_exempt = false) as overstayers
FROM vehicle_observations_v2 o
LEFT JOIN compliance_results cr ON cr.observation_id = o.observation_id
WHERE o.recorded_at BETWEEN '2026-02-17T00:00:00+13' AND '2026-02-17T23:59:59+13';

-- If with_compliance = 0, backfill didn't run
-- Re-run: SELECT * FROM backfill_all_compliance_from_dec_2025(1000);
```

### If counts mismatch between dashboard and report:

```sql
-- Check timezone conversion consistency
-- Dashboard should use same UTC conversion as report:
-- zonedTimeToUtc(startOfDay(nzDate), 'Pacific/Auckland')

-- Verify both call the same RPC with same params
```

### If Zone Requirements show "No details available":

```sql
-- Test evaluation function directly
SELECT *
FROM evaluate_observation_requirements('<observation_id>')
ORDER BY sort_order;

-- Should return rows with non-NULL reasons
-- If NULL, check that observation has canonical_vehicles record
```

---

## Manual Re-Run (If Needed)

```sql
-- Clear backfilled compliance (keeps live enforcement)
DELETE FROM compliance_results
WHERE analytics_only = true
  AND recorded_at >= '2025-12-01';

-- Re-run backfill
SELECT * FROM backfill_all_compliance_from_dec_2025(1000);
```

---

## Performance Notes

- Backfill runs in batches (1000 obs at a time) to avoid locks
- Analytics-only rows indexed separately
- Monthly stays cache rebuilt from Dec 2025
- Zone rule lookups use versioned index

---

## Next Steps (Optional)

1. **KPI Snapshot Table**: Track attribute coverage trends over time
2. **Scheduled Recalculation**: Nightly job to catch any missed compliance updates
3. **Audit Report**: Compare pre/post backfill breach counts for validation
