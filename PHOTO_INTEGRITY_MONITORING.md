# ============================================
# PHOTO INTEGRITY MONITORING & SLO TRACKING
# Target SLO: ≥99.95% photo retrievability
# ============================================
#
# Schema note: queries use the `observations` table (photo_url + photo_hash
# columns). The legacy `vehicle_observations_v2` table no longer exists.
# Views photo_integrity_health and recent_observations_photo_status are
# created by migration 20260323_photo_recovery_infrastructure.sql.
# ============================================

## Critical Metrics Dashboard

### 1. Photo Coverage SLO (≥99.95%)

```sql
-- Overall photo integrity health
SELECT
  organization_name,
  total_observations,
  with_photo,
  missing_any,
  photo_coverage_pct,
  CASE
    WHEN photo_coverage_pct >= 99.95 THEN '✅ MEETS SLO'
    WHEN photo_coverage_pct >= 99.00 THEN '⚠️ AT RISK'
    ELSE '❌ BELOW SLO'
  END AS slo_status
FROM photo_integrity_health
ORDER BY photo_coverage_pct ASC;
```

### 2. Recent Photo Status (Last 7 Days)

```sql
-- Photo status for recent observations
SELECT
  status,
  COUNT(*) AS count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 2) AS percentage
FROM recent_observations_photo_status
GROUP BY status
ORDER BY count DESC;

-- Should show:
-- ok: ~100% (if photo-first enforcement working)
-- missing_url: 0%
-- missing_hash: 0%
-- missing_both: 0%
```

### 3. Photo Upload Success Rate (Last 24 Hours)

```sql
-- Track photo upload failures (observations table)
SELECT
  DATE_TRUNC('hour', created_at) AS hour,
  COUNT(*) AS attempts,
  COUNT(CASE WHEN photo_url  IS NOT NULL AND photo_hash IS NOT NULL THEN 1 END) AS successful,
  COUNT(CASE WHEN photo_url  IS NULL     OR  photo_hash IS NULL     THEN 1 END) AS failed,
  ROUND(
    100.0 * COUNT(CASE WHEN photo_url IS NOT NULL AND photo_hash IS NOT NULL THEN 1 END) / COUNT(*),
    2
  ) AS success_rate_pct
FROM observations
WHERE created_at >= now() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;

-- Alert if success_rate_pct < 99.95% in any hour
```

### 4. Storage HEAD Check (Verify Physical Files)

```sql
-- Observations created in last 15 minutes (for near-real-time monitoring)
SELECT
  id              AS observation_id,
  organization_id,
  plate_number,
  photo_hash,
  photo_url,
  created_at
FROM observations
WHERE
  created_at >= now() - INTERVAL '15 minutes'
  AND photo_url IS NOT NULL
ORDER BY created_at DESC;

-- Note: Application layer or daily-photo-reconciler must perform HEAD check on photo_url.
-- If 404 detected, trigger alert and add to missing_photo_queue.
-- Run the edge function to automate this:
--   POST /functions/v1/daily-photo-reconciler  { "check_storage_head": true }
```

### 5. Missing Photo Queue Status

```sql
-- Backfill/repair queue health
SELECT
  status,
  reason,
  COUNT(*) AS count,
  MIN(recorded_at) AS oldest_observation,
  AVG(attempts) AS avg_attempts
FROM missing_photo_queue
GROUP BY status, reason
ORDER BY count DESC;

-- Alert if:
-- - pending > 0 for > 24 hours
-- - repairing > 0 for > 7 days
-- - manual_required not being reviewed
```

### 6. Photo Recovery Audit Log (Chain-of-Custody)

