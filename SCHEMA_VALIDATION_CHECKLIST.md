# Schema & Wiring Validation Checklist

> ⚠️ **SCHEMA GOVERNANCE — READ BEFORE TOUCHING ANY DATABASE OR DOC FILES**
>
> The live schema is the single source of truth.  
> **No changes may be made to:**
> - `supabase/migrations/` (new or modified SQL)
> - `supabase/functions/` (edge function changes that add/remove DB columns)
> - `src/types/database.ts` or `src/types/index.ts`
> - `docs/LIVE_SCHEMA.md`
> - This file
>
> **…without an approved Pull Request reviewed by `@DonSquires`.**  
> The `.github/CODEOWNERS` file enforces this at the GitHub level.  
> Do **not** run the `supabase-db-push.yml` workflow without approval.  
> See [docs/LIVE_SCHEMA.md](docs/LIVE_SCHEMA.md) for the complete authoritative column listing.

---

## Quick Reference for Audit Findings

> **Last updated:** Schema Extract #20 (2026-03-16 run, main branch)

### 🔴 Critical: Know Which Columns Actually Exist

The most dangerous class of bug is writing to a column that does not exist in the live DB.  
The following columns are **absent from the live schema** — do not add them to any insert/update payload:

**observations (absent):**
- `compliance_summary` — use `compliance_snapshot` instead
- `image_url` — use `photo` (primary) or `photo_url` (secondary)

