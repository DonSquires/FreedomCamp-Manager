# ============================================
# LEGACY DATA IMPORT RUNBOOK
# Safe two-pass ETL: Preserve everything, enforce only evidential records
# ============================================

## Overview

This runbook guides you through importing historical observations from pre-photo-first systems while maintaining court-defensible enforcement standards.

**Key Principle**: Import **everything** for reporting/analytics, but enforce **only** on evidential records (original photos present).

---

## Prerequisites

- [x] Deployed `20260219_legacy_import_support.sql` migration
- [x] Access to legacy data exports (CSV, JSON, SQL dumps)
- [x] Access to old storage buckets (if photos exist somewhere)
- [x] Service role credentials for bulk operations

---

## ETL PASS A: Import Core Records (FAST, ZERO DOWNTIME)

### Step 1: Prepare Legacy Data Export

Export from old system:

```sql
-- Example: Export from old build database
SELECT 
  id,
  plate_number,
  organization_id,
  zone_id,
  recorded_at,
  recorded_by,
  gps_latitude,
  gps_longitude,
  notes,
  -- Photo references (may be broken/missing)
  photo_url,
  photo_path,
  -- Metadata
  created_at,
  compliance_status
FROM old_vehicle_records
WHERE recorded_at >= '2023-01-01' -- Or your cutoff date
ORDER BY recorded_at;
```

Save as `legacy_export.csv` or `legacy_export.json`.

### Step 2: Map Old Schema → New Schema

Create mapping table:

| Old Field | New Field | Transformation |
|-----------|-----------|----------------|
| `id` | `observation_id` | Keep UUID or generate new |
| `plate_number` | `plate_number` | Uppercase, trim |
| `organization_id` | `organization_id` | Map old org IDs to new |
| `zone_id` | `zone_id` | Map old zone IDs or create zones |
| `recorded_at` | `recorded_at` | Ensure NZ timezone |
| `recorded_by` | `recorded_by` | Map old user IDs to new |
| `photo_url` | `legacy_note` | Store as "Original URL: {url}" |
| `photo_path` | `legacy_source_tag` | Store old file path for recovery |

### Step 3: Insert Legacy Observations

```typescript
// ETL script (Node.js/TypeScript example)
import { createClient } from '@supabase/supabase-js';
import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const legacyData = parse(readFileSync('legacy_export.csv', 'utf-8'), {
  columns: true,
  skip_empty_lines: true
});

let imported = 0;
let errors = 0;

for (const row of legacyData) {
  try {
    const { data, error } = await supabase
      .from('vehicle_observations_v2')
      .insert({
        observation_id: row.id || crypto.randomUUID(),
        plate_number: row.plate_number?.toUpperCase().trim(),
        organization_id: row.organization_id,
        zone_id: row.zone_id,
        recorded_at: row.recorded_at,
        recorded_by: row.recorded_by,
        gps_latitude: parseFloat(row.gps_latitude),
        gps_longitude: parseFloat(row.gps_longitude),
        
        // CRITICAL: Mark as legacy import
        is_legacy_import: true,
        evidence_state: 'legacy_no_photo', // Will attempt recovery in Pass B
        review_blocked: true, // Non-enforceable until photo recovered
        
        // Preserve provenance
        legacy_source_tag: 'v1_export_2024Q4',
        legacy_note: `Imported from old system. Original photo URL: ${row.photo_url || 'none'}, Path: ${row.photo_path || 'unknown'}`,
        
        // Leave photo fields NULL (will be populated in Pass B if found)
        photo_original_sha256: null,
        photo_original_bytes: null,
        photo_url: null,
        
        // Officer notes (if exists)
        officer_notes: row.notes
      });

    if (error) {
      console.error(`Failed to import observation ${row.id}:`, error.message);
      errors++;
    } else {
      imported++;
      if (imported % 100 === 0) {
        console.log(`Imported ${imported} observations...`);
      }
    }
  } catch (err: any) {
    console.error(`Exception importing ${row.id}:`, err.message);
    errors++;
  }
}

console.log(`\n===========================================`);
console.log(`ETL PASS A COMPLETE`);
console.log(`===========================================`);
console.log(`Successfully imported: ${imported}`);
console.log(`Errors: ${errors}`);
console.log(`Evidence state: All set to 'legacy_no_photo'`);
console.log(`Review blocked: true (non-enforceable until photo recovered)`);
console.log(`\nNext: Run ETL Pass B (evidence recovery)`);
```

### Step 4: Verify Import