```sql
-- Recent recovery actions
SELECT
  DATE_TRUNC('day', occurred_at) AS day,
  action,
  source,
  success,
  COUNT(*) AS count,
  COUNT(DISTINCT actor_label) AS unique_actors
FROM photo_recovery_audit_log
WHERE occurred_at >= now() - INTERVAL '30 days'
GROUP BY day, action, source, success
ORDER BY day DESC, count DESC;

-- Full audit trail for a specific observation
SELECT *
FROM photo_recovery_audit_log
WHERE observation_id = '{observation_id}'
ORDER BY occurred_at ASC;
```

### 7. NZSCV Cache Hit Rate

```sql
-- Cache effectiveness for warrant lookups
SELECT 
  DATE_TRUNC('day', verified_at) AS day,
  warrant_type,
  COUNT(*) AS lookups,
  COUNT(CASE WHEN verification_method = 'api' THEN 1 END) AS api_calls,
  COUNT(CASE WHEN verification_method = 'cached' THEN 1 END) AS cache_hits,
  ROUND(100.0 * COUNT(CASE WHEN verification_method = 'cached' THEN 1 END) / COUNT(*), 2) AS cache_hit_rate_pct
FROM nzscv_cache
WHERE verified_at >= now() - INTERVAL '30 days'
GROUP BY day, warrant_type
ORDER BY day DESC;
```

## Alerting Rules

### Critical Alerts (Page On-Call)

```sql
-- ALERT 1: Photo coverage below SLO
SELECT organization_name, photo_coverage_pct
FROM photo_integrity_health
WHERE photo_coverage_pct < 99.95;
-- If ANY rows returned: PAGE ON-CALL

-- ALERT 2: Recent observations without photos
SELECT COUNT(*) AS observations_without_photos
FROM observations
WHERE
  created_at >= now() - INTERVAL '15 minutes'
  AND (photo_url IS NULL OR photo_hash IS NULL);
-- If count > 0: PAGE ON-CALL

-- ALERT 3: Storage HEAD failures (404 rate)
-- Automated by daily-photo-reconciler; check missing_photo_queue for reason='object_404'
SELECT COUNT(*) FROM missing_photo_queue WHERE reason = 'object_404' AND status != 'fixed';
-- If count > 0: PAGE ON-CALL

-- ALERT 4: Hash mismatch on export
-- Detected during court-ready PDF generation
-- If ANY hash mismatch: PAGE ON-CALL + BLOCK EXPORT
```

### Warning Alerts (Notify Admin)

```sql
-- WARNING 1: Pending repairs aging
SELECT COUNT(*) AS aged_repairs
FROM missing_photo_queue
WHERE
  status = 'pending'
  AND created_at < now() - INTERVAL '24 hours';
-- If count > 0: NOTIFY ADMIN

-- WARNING 2: Manual review backlog
SELECT COUNT(*) AS manual_backlog
FROM missing_photo_queue
WHERE
  status = 'manual_required'
  AND assigned_to IS NULL;
-- If count > 10: NOTIFY ADMIN

-- WARNING 3: NZSCV cache expiring soon
SELECT COUNT(*) AS expiring_soon
FROM nzscv_cache
WHERE
  is_current = true
  AND cache_expires_at < now() + INTERVAL '24 hours';
-- If count > 0: NOTIFY ADMIN (refresh cache)
```

## Daily Health Report