> ⚠️ **Schema Extract #20 CORRECTION** — `weather_conditions` is **NOT present** in the live
> DB (Schema Extract #20 live `gen types` output does not include it). It was previously listed
> as confirmed present in Schema Extract #8 — that was incorrect.
> The following columns **are confirmed PRESENT** in the live DB (added by migrations
> 20260312000010, 20260401000001):
> `processing_status`, `processing_started_at`, `processing_completed_at`,
> `processing_error`, `plate_confidence`, `vehicle_make_confidence`, `vehicle_model_confidence`,
> `vehicle_color_confidence`, `sticker_presence`, `sticker_color`, `sticker_bbox`,
> `sticker_detection_confidence`, `sticker_color_confidence`,
> `movement_moved`, `movement_background_similarity`, `movement_vehicle_bbox_iou`,
> `movement_decision`, `previous_observation_id`
> They remain in `OPTIONAL_SCHEMA_COLUMNS` only as a safety net for staging databases.

**canonical_vehicles (absent):**
- `id` — PK is `plate_number`; unique UUID is `vehicle_id`
- `make`, `model`, `colour` — live columns are `vehicle_make`, `vehicle_model`, `vehicle_color`
- `body_style`, `nzscv_warrant_number`, `nzscv_expires_on`, `vin`

**breach_alerts (absent):**
- `resolved_by` — use `admin_reviewed_by`
- `detected_at` — added as a generated alias `GENERATED ALWAYS AS (created_at) STORED` by migration `20260313000002`. Verify it exists before using it; if absent, fall back to `created_at`.
- `compliance_result_id` — column exists on the row but is always NULL; the `compliance_results` table **EXISTS** in the live DB (Schema Extract #20: 1,959 rows) but compliance state is ALSO stored directly on `observations` rows. Use `observation_id` to link breach alerts to their source observation.

These are tracked in `supabase/functions/_shared/observationInsert.ts::OPTIONAL_SCHEMA_COLUMNS` so that any stale code that still writes them fails gracefully (schema-cache error → column stripped → retry).

---

#### 1. Observations Table — Correct Column Names

**Validation:**
```sql
-- Confirm PK and key columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'observations'
ORDER BY ordinal_position;
```

**Expected state (critical columns):**

| Column | Type | Notes |
|---|---|---|
| observation_id | uuid | PK — use for joins and lookups |
| id | uuid | nullable alias — not the PK |
| vehicle_year | integer | INTEGER, not text |
| photo | text | PRIMARY photo column |
| photo_url | text | secondary photo column |
| is_compliant | boolean | default true |
| nights_stayed_this_month | integer | default 0 |
| consecutive_nights | integer | default 0 |
| processing_status | text | `pending\|processing\|completed\|failed` — present since 20260312000010 |
| embedding_created_at | timestamptz | set when ALPR embedding written = "ALPR done" |

**If broken:** `adaptiveObservationInsert()` in `_shared/observationInsert.ts` strips unknown columns and retries. Check edge-function logs for "Schema cache missing column" warnings.

---

#### 2. Canonical Vehicles — Correct Column Names

**Validation:**
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'canonical_vehicles'
ORDER BY ordinal_position;
```

**Expected state (critical columns):**

| Column | Type | Notes |
|---|---|---|
| plate_number | text | PK |
| vehicle_id | uuid | unique, use as stable row ref in code |
| vehicle_make | text | NOT `make` |
| vehicle_model | text | NOT `model` |
| vehicle_color | text | NOT `colour` |
| vehicle_year | integer | **INTEGER** (normalised from TEXT by migration `20260411000003`), NOT `year` |
| is_exempt | boolean | NOT NULL, default false |
| is_homeless | boolean | NOT NULL, default false |

**If broken:** Any code writing `make`/`model`/`colour`/`year` to `canonical_vehicles` will fail at the PostgREST schema cache level.

---

#### 3. ALPR Processing State — processing_status Column IS Present

> ⚠️ **Schema Extract #8 CORRECTION** — This section previously stated the column was absent.
> That was incorrect. `processing_status` **exists** in the live `observations` table.

`processing_status` was added by migration `20260312000010_fix_alpr_inference_columns_schema_cache.sql`.  
Valid values (CHECK constraint): `pending | processing | completed | failed`  
Default: `'pending'`

**ALPR completion signals — use in priority order:**

| Signal | Meaning |
|---|---|
| `processing_status = 'completed'` | ALPR pipeline finished successfully |
| `processing_status = 'failed'` | ALPR failed — check `processing_error` for reason |
| `plate_number = 'PROCESSING...'` | ALPR not yet assigned a real plate |
| `plate_number = 'MANUAL_REQUIRED'` | ALPR attempted but needs manual entry |
| `embedding_created_at IS NOT NULL` | Embedding pipeline completed |

Code location: `FieldOfficerPortal.tsx` — `isProcessingAI` check.

---

#### 4. Breach Type Constraint

`breach_alerts.breach_type` has a CHECK constraint. Only these values are valid:

```
consecutive_nights | monthly_limit | self_contained | after_hours | day_visit_violation | allowed_days_violation
```

`breach_alerts.status` constraint:

```
pending | acknowledged | enforcement_started | resolved | dismissed
```

**Validation:**
```sql
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_name LIKE '%breach%';
```

---

#### 5. Compliance Trigger Correctness

Triggers on `observations` run `auto_evaluate_compliance()` on INSERT. The trigger uses COALESCE on compliance columns. If column types drift (e.g. text vs integer), COALESCE will throw:

```
COALESCE types integer and text cannot be matched
```

This is handled by `COMPLIANCE_DRIFT_COLUMNS` in `_shared/observationInsert.ts` (strips `nights_stayed_this_month`, `consecutive_nights`, `is_compliant`, `self_contained`, `breach_type`, `breach_reason` and retries).

**Validation:**
```sql
-- Confirm types are integer (not text)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'observations'
AND column_name IN ('nights_stayed_this_month', 'consecutive_nights');
-- Both must be integer
```

---

#### 6. Zone Compliance Matrix Versioning

**Validation:**
```sql
-- Check for overlapping date ranges per zone (should be 0 rows)
SELECT z1.zone_id, z1.version, z1.effective_to, z2.version, z2.effective_from
FROM zone_compliance_matrix z1
JOIN zone_compliance_matrix z2
  ON z1.zone_id = z2.zone_id AND z2.version = z1.version + 1
WHERE z1.effective_to != z2.effective_from;
```

---

#### 7. RLS Policy Coverage

**Validation:**
```sql
SELECT table_name, row_security
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'user_profiles', 'observations', 'compliance_results',
  'breach_alerts', 'enforcement_actions'
);
-- All must have row_security = 't'
```

---

#### 8. Officer Credential Tracking

Enforcement officers (`role IN ('officer', 'admin_officer')`) must have credentials on file:

```sql
SELECT id, email, role
FROM user_profiles
WHERE role IN ('officer', 'admin_officer')
AND (coa_number IS NULL OR warrant_number IS NULL);
-- Should be empty
```

---

#### 9. Observation Idempotency Key

```sql
-- Check partial unique index exists
SELECT indexname FROM pg_indexes
WHERE tablename = 'observations'
AND indexdef LIKE '%idempotency_key%';
-- Must return a row

-- Find duplicate syncs (should be empty)
SELECT idempotency_key, COUNT(*)
FROM observations
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1;
```

---

#### 10. TypeScript Types in Sync

After any schema change, verify:

```bash
# Both must pass with 0 errors
npx tsc -b --noEmit
```

Files to update together:
1. `src/types/database.ts` — Supabase table types
2. `src/types/index.ts` — Application-level interfaces (`Vehicle`, `Observation`, etc.)
3. `docs/LIVE_SCHEMA.md` — Authoritative schema reference (this doc's source of truth)

---

### 🟡 Moderate Risk

#### 11. Photo Column Priority

The live schema has two photo columns. Always prefer `photo`; fall back to `photo_url`.

Use `getObservationPhotoUrl(observation)` from `src/lib/photoUtils.ts` — never access `.photo_url` directly on observation objects.

**Code must never select only `photo_url` without also selecting `photo`:**
```typescript
// ✅ Correct
.select('photo, photo_url')

// ❌ Wrong — misses primary photo column
.select('photo_url')
```

---

#### 12. Organization overnight_verification_mode

Valid values only:

```
two_photo_verification
one_photo_per_day_inference
```

```sql
SELECT DISTINCT overnight_verification_mode FROM organizations;
-- Should only show the two values above
```

---

### 🟢 Lower Risk

#### 13. Storage Bucket RLS

The `scans` bucket is public-read. Authenticated uploads must go to `/{auth.uid()}/...` paths.

#### 14. Performance Indexes

```sql
SELECT indexname FROM pg_indexes
WHERE tablename IN ('observations', 'compliance_results', 'breach_alerts')
ORDER BY tablename, indexname;
```

---

## Schema Change Approval Process

Before creating any migration or modifying schema-related code, follow this process:

1. **Open a GitHub Issue** describing the change, which columns are being added/removed, and why
2. **Write the migration** in a feature branch — prefix with `YYYYMMDD_` (e.g. `20260401_add_foo_to_observations.sql`)
3. **Update `docs/LIVE_SCHEMA.md`** and both TypeScript type files in the same PR
4. **Request review from `@DonSquires`** — CODEOWNERS enforcement means the PR cannot merge without it
5. **Test on staging** before merging to main/production
6. **Do not run `supabase-db-push.yml`** until the PR is merged and reviewed

---

## Deployment Readiness

> **Schema Extract #8 audit — 2026-03-15**

- ✅ Schema fully documented in `docs/LIVE_SCHEMA.md` (updated to Extract #8)
- ✅ CODEOWNERS enforcing review on schema files and migrations
- ✅ RLS policies in place
- ✅ Adaptive insert handles COALESCE drift and schema-cache misses (`_shared/observationInsert.ts`)
- ✅ `OPTIONAL_SCHEMA_COLUMNS` updated: AI/ALPR columns confirmed present in live DB
- ✅ `canonical_vehicles.vehicle_year` correctly typed as INTEGER (normalised by 20260411000003)
- ✅ `flagged_vehicles.is_active` filter applied in `useFlaggedVehicles` and `useOfficerNotifications`
- ✅ `DataIntegrityDashboard` breach check uses `observation_id` (not dropped `compliance_result_id`)
- ✅ `DataIntegrityDashboard` vehicle check uses `vehicle_id` (not non-existent `id`)
- ⚠️ Monitor edge-function logs for "Schema cache missing column" — indicates code/schema drift
- ⚠️ Run `npx tsc -b --noEmit` before every migration to catch type mismatches