```sql
-- Check legacy import summary
SELECT * FROM legacy_import_summary;

-- Should show:
-- total_legacy_observations: {count}
-- recovered_originals: 0 (before Pass B)
-- missing_photos: {count}
-- recovery_rate_pct: 0%

-- Check evidence state distribution
SELECT * FROM evidence_state_distribution;

-- Should show:
-- evidence_state='legacy_no_photo', is_legacy_import=true: {count}
```

---

## ETL PASS B: Evidence Recovery (BEST-EFFORT)

### Step 1: Inventory Old Storage Locations

```typescript
// List potential photo locations
const storagePaths = [
  's3://old-bucket/vehicle-photos/',
  'file:///old-server/fcmanager/uploads/',
  'https://legacy.fcmanager.co.nz/storage/',
  // Add all known old paths
];

// Check which observations have recoverable photo references
const { data: recoveryCandidates } = await supabase
  .from('vehicle_observations_v2')
  .select('observation_id, legacy_note, recorded_at')
  .eq('is_legacy_import', true)
  .eq('evidence_state', 'legacy_no_photo')
  .order('recorded_at', { ascending: false });

console.log(`Found ${recoveryCandidates.length} observations needing photo recovery`);
```

### Step 2: Attempt Photo Recovery

```typescript
import { createHash } from 'crypto';
import { fetch } from 'undici';

for (const obs of recoveryCandidates) {
  // Extract old photo path from legacy_note
  const urlMatch = obs.legacy_note?.match(/Original photo URL: (.+?),/);
  const pathMatch = obs.legacy_note?.match(/Path: (.+?)$/);
  
  const oldUrl = urlMatch?.[1];
  const oldPath = pathMatch?.[1];
  
  if (!oldUrl && !oldPath) {
    console.log(`No photo reference for ${obs.observation_id}, skipping`);
    continue;
  }

  // Try to fetch from old URL
  let photoBlob: Blob | null = null;
  
  if (oldUrl && oldUrl !== 'none') {
    try {
      const response = await fetch(oldUrl, { timeout: 10000 });
      if (response.ok) {
        photoBlob = await response.blob();
        console.log(`✓ Found photo at ${oldUrl}`);
      }
    } catch (err) {
      console.log(`✗ Could not fetch ${oldUrl}`);
    }
  }
  
  // Try old file path (if accessible via network share)
  if (!photoBlob && oldPath && oldPath !== 'unknown') {
    // Implementation depends on how old files are accessible
    // Example: mounted network drive, S3 sync, etc.
  }
  
  if (!photoBlob) {
    console.log(`✗ No photo found for ${obs.observation_id}`);
    continue;
  }

  // Calculate SHA-256 hash
  const arrayBuffer = await photoBlob.arrayBuffer();
  const hash = createHash('sha256').update(Buffer.from(arrayBuffer)).digest('hex');
  
  // Upload to new evidence storage
  const year = new Date(obs.recorded_at).getFullYear();
  const month = String(new Date(obs.recorded_at).getMonth() + 1).padStart(2, '0');
  const newPath = `originals/${obs.organization_id}/${year}/${month}/${obs.observation_id}/${hash}.jpg`;
  
  const { error: uploadError } = await supabase.storage
    .from('evidence')
    .upload(newPath, arrayBuffer, {
      contentType: 'image/jpeg',
      cacheControl: '31536000'
    });
  
  if (uploadError) {
    console.error(`✗ Upload failed for ${obs.observation_id}:`, uploadError.message);
    continue;
  }
  
  // Get public URL
  const { data: publicUrlData } = supabase.storage
    .from('evidence')
    .getPublicUrl(newPath);
  
  // Update observation with recovered photo
  const { error: updateError } = await supabase
    .from('vehicle_observations_v2')
    .update({
      photo_original_sha256: hash,
      photo_original_bytes: arrayBuffer.byteLength,
      photo_url: publicUrlData.publicUrl,
      evidence_state: 'original_present',
      review_blocked: false, // Now enforceable!
      legacy_note: `${obs.legacy_note}\n\n[RECOVERED] Photo recovered from ${oldUrl || oldPath} on ${new Date().toISOString()}`
    })
    .eq('observation_id', obs.observation_id);
  
  if (updateError) {
    console.error(`✗ Update failed for ${obs.observation_id}:`, updateError.message);
  } else {
    console.log(`✓ RECOVERED photo for ${obs.observation_id}`);
  }
}
```

### Step 3: Handle Derived-Only Photos (Watermarked)

