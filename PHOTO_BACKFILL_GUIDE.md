# ============================================
# PHOTO BACKFILL & RECONCILIATION SCRIPT
# Reconcile orphaned observations with missing photos
# ============================================

This document outlines the backfill process to reconcile observations missing verifiable original photos.

## Prerequisites

- Database migration `20260219_photo_first_enforcement.sql` deployed
- Access to Supabase Storage (evidence bucket)
- Service role credentials for admin operations

## Phase 1: Detection (Read-Only Scan)

Run detection query to populate missing_photo_queue:

```sql
-- Detect observations missing photos and populate queue
INSERT INTO missing_photo_queue (
  observation_id,
  organization_id,
  plate_number,
  recorded_at,
  reason
)
SELECT 
  obs.observation_id,
  obs.organization_id,
  obs.plate_number,
  obs.recorded_at,
  CASE 
    WHEN obs.photo_original_sha256 IS NULL THEN 'null_hash'
    WHEN obs.photo_original_bytes IS NULL OR obs.photo_original_bytes <= 0 THEN 'null_hash'
    ELSE 'unknown'
  END AS reason
FROM vehicle_observations_v2 obs
WHERE 
  obs.photo_original_sha256 IS NULL
  OR obs.photo_original_bytes IS NULL
  OR obs.photo_original_bytes <= 0
ON CONFLICT DO NOTHING;
```

## Phase 2: Recovery Attempts

For each record in `missing_photo_queue` with status='pending':

### 2.1 Check Legacy Buckets

```typescript
// Search for photo in old bucket paths
const legacyPaths = [
  `evidence/${organizationId}/${plateNumber}/${timestamp}.jpg`,
  `uploads/${userId}/${timestamp}.jpg`,
  `vehicle-photos/${observationId}.jpg`
];

for (const path of legacyPaths) {
  const { data, error } = await supabase.storage
    .from('evidence')
    .download(path);
  
  if (!error && data) {
    // Found candidate photo
    // Calculate hash, move to correct path
    const hash = await calculateSHA256(data);
    const newPath = `originals/${orgId}/${year}/${month}/${obsId}/${hash}.jpg`;
    
    // Copy to new location
    await supabase.storage.from('evidence').upload(newPath, data);
    
    // Update observation
    await supabase
      .from('vehicle_observations_v2')
      .update({
        photo_original_sha256: hash,
        photo_original_bytes: data.size,
        photo_url: getPublicUrl(newPath)
      })
      .eq('observation_id', observationId);
    
    // Mark as fixed in queue
    await supabase
      .from('missing_photo_queue')
      .update({
        status: 'fixed',
        original_photo_url: newPath,
        attempted_hash: hash,
        repair_notes: `Recovered from legacy path: ${path}`
      })
      .eq('observation_id', observationId);
    
    break;
  }
}
```

### 2.2 Check Derived Photos (Watermarked)

```typescript
// If only watermarked version exists
const derivedPath = `derived/${orgId}/${year}/${month}/${obsId}/watermarked-*.jpg`;

const { data: files } = await supabase.storage
  .from('evidence')
  .list(derivedPath);

if (files && files.length > 0) {
  // Download watermarked photo
  const { data: watermarkedPhoto } = await supabase.storage
    .from('evidence')
    .download(files[0].name);
  
  // Calculate hash of watermarked version
  const hash = await calculateSHA256(watermarkedPhoto);
  
  // Mark as manual review required (watermarked is not admissible as original)
  await supabase
    .from('missing_photo_queue')
    .update({
      status: 'manual_required',
      original_photo_url: files[0].name,
      attempted_hash: hash,
      repair_notes: 'Only watermarked version found - original lost. Field re-capture recommended.'
    })
    .eq('observation_id', observationId);
}
```

### 2.3 Match by Plate + Timestamp Window

```typescript
// Find photos uploaded around the same time with matching plate
const { data: candidatePhotos } = await supabase
  .from('photo_metadata')
  .select('*')
  .gte('captured_at', new Date(observation.recorded_at - 5 * 60 * 1000)) // 5 min before
  .lte('captured_at', new Date(observation.recorded_at + 5 * 60 * 1000)) // 5 min after
  .eq('organization_id', observation.organization_id);

for (const photo of candidatePhotos) {
  // Check if photo matches observation characteristics
  if (photo.gps_latitude && photo.gps_longitude) {
    const distance = calculateDistance(
      observation.gps_latitude,
      observation.gps_longitude,
      photo.gps_latitude,
      photo.gps_longitude
    );
    
    if (distance < 100) { // Within 100m
      // Possible match - flag for manual review
      await supabase
        .from('missing_photo_queue')
        .update({
          status: 'manual_required',
          original_photo_url: photo.photo_url,
          attempted_hash: photo.original_sha256,
          repair_notes: `Possible match found: ${distance.toFixed(0)}m away, ${Math.abs(new Date(observation.recorded_at) - new Date(photo.captured_at)) / 1000}s time difference`
        })
        .eq('observation_id', observation.observation_id);
      
      break;
    }
  }
}
```

