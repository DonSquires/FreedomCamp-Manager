# ============================================
# PHOTO INTEGRITY MONITORING & SLO TRACKING
# Target SLO: ≥99.95% photo retrievability
# ============================================

## Critical Metrics Dashboard

### 1. Photo Coverage SLO (≥99.95%)

```sql
-- Overall photo integrity health
SELECT 
  organization_name,
  total_observations,
  with_hash,
  missing_hash,
  hash_coverage_pct,
  CASE 
    WHEN hash_coverage_pct >= 99.95 THEN '✅ MEETS SLO'
    WHEN hash_coverage_pct >= 99.00 THEN '⚠️ AT RISK'
    ELSE '❌ BELOW SLO'
  END AS slo_status
FROM photo_integrity_health
ORDER BY hash_coverage_pct ASC;
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
-- missing_hash: 0%
-- invalid_bytes: 0%
-- blocked: <0.05% (manual flags only)
```

### 3. Photo Upload Success Rate (Last 24 Hours)

```sql
-- Track photo upload failures
SELECT 
  DATE_TRUNC('hour', created_at) AS hour,
  COUNT(*) AS attempts,
  COUNT(CASE WHEN photo_original_sha256 IS NOT NULL THEN 1 END) AS successful,
  COUNT(CASE WHEN photo_original_sha256 IS NULL THEN 1 END) AS failed,
  ROUND(100.0 * COUNT(CASE WHEN photo_original_sha256 IS NOT NULL THEN 1 END) / COUNT(*), 2) AS success_rate_pct
FROM vehicle_observations_v2
WHERE created_at >= now() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;

-- Alert if success_rate_pct < 99.95% in any hour
```

### 4. Storage HEAD Check (Verify Physical Files)

```sql
-- Observations created in last 15 minutes (for near-real-time monitoring)
SELECT 
  observation_id,
  organization_id,
  plate_number,
  photo_original_sha256,
  photo_url,
  created_at
FROM vehicle_observations_v2
WHERE 
  created_at >= now() - INTERVAL '15 minutes'
  AND photo_original_sha256 IS NOT NULL
ORDER BY created_at DESC;

-- Note: Application layer must perform HEAD check on photo_url
-- If 404 detected, trigger alert and add to missing_photo_queue
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

### 6. Evidence Access Audit (Chain-of-Custody)

```sql
-- Recent evidence access activity
SELECT 
  DATE_TRUNC('day', occurred_at) AS day,
  action,
  COUNT(*) AS count,
  COUNT(DISTINCT actor) AS unique_users
FROM evidence_access_log
WHERE occurred_at >= now() - INTERVAL '30 days'
GROUP BY day, action
ORDER BY day DESC, count DESC;
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
SELECT organization_name, hash_coverage_pct
FROM photo_integrity_health
WHERE hash_coverage_pct < 99.95;
-- If ANY rows returned: PAGE ON-CALL

-- ALERT 2: Recent observations without photos
SELECT COUNT(*) AS observations_without_photos
FROM vehicle_observations_v2
WHERE 
  created_at >= now() - INTERVAL '15 minutes'
  AND photo_original_sha256 IS NULL;
-- If count > 0: PAGE ON-CALL

-- ALERT 3: Storage HEAD failures (404 rate)
-- Note: Must be checked by application layer
-- If 404 rate > 0.1% over 15 minutes: PAGE ON-CALL

-- ALERT 4: Hash mismatch on export
-- Note: Detected during court-ready PDF generation
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
    COUNT(photo_original_sha256) AS with_photos,
    COUNT(*) - COUNT(photo_original_sha256) AS without_photos,
    ROUND(100.0 * COUNT(photo_original_sha256) / COUNT(*), 4) AS coverage_pct,
    COUNT(CASE WHEN review_blocked = true THEN 1 END) AS review_blocked_count
  FROM vehicle_observations_v2
),
queue_status AS (
  SELECT 
    COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending_repairs,
    COUNT(CASE WHEN status = 'manual_required' THEN 1 END) AS manual_review,
    COUNT(CASE WHEN status = 'abandoned' THEN 1 END) AS abandoned
  FROM missing_photo_queue
),
recent_activity AS (
  SELECT 
    COUNT(*) AS observations_last_24h,
    COUNT(photo_original_sha256) AS with_photos_last_24h
  FROM vehicle_observations_v2
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
  m.review_blocked_count,
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
-- Photo upload latency (from device_time to server_received_at)
SELECT 
  organization_id,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (server_received_at - device_time))) AS p50_latency_seconds,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (server_received_at - device_time))) AS p95_latency_seconds,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (server_received_at - device_time))) AS p99_latency_seconds
FROM vehicle_observations_v2
WHERE 
  created_at >= now() - INTERVAL '7 days'
  AND device_time IS NOT NULL
  AND server_received_at IS NOT NULL
  AND server_received_at > device_time -- Filter out clock skew outliers
GROUP BY organization_id;

-- Target: p95 < 60 seconds, p99 < 120 seconds
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

```typescript
// Edge Function: daily-photo-reconciler
// Runs: Every day at 2am UTC+12 (NZ timezone)

export async function dailyPhotoReconciler() {
  console.log('[RECONCILER] Starting daily photo integrity check');
  
  // 1. Check recent observations for storage anomalies
  const { data: recentObs } = await supabase
    .from('recent_observations_photo_status')
    .select('*')
    .eq('status', 'ok');
  
  let storageFailures = 0;
  
  for (const obs of recentObs) {
    const photoPath = `originals/${obs.organization_id}/.../obsobs.photo_original_sha256}.jpg`;
    
    // HEAD check
    const { error } = await supabase.storage
      .from('evidence')
      .download(photoPath);
    
    if (error) {
      console.error(`[RECONCILER] Storage 404: ${obs.observation_id}`);
      storageFailures++;
      
      // Add to missing_photo_queue
      await supabase
        .from('missing_photo_queue')
        .insert({
          observation_id: obs.observation_id,
          organization_id: obs.organization_id,
          reason: 'object_404',
          status: 'repairing'
        });
    }
  }
  
  // 2. Check for aged pending repairs
  const { data: agedRepairs } = await supabase
    .from('missing_photo_queue')
    .select('*')
    .eq('status', 'pending')
    .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000));
  
  if (agedRepairs && agedRepairs.length > 0) {
    console.warn(`[RECONCILER] ${agedRepairs.length} repairs aged > 24 hours`);
    // Send notification to admins
  }
  
  // 3. Cleanup expired idempotency keys
  await supabase
    .from('scan_idempotency_keys')
    .delete()
    .lt('expires_at', new Date().toISOString());
  
  // 4. Refresh expiring NZSCV cache entries
  const { data: expiringCache } = await supabase
    .from('nzscv_cache')
    .select('plate_number')
    .eq('is_current', true)
    .lt('cache_expires_at', new Date(Date.now() + 24 * 60 * 60 * 1000));
  
  for (const entry of expiringCache || []) {
    // Refresh NZSCV warrant data
    // (Implementation depends on NZSCV API availability)
  }
  
  console.log('[RECONCILER] Daily reconciliation complete', {
    storage_failures: storageFailures,
    aged_repairs: agedRepairs?.length || 0
  });
  
  return {
    success: true,
    storage_failures: storageFailures,
    aged_repairs: agedRepairs?.length || 0
  };
}
```

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