```typescript
// If only watermarked versions exist
for (const obs of candidatesWithWatermarkedOnly) {
  // Upload watermarked version
  const derivedPath = `derived/${orgId}/${year}/${month}/${obsId}/watermarked-${hash}.jpg`;
  
  await supabase.storage
    .from('evidence')
    .upload(derivedPath, watermarkedBlob);
  
  // Mark as reconstructed (not fully evidential)
  await supabase
    .from('vehicle_observations_v2')
    .update({
      photo_url: derivedUrl,
      evidence_state: 'reconstructed',
      review_blocked: true, // Still not enforceable without original
      legacy_note: `${obs.legacy_note}\n\n[RECONSTRUCTED] Only watermarked version found - original lost`
    })
    .eq('observation_id', obs.observation_id);
}
```

### Step 4: Mark Unrecoverable as Manual Review

```sql
-- After recovery attempts, mark unrecoverable observations
UPDATE vehicle_observations_v2
SET 
  legacy_note = legacy_note || E'\n\n[UNRECOVERABLE] Photo not found in any legacy storage location. Field re-capture recommended if vehicle seen again.',
  review_blocked = true
WHERE 
  is_legacy_import = true
  AND evidence_state = 'legacy_no_photo'
  AND observation_id IN (
    -- List of observation IDs that could not be recovered
  );

-- Add to recovery opportunities view
-- (Already created by migration - will auto-populate)
```

---

## POST-IMPORT VERIFICATION

### Step 1: Check Recovery Stats

```sql
-- Overall legacy import health
SELECT * FROM legacy_import_summary;

-- Expected output:
-- total_legacy_observations: {imported_count}
-- recovered_originals: {recovered_count}
-- missing_photos: {still_missing_count}
-- recovery_rate_pct: {percentage}

-- Evidence state breakdown
SELECT * FROM evidence_state_distribution
WHERE is_legacy_import = true;
```

### Step 2: Identify High-Priority Recovery Opportunities

```sql
-- Active vehicles with missing legacy photos
SELECT * FROM legacy_recovery_opportunities
WHERE recovery_priority = 'active_vehicle'
LIMIT 20;

-- These are vehicles still being seen - prioritize field re-capture
```

### Step 3: Test Enforcement Guards

```sql
-- Test: Verify legacy_no_photo observations are NOT enforceable
SELECT is_observation_enforceable(observation_id)
FROM vehicle_observations_v2
WHERE is_legacy_import = true
AND evidence_state = 'legacy_no_photo'
LIMIT 5;

-- Expected: {"enforceable": false, "reason": "insufficient_evidence", ...}

-- Test: Verify recovered observations ARE enforceable
SELECT is_observation_enforceable(observation_id)
FROM vehicle_observations_v2
WHERE is_legacy_import = true
AND evidence_state = 'original_present'
LIMIT 5;

-- Expected: {"enforceable": true, ...}
```

---

## UI IMPLEMENTATION

### Step 1: Add Evidence State Badges

```typescript
// ObservationsReport.tsx
function EvidenceStateBadge({ observation }) {
  if (!observation.is_legacy_import) {
    return null; // Live observations always have evidence_state='original_present'
  }

  const badges = {
    legacy_no_photo: {
      label: 'Legacy (No Photo)',
      variant: 'destructive',
      icon: AlertTriangle,
      tooltip: 'Historical record without original photo. Non-enforceable.'
    },
    reconstructed: {
      label: 'Reconstructed',
      variant: 'warning',
      icon: ImageOff,
      tooltip: 'Only watermarked/derived photo available. Non-enforceable without legal review.'
    },
    external_reference: {
      label: 'External Evidence',
      variant: 'secondary',
      icon: FileText,
      tooltip: 'External document reference. Requires legal approval for enforcement.'
    },
    original_present: {
      label: 'Recovered ✓',
      variant: 'success',
      icon: CheckCircle,
      tooltip: 'Original photo recovered. Fully enforceable.'
    }
  };

  const badge = badges[observation.evidence_state];

  return (
    <Badge variant={badge.variant} className="gap-1">
      <badge.icon className="h-3 w-3" />
      {badge.label}
    </Badge>
  );
}
```

### Step 2: Block Enforcement Actions on Non-Evidential Records

```typescript
// EnforcementActions.tsx
async function handleCreateNotice(observationId: string) {
  // Check enforceability first
  const { data: enforcementCheck, error } = await supabase.rpc(
    'is_observation_enforceable',
    { obs_id: observationId }
  );

  if (error || !enforcementCheck?.enforceable) {
    toast.error(
      enforcementCheck?.message || 
      'This observation cannot be used for enforcement due to insufficient evidence.',
      {
        description: `Evidence state: ${enforcementCheck?.evidence_state || 'unknown'}`,
        duration: 7000
      }
    );
    return;
  }

  // Proceed with notice generation...
}
```

