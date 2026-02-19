# Legacy Compliance Backfill Guide

## Problem
KPI tiles (Overstayers, Homeless Exempt) showing 0 because new cohort RPCs INNER JOIN to `compliance_results`, but legacy observations don't have compliance records.

## Solution: Analytics-Only Backfill
- Add `analytics_only` flag to compliance_results
- Backfill compliance for legacy observations WITHOUT triggering breach alerts
- Existing cohort RPCs automatically include legacy once compliance exists

## Migration Applied
`20260219_backfill_legacy_compliance.sql`

## What It Does
1. **Adds Column**: `compliance_results.analytics_only` (boolean)
2. **Helper Function**: `compute_legacy_breach_status(obs_id)` - computes compliance inline
3. **Backfill Function**: `backfill_legacy_compliance(batch_size, date_from, date_to)` - processes in batches
4. **Alert Protection**: Updated breach alert trigger to skip analytics-only rows
5. **Initial Run**: Backfills last 90 days automatically (500 records)

## Manual Backfill (If Needed)

### Check Status
```sql
-- How many legacy observations lack compliance?
SELECT count(*) AS missing_compliance
FROM vehicle_observations_v2 o
LEFT JOIN compliance_results cr ON cr.observation_id = o.observation_id
WHERE o.is_legacy_import = true
  AND cr.observation_id IS NULL;
```

### Backfill All Legacy
```sql
-- Run in batches (1000 at a time)
SELECT * FROM backfill_legacy_compliance(1000, NULL, NULL);

-- Repeat until missing_compliance = 0
```

### Backfill Specific Date Range
```sql
-- Only backfill observations from Jan-Feb 2025
SELECT * FROM backfill_legacy_compliance(
  1000,                -- batch size
  '2025-01-01',        -- from date
  '2025-02-19'         -- to date
);
```

## Verification

### 1. Check Backfill Progress
```sql
SELECT 
  count(*) FILTER (WHERE analytics_only) as analytics_rows,
  count(*) FILTER (WHERE NOT analytics_only) as live_rows,
  count(*) as total
FROM compliance_results;
```

### 2. Verify KPI Counts Match
```sql
-- Dashboard count (2026-02-19)
SELECT count(*) FROM cohort_overstayers(
  '2026-02-19T00:00:00+13', 
  '2026-02-19T23:59:59+13', 
  NULL, NULL
);

-- Should match drill-down in Observations Report
```

### 3. Test Drill-Down Alignment
- Open dashboard
- Click "Overstayers" KPI tile
- Count in Observations Report should match tile count
- Click "Homeless (Exempt)" KPI tile
- Same test

## Performance Notes
- Backfill runs in batches (default 1000) to avoid long locks
- Analytics-only rows indexed separately
- No impact on existing live observations
- One-time operation (future imports get compliance via trigger)

## Safety Features
- Analytics-only rows NEVER trigger breach_alerts
- Original compliance logic unchanged
- Backfill can be run incrementally
- Failed observations logged but don't block batch

## Monitoring
```sql
-- Track backfill by date range
SELECT 
  date_trunc('day', recorded_at)::date as day,
  count(*) FILTER (WHERE analytics_only) as backfilled,
  count(*) as total
FROM compliance_results
WHERE recorded_at >= '2025-01-01'
GROUP BY 1
ORDER BY 1 DESC;
```
