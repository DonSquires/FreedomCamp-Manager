# ============================================
# PHOTO BACKFILL & RECONCILIATION GUIDE
# Recover and relink vehicle/plate photos accidentally deleted from storage
# ============================================

This document outlines the backfill process to recover and reconcile observations
missing verifiable original photos following an accidental storage bucket deletion.

**Schema note**: The `observations` table (migrated from the legacy
`vehicle_observations_v2`) stores `photo_url` (storage URL) and `photo_hash`
(SHA-256 of the original file). The recovery infrastructure is created by migration
`20260323_photo_recovery_infrastructure.sql`.

## Prerequisites

- Migration `20260323_photo_recovery_infrastructure.sql` deployed
- `PARKPOW_API_TOKEN` and `PLATERECOGNIZER_TOKEN` secrets set in Supabase
- Access to Supabase Storage (`evidence` bucket)
- Service role credentials for admin operations

## Automated Recovery (Recommended)

Use the **`photo-recovery`** Edge Function to orchestrate all phases automatically:

```bash
# Dry run – see what would be recovered without making changes
curl -X POST "$SUPABASE_URL/functions/v1/photo-recovery" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"apply": false, "window_minutes": 60, "limit": 200}'

# Apply – recover photos and update observations
curl -X POST "$SUPABASE_URL/functions/v1/photo-recovery" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"apply": true, "window_minutes": 60, "limit": 200, "date_from": "2026-01-01"}'
```

All actions are logged to `photo_recovery_audit_log` for chain-of-custody.

---

## Manual Phase-by-Phase Recovery

### Phase 1: Detection (Read-Only Scan)

Run detection query to populate missing_photo_queue, **or** call the DB function:

```sql
-- Option A: Use the helper function (preferred)
SELECT * FROM detect_missing_photos();

-- Option B: Manual detection query
INSERT INTO missing_photo_queue (
  observation_id,
  organization_id,
  plate_number,
  recorded_at,
  reason
)
SELECT
  obs.id,
  obs.organization_id,
  obs.plate_number,
  obs.recorded_at,
  CASE
    WHEN obs.photo_url  IS NULL AND obs.photo_hash IS NULL THEN 'null_url'
    WHEN obs.photo_url  IS NULL THEN 'null_url'
    WHEN obs.photo_hash IS NULL THEN 'null_hash'
    ELSE 'unknown'
  END AS reason
FROM observations obs
WHERE
  obs.photo_url  IS NULL
  OR obs.photo_hash IS NULL
ON CONFLICT (observation_id) DO NOTHING;
```

## Phase 2: Recovery Attempts

For each record in `missing_photo_queue` with status='pending':

### 2.1 Automated Recovery via Edge Function (Preferred)

```bash
# Run photo-recovery edge function (applies ParkPow + Plate Recognizer matching)
curl -X POST "$SUPABASE_URL/functions/v1/photo-recovery" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"apply": true, "window_minutes": 60, "limit": 200}'
```

### 2.2 Check Legacy Buckets (Manual)

```typescript
// Search for photo in old bucket paths
const legacyPaths = [
  `evidence/${organizationId}/${plateNumber}/${timestamp}.jpg`,
  `uploads/${userId}/${timestamp}.jpg`,
  `vehicle-photos/${observationId}.jpg`,
  `scans/${userId}/${timestamp}-${hash}.jpg`,
];

for (const path of legacyPaths) {
  const { data, error } = await supabase.storage
    .from('evidence')
    .download(path);

  if (!error && data) {
    // Found candidate photo – compute SHA-256 and update observation
    const hashBytes = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
    const hash = Array.from(new Uint8Array(hashBytes))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const newPath = `recovered/${orgId}/${Date.now()}-${hash}.jpg`;

    await supabase.storage.from('evidence').upload(newPath, data);
    const { data: urlData } = supabase.storage.from('evidence').getPublicUrl(newPath);

    // Update observation (current schema)
    await supabase
      .from('observations')
      .update({ photo_url: urlData.publicUrl, photo_hash: hash })
      .eq('id', observationId)
      .is('photo_url', null);

    // Mark queue item as fixed
    await supabase
      .from('missing_photo_queue')
      .update({
        status: 'fixed',
        original_photo_url: urlData.publicUrl,
        attempted_hash: hash,
        repair_notes: `Recovered from legacy path: ${path}`,
      })
      .eq('observation_id', observationId);

    // Audit log
    await supabase.from('photo_recovery_audit_log').insert({
      observation_id: observationId,
      action: 'photo_restored',
      source: 'legacy_bucket',
      source_ref: path,
      success: true,
      photo_url: urlData.publicUrl,
      photo_hash: hash,
      actor_label: 'admin',
    });

    break;
  }
}
```

### 2.3 Match by Plate + Timestamp Window (ParkPow)

Use the `parkpow-photo-sync` Edge Function to search ParkPow sessions:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/parkpow-photo-sync" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "apply": true,
    "window_minutes": 90,
    "require_empty_photo": true,
    "date_from": "2026-01-01",
    "date_to": "2026-03-23"
  }'
```

Or use the shell script for bulk processing:

```bash
APPLY=true DATE_FROM=2026-01-01 DATE_TO=2026-03-23 \
  WINDOW_MINUTES=90 \
  sh scripts/match-parkpow-photos-to-observations.sh