### Step 3: Add Export Warning Banner

```typescript
// PDF Export function
async function generateCourtReadyPDF(observationId: string) {
  const { data: obs } = await supabase
    .from('vehicle_observations_v2')
    .select('*')
    .eq('observation_id', observationId)
    .single();

  // Add header banner if not original_present
  const headerBanner = obs.evidence_state !== 'original_present' 
    ? {
        text: '⚠️ WARNING: LEGACY RECORD - NOT SUITABLE FOR COURT SUBMISSION',
        backgroundColor: '#ef4444',
        color: '#ffffff',
        fontSize: 12,
        bold: true,
        margin: [0, 0, 0, 10]
      }
    : null;

  // Include banner in PDF
  const pdfDefinition = {
    header: headerBanner,
    content: [
      // ... rest of PDF content
    ]
  };
}
```

---

## REPORTING & ANALYTICS (KEEP LEGACY VALUE)

### Dashboard Queries

```sql
-- Include legacy in KPI counts (with filter option)
-- Total observations (all time)
SELECT 
  COUNT(*) AS total_observations,
  COUNT(CASE WHEN is_legacy_import = true THEN 1 END) AS legacy_observations,
  COUNT(CASE WHEN is_legacy_import = false THEN 1 END) AS live_observations,
  COUNT(CASE WHEN evidence_state = 'original_present' THEN 1 END) AS enforceable_observations
FROM vehicle_observations_v2;

-- Breach trend including legacy (for longitudinal analysis)
SELECT 
  DATE_TRUNC('month', recorded_at) AS month,
  COUNT(*) AS total_observations,
  COUNT(CASE WHEN is_compliant = false THEN 1 END) AS breaches,
  COUNT(CASE WHEN is_legacy_import = true THEN 1 END) AS legacy_count,
  ROUND(100.0 * COUNT(CASE WHEN is_compliant = false THEN 1 END) / COUNT(*), 2) AS breach_rate_pct
FROM vehicle_observations_v2
WHERE recorded_at >= '2023-01-01'
GROUP BY month
ORDER BY month;
```

### Filter Controls

```typescript
// Add "Include Legacy Data" toggle to filters
<div className="flex items-center gap-2">
  <Switch 
    checked={includeLegacy}
    onCheckedChange={setIncludeLegacy}
  />
  <Label>Include legacy data (pre-2025)</Label>
</div>

// Apply filter in queries
const { data } = await supabase
  .from('vehicle_observations_v2')
  .select('*')
  .eq('is_legacy_import', !includeLegacy ? false : undefined) // Exclude legacy when toggle off
  .gte('recorded_at', dateFrom)
  .lte('recorded_at', dateTo);
```

---

## SUCCESS CRITERIA

After import complete, verify:

- [x] **All legacy observations imported** (check count vs. export)
- [x] **Evidence states correctly set** (legacy_no_photo, original_present, etc.)
- [x] **Review blocking working** (non-evidential records cannot generate notices)
- [x] **UI badges visible** (clear visual distinction for legacy records)
- [x] **Enforcement guards active** (`is_observation_enforceable()` returns false for non-evidential)
- [x] **Reporting includes legacy** (with filter option to exclude)
- [x] **Recovery opportunities identified** (active vehicles, frequent offenders)

---

## MAINTENANCE

### Weekly Recovery Sweep

```typescript
// Cron job: Check for newly available photos in legacy storage
// (In case old backups are restored or files rediscovered)

const { data: stillMissing } = await supabase
  .from('vehicle_observations_v2')
  .select('observation_id, legacy_note')
  .eq('evidence_state', 'legacy_no_photo')
  .limit(100);

// Re-attempt recovery from old paths
// (Same logic as ETL Pass B)
```

### Monthly Legacy Backlog Report

```sql
-- Email to admins: legacy photo recovery progress
SELECT 
  organization_name,
  total_legacy_observations,
  recovered_originals,
  missing_photos,
  recovery_rate_pct,
  ROUND(100.0 * recovered_originals / NULLIF(total_legacy_observations, 0), 2) AS monthly_recovery_rate
FROM legacy_import_summary
ORDER BY missing_photos DESC;
```

---

**Status**: Ready to execute
**Owner**: Admin team + DevOps
**Estimated Time**: 
- Pass A (import): 1-2 hours
- Pass B (recovery): 1-3 days (depending on old storage accessibility)
- Verification: 1 hour

**Next Step**: Deploy `20260219_legacy_import_support.sql` and begin ETL Pass A