## Phase 3: Manual Review

For observations with status='manual_required':

1. Admin reviews candidate photos in missing_photo_queue
2. If correct photo identified:
   - Update observation with photo_original_sha256, photo_original_bytes
   - Mark queue item as 'fixed'
3. If no photo can be recovered:
   - Option A: Re-capture in field (assign to officer)
   - Option B: Mark observation as 'abandoned' (non-evidential)

```sql
-- Assign for field re-capture
UPDATE missing_photo_queue
SET 
  status = 'manual_required',
  assigned_to = '{officer_id}',
  repair_notes = 'Original photo lost - field re-capture required'
WHERE id = '{queue_item_id}';

-- Or abandon observation (delete or mark non-evidential)
UPDATE vehicle_observations_v2
SET review_blocked = true
WHERE observation_id = '{observation_id}';

UPDATE missing_photo_queue
SET 
  status = 'abandoned',
  repair_notes = 'Original photo unrecoverable - observation marked non-evidential'
WHERE observation_id = '{observation_id}';
```

## Phase 4: Verification

After backfill complete, verify photo coverage:

```sql
-- Check photo integrity health
SELECT * FROM photo_integrity_health;

-- Check for remaining orphaned observations
SELECT COUNT(*) AS remaining_orphans
FROM vehicle_observations_v2
WHERE photo_original_sha256 IS NULL;

-- Check missing_photo_queue status breakdown
SELECT 
  status,
  COUNT(*) AS count,
  MIN(recorded_at) AS oldest_observation,
  MAX(recorded_at) AS newest_observation
FROM missing_photo_queue
GROUP BY status
ORDER BY count DESC;
```

## Phase 5: Enable NOT NULL Constraint

Only after backfill complete and all pending repairs resolved:

```bash
# Deploy the NOT NULL enforcement migration
psql $DATABASE_URL -f supabase/migrations/20260219_enforce_photo_not_null.sql
```

This will:
- Enforce NOT NULL on photo_original_sha256
- Enforce NOT NULL on photo_original_bytes
- Revoke DELETE permission on vehicle_observations_v2
- Remove temporary indexes

## Monitoring

After enforcement enabled, monitor photo integrity:

```sql
-- Daily photo integrity check
SELECT 
  organization_name,
  total_observations,
  with_hash,
  missing_hash,
  hash_coverage_pct
FROM photo_integrity_health
WHERE hash_coverage_pct < 99.95; -- Alert if below SLO

-- Recent observations photo status (last 7 days)
SELECT 
  status,
  COUNT(*) AS count
FROM recent_observations_photo_status
GROUP BY status;

-- Should show:
-- ok: 100% (if zero-loss enforcement working)
-- missing_hash: 0
-- invalid_bytes: 0
-- blocked: 0 (unless manually flagged)
```

## Continuous Reconciler (Daily Job)

Run daily to detect any storage anomalies:

```typescript
// Edge Function: daily-photo-reconciler

const { data: recentObservations } = await supabase
  .from('recent_observations_photo_status')
  .select('*')
  .eq('status', 'ok'); // Should be ok, but verify storage

for (const obs of recentObservations) {
  // HEAD check on storage
  const { data, error } = await supabase.storage
    .from('evidence')
    .download(`originals/${obs.organization_id}/.../${obs.photo_original_sha256}.jpg`);
  
  if (error || !data) {
    // Photo missing from storage despite DB having hash
    console.error('Storage anomaly detected:', obs.observation_id);
    
    // Alert on-call
    await sendAlert({
      severity: 'critical',
      message: `Photo missing from storage: observation ${obs.observation_id}`,
      observation_id: obs.observation_id
    });
    
    // Flag in queue
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
```

## Recovery Timeline Estimate

| Phase | Duration | Description |
|-------|----------|-------------|
| Detection | 5 minutes | Populate missing_photo_queue |
| Automated Recovery | 1-2 hours | Search legacy paths, match candidates |
| Manual Review | 1-3 days | Admin verifies candidate matches |
| Field Re-capture | 1-2 weeks | Officers re-scan vehicles with lost photos |
| Verification | 30 minutes | Confirm backfill complete |
| Enable NOT NULL | 5 minutes | Deploy enforcement migration |

## Success Criteria

- ✅ Photo integrity health shows ≥99.95% hash coverage
- ✅ missing_photo_queue has 0 'pending' or 'repairing' items
- ✅ All active observations have photo_original_sha256 AND photo_original_bytes > 0
- ✅ NOT NULL constraint enabled without errors
- ✅ Daily reconciler runs without alerts

---

**Status**: Ready to execute
**Owner**: Admin team
**Next Step**: Run Phase 1 detection query