```sql
-- Executive summary of photo integrity (run daily at 6am)
WITH metrics AS (
  SELECT
    COUNT(*) AS total_observations,
    COUNT(CASE WHEN photo_url IS NOT NULL AND photo_hash IS NOT NULL THEN 1 END) AS with_photos,
    COUNT(*) - COUNT(CASE WHEN photo_url IS NOT NULL AND photo_hash IS NOT NULL THEN 1 END) AS without_photos,
    ROUND(
      100.0 * COUNT(CASE WHEN photo_url IS NOT NULL AND photo_hash IS NOT NULL THEN 1 END) / NULLIF(COUNT(*),0),
      4
    ) AS coverage_pct
  FROM observations
),
queue_status AS (
  SELECT
    COUNT(CASE WHEN status = 'pending'         THEN 1 END) AS pending_repairs,
    COUNT(CASE WHEN status = 'manual_required' THEN 1 END) AS manual_review,
    COUNT(CASE WHEN status = 'abandoned'       THEN 1 END) AS abandoned
  FROM missing_photo_queue
),
recent_activity AS (
  SELECT
    COUNT(*) AS observations_last_24h,
    COUNT(CASE WHEN photo_url IS NOT NULL AND photo_hash IS NOT NULL THEN 1 END) AS with_photos_last_24h
  FROM observations
  WHERE created_at >= now() - INTERVAL '24 hours'
)
SELECT
  m.total_observations,
  m.with_photos,
  m.without_photos,
  m.coverage_pct,
  CASE
    WHEN m.coverage_pct >= 99.95 THEN '✅ MEETS SLO'
    WHEN m.coverage_pct >= 99.00 THEN '⚠️ AT RISK'
    ELSE '❌ BELOW SLO'
  END AS slo_status,
  q.pending_repairs,
  q.manual_review,
  q.abandoned,
  r.observations_last_24h,
  r.with_photos_last_24h,
  ROUND(100.0 * r.with_photos_last_24h / NULLIF(r.observations_last_24h, 0), 2) AS last_24h_coverage_pct
FROM metrics m, queue_status q, recent_activity r;
```

## Performance Benchmarks

```sql
-- Photo upload latency – requires device_time column if present
-- observations table does not currently have device_time; adapt as needed
SELECT
  organization_id,
  COUNT(*) AS total,
  COUNT(CASE WHEN photo_url IS NOT NULL THEN 1 END) AS uploaded
FROM observations
WHERE created_at >= now() - INTERVAL '7 days'
GROUP BY organization_id;

-- Target: 100% upload rate; p95 upload latency < 60s (monitor via application layer)
```

## Grafana/Prometheus Queries

```promql
# Photo coverage percentage (per org)
100 * (
  sum(vehicle_observations_with_photo{organization_id="$org_id"})
  /
  sum(vehicle_observations_total{organization_id="$org_id"})
)

# Photo upload success rate (last hour)
100 * (
  sum(increase(photo_uploads_successful[1h]))
  /
  sum(increase(photo_uploads_attempted[1h]))
)

# Storage 404 rate
100 * (
  sum(increase(storage_head_404[15m]))
  /
  sum(increase(storage_head_total[15m]))
)

# Missing photo queue size (by status)
count(missing_photo_queue{status="$status"})
```

## Automated Reconciler Job

The `daily-photo-reconciler` Edge Function handles all monitoring steps automatically.

```bash
# Trigger manually (admin/master only)
curl -X POST "$SUPABASE_URL/functions/v1/daily-photo-reconciler" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "check_storage_head": true,
    "storage_head_limit": 200,
    "cleanup_idempotency": true
  }'
```

The function:
1. Calls `detect_missing_photos()` to find new orphaned observations
2. HEAD-checks storage for `object_404` anomalies
3. Alerts on aged pending repairs (> 24 h)
4. Cleans up expired `scan_idempotency_keys`
5. Logs all findings to `photo_recovery_audit_log`
6. Returns a health summary including `integrity_health.slo_status`

Schedule via Supabase Cron (pg_cron) or an external scheduler at `02:00 NZT` daily.

## Success Criteria Summary

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Photo Coverage (Overall) | ≥99.95% | <99.95% |
| Photo Coverage (Last 24h) | ≥99.95% | <99.00% |
| Storage 404 Rate (15min) | 0% | >0.1% |
| Hash Mismatch Rate | 0% | >0% |
| Pending Repairs (24h+) | 0 | >0 |
| Manual Review Backlog | <10 | >10 |
| Upload Latency (p95) | <60s | >120s |

---

**Status**: Ready for production monitoring
**Owner**: DevOps + Admin team
**Next Step**: Configure Grafana dashboards + alerting rules