```

## Phase 3: Manual Review

For observations with `status='manual_required'`:

1. Admin reviews candidate photos in `missing_photo_queue`
2. If correct photo identified:
   - Update observation with `photo_url` and `photo_hash`
   - Mark queue item as `'fixed'`
3. If no photo can be recovered:
   - Option A: Re-capture in field (assign to officer)
   - Option B: Mark observation as `'abandoned'` (non-evidential)

```sql
-- Assign for field re-capture
UPDATE missing_photo_queue
SET
  status = 'manual_required',
  assigned_to = '{officer_id}',
  repair_notes = 'Original photo lost - field re-capture required'
WHERE id = '{queue_item_id}';

-- Accept a manually confirmed photo
UPDATE observations
SET photo_url  = '{confirmed_url}',
    photo_hash = '{sha256_hash}'
WHERE id = '{observation_id}'
  AND (photo_url IS NULL OR photo_hash IS NULL);

UPDATE missing_photo_queue
SET status = 'fixed',
    original_photo_url = '{confirmed_url}',
    attempted_hash = '{sha256_hash}',
    repair_notes = 'Manually confirmed by admin {email}'
WHERE observation_id = '{observation_id}';

INSERT INTO photo_recovery_audit_log (
  observation_id, action, source, success, photo_url, photo_hash, actor_label
) VALUES (
  '{observation_id}', 'observation_updated', 'manual', true,
  '{confirmed_url}', '{sha256_hash}', 'admin:{email}'
);

-- Or abandon observation (mark non-evidential; cannot delete due to evidence rules)
UPDATE missing_photo_queue
SET status = 'abandoned',
    repair_notes = 'Original photo unrecoverable - observation marked non-evidential'
WHERE observation_id = '{observation_id}';

INSERT INTO photo_recovery_audit_log (
  observation_id, action, source, success, error_message, actor_label
) VALUES (
  '{observation_id}', 'abandoned', 'manual', false,
  'Photo unrecoverable', 'admin:{email}'
);
```

## Phase 4: Verification

After backfill complete, verify photo coverage:

```sql
-- Check photo integrity health (uses observations table)
SELECT * FROM photo_integrity_health;

-- Check for remaining orphaned observations
SELECT COUNT(*) AS remaining_orphans
FROM observations
WHERE photo_url IS NULL OR photo_hash IS NULL;

-- Check missing_photo_queue status breakdown
SELECT
  status,
  COUNT(*) AS count,
  MIN(recorded_at) AS oldest_observation,
  MAX(recorded_at) AS newest_observation
FROM missing_photo_queue
GROUP BY status
ORDER BY count DESC;

-- Audit log summary
SELECT action, source, success, COUNT(*) AS count
FROM photo_recovery_audit_log
GROUP BY action, source, success
ORDER BY count DESC;
```

## Phase 5: Verify NOT NULL Enforcement

Once all `missing_photo_queue` items are `'fixed'` or `'abandoned'`, confirm the
`observations` table has no remaining gaps:

```sql
-- Confirm zero remaining gaps
SELECT COUNT(*) AS remaining_orphans
FROM observations
WHERE photo_url IS NULL OR photo_hash IS NULL;
-- Expected: 0
```

The `observations` table already enforces `photo_url text NOT NULL` and
`photo_hash text NOT NULL` in migration `20260221_rebuild_observations_clean.sql`.
No additional migration step is required for new observations.

## Monitoring

Use the `daily-photo-reconciler` Edge Function for continuous monitoring:

```bash
# Trigger daily reconciler manually
curl -X POST "$SUPABASE_URL/functions/v1/daily-photo-reconciler" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Or query the views directly:

```sql
-- Daily photo integrity check (SLO target ≥99.95%)
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

-- Recent observations photo status (last 7 days)
SELECT
  status,
  COUNT(*) AS count
FROM recent_observations_photo_status
GROUP BY status;

-- Should show:
-- ok: ~100%
-- missing_url: 0
-- missing_hash: 0
-- missing_both: 0
```

## Recovery Timeline Estimate

| Phase | Duration | Description |
|-------|----------|-------------|
| Detection | 5 minutes | `detect_missing_photos()` + `photo-recovery` dry-run |
| Automated Recovery | 1-2 hours | ParkPow + PlateRecognizer matching (`apply: true`) |
| Manual Review | 1-3 days | Admin verifies `manual_required` queue items |
| Field Re-capture | 1-2 weeks | Officers re-scan vehicles with unrecoverable photos |
| Verification | 30 minutes | Confirm `missing_photo_queue` empty, check views |

## Success Criteria

- ✅ `photo_integrity_health` shows ≥99.95% coverage for all organisations
- ✅ `missing_photo_queue` has 0 `'pending'` or `'repairing'` items
- ✅ All active observations have non-null `photo_url` AND `photo_hash`
- ✅ `daily-photo-reconciler` runs without new anomalies
- ✅ `photo_recovery_audit_log` provides complete chain-of-custody trail

---

**Status**: Ready to execute
**Owner**: Admin team
**Next Step**: Run `detect_missing_photos()` to populate the queue, then trigger `photo-recovery` with `apply: false` (dry run) first
