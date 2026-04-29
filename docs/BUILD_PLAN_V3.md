# FieldOps Manager — Complete Build Plan (v3)

> **Purpose**: This is the updated single source of truth for rebuilding FieldOps
> Manager from scratch. It supersedes v2 (`BUILD_PLAN.md`) and reflects the **current,
> live schema as of 2026-04-24**, incorporating every architectural decision, database
> table, Edge Function, frontend page, external integration, and deployment step made
> after the v2 cutoff date of 2026-03-10.
>
> **What changed in v3**: Canonical reference tables for SCV and homeless data, a
> self-service dispute intake system, vehicle discrepancy detection, patrol scheduling
> and KPI tracking, infringement notice artifact storage, zone deduplication, and
> multiple security and RLS hardening patches.
>
> **Read v2 first** — this document describes *deltas* and *new sections* only where
> noted. For foundational context (purpose, users, Railway services, base schema, v1
> inference contract) refer to `docs/BUILD_PLAN.md` (v2). V3 sections that are
> self-contained repeat only the minimum context necessary to be readable standalone.
>
> **Last updated**: 2026-04-24 — schema accurate through migration
> `20260424000001_add_zone_type_to_compliance_breakdown.sql`.

---

## Table of Contents

1. [What Changed Since v2](#1-what-changed-since-v2)
2. [New & Modified Database Tables](#2-new--modified-database-tables)
   - 2.1 [canonical_scv](#21-canonical_scv)
   - 2.2 [canonical_homeless](#22-canonical_homeless)
   - 2.3 [dispute_intake](#23-dispute_intake)
   - 2.4 [vehicle_discrepancies](#24-vehicle_discrepancies)
   - 2.5 [patrol_schedule_zones](#25-patrol_schedule_zones)
   - 2.6 [officer_shifts](#26-officer_shifts)
   - 2.7 [Modified: observations](#27-modified-observations)
   - 2.8 [Modified: infringement_notices](#28-modified-infringement_notices)
   - 2.9 [Modified: flagged_vehicles](#29-modified-flagged_vehicles)
   - 2.10 [Modified: zone_legal_config](#210-modified-zone_legal_config)
   - 2.11 [Modified: patrols](#211-modified-patrols)
   - 2.12 [Modified: user_profiles (roles)](#212-modified-user_profiles-roles)
   - 2.13 [Zone Deduplication Constraint](#213-zone-deduplication-constraint)
3. [New Storage Buckets](#3-new-storage-buckets)
4. [New & Updated RPC Functions](#4-new--updated-rpc-functions)
5. [Row-Level Security Additions](#5-row-level-security-additions)
6. [Supabase Edge Functions (v3 Additions)](#6-supabase-edge-functions-v3-additions)
7. [Authoritative Data Source Architecture](#7-authoritative-data-source-architecture)
8. [SCV Enforcement Law Date](#8-scv-enforcement-law-date)
9. [Frontend: New and Updated Pages](#9-frontend-new-and-updated-pages)
10. [Build, Lint & Deploy](#10-build-lint--deploy)
11. [V3 Learnings & Pitfalls](#11-v3-learnings--pitfalls)

---

## 1. What Changed Since v2

### 1.1 Summary of Major Changes

| Area | Change | Migration(s) |
|---|---|---|
| SCV source of truth | `canonical_scv` table replaces `canonical_vehicles.self_contained` for all lookups | `20260421000001` |
| Homeless source of truth | `canonical_homeless` table replaces `canonical_vehicles.homeless_status` | `20260421000001` |
| Dispute management | `dispute_intake` table + `submit-dispute-intake` edge function | `20260418000006-007` |
| Vehicle discrepancy tracking | `vehicle_discrepancies` table + `has_discrepancies`/`discrepancy_flags` on `observations` | `20260406000001` |
| Infringement notices | Full schema fix + HTML artifact storage (`notice-artifacts` bucket) | `20260411000001`, `20260417000003` |
| Flagged vehicles | 9 missing operational columns added | `20260415000001` |
| Zone legal config | Payment channels + objections contact + dispute portal URL | `20260418000002`, `20260418000006` |
| Patrol scheduling | `patrol_schedule_zones` junction table + schedule/duration columns on `patrols` | `20260409000002` |
| Patrol KPIs | `get_patrol_kpis()` RPC | `20260409000002` |
| Roles | `nzscv_monitor` role added to `user_profiles.role` | `20260419000001` |
| Compliance breakdown | `get_zone_compliance_breakdown` now returns `zone_type` + `parent_zone_id` | `20260424000001` |
| Zone deduplication | Unique partial index on `(organization_id, lower(name))` | `20260403000001` |
| Vehicle attribute sources | `vehicle_attribute_sources` JSONB on `observations` | `20260417000001` |
| Utility RPCs | `set_org_geometry`, `check_compliance`, `safe_insert_observation` | `20260418000005`, `20260404000001` |
| Audit log RLS | Hardened to prevent authenticated users reading other orgs' audit rows | `20260423000002` |
| Zone assignment backfill | `backfill_child_zone_parent_ids` migration | `20260420000001` |
| Breach alert dedup | DB-level deduplication of open breach alerts | `20260418000004` |

### 1.2 Breaking Changes from v2

1. **SCV lookups must use `canonical_scv`** — any code reading `canonical_vehicles.self_contained` for compliance decisions is now wrong. See §7.
2. **Homeless lookups must use `canonical_homeless`** — `canonical_vehicles.homeless_status` is no longer authoritative. See §7.
3. **`infringement_notices` schema** — new canonical columns are `amount_cents` (integer, cents), `due_date` (DATE), `created_by` (UUID ref). Old `fee_amount`/`payment_deadline`/`issued_by` columns still exist for backward compat but should not be used in new code.
4. **`flagged_vehicles`** — was treated as deprecated in v2 ("merged into `canonical_vehicles.is_flagged`"). V3 un-deprecates it: the table has 9 new operational columns and is still actively written by `process-homeless-data` and read by the frontend.
5. **`user_profiles.role`** — now allows `'nzscv_monitor'` in addition to the four v2 roles.
6. **Zone "Other Location" renamed** — each org's fallback zone is now named `"<OrgName> - Other Location"` (not `"Other Location"`). This is required by the uniqueness constraint.

---

## 2. New & Modified Database Tables

### 2.1 `canonical_scv`

**Purpose**: Single canonical record of Self-Contained Vehicle (SCV) certification per
plate. Replaces `canonical_vehicles.self_contained` as the authoritative SCV source.

```sql
CREATE TABLE public.canonical_scv (
  plate_number       TEXT PRIMARY KEY,
  is_self_contained  BOOLEAN NOT NULL DEFAULT false,
  certificate_expiry DATE,
  source             TEXT DEFAULT 'unknown',
    -- 'scv_list' | 'nzscv_api' | 'photo_analysis' | 'manual'
  verified_at        TIMESTAMPTZ,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Key indexes**:
- `idx_canonical_scv_self_contained` — partial index WHERE `is_self_contained = true`
- `idx_canonical_scv_expiry` — partial index WHERE `certificate_expiry IS NOT NULL`

**RLS**:
- `authenticated` → SELECT all rows (global registry, not org-scoped)
- `service_role` → ALL (used by `sync-scv-list`, `cleanup-and-recalculate`)
- Admins (role in `admin`, `admin_officer`, `master`) → INSERT/UPDATE via policy `rls_canonical_admin_write` (migration `20260423000001`)

**Populated by**: `sync-scv-list` edge function (authoritative batch import); also written
by `check-nzscv-status`, `analyze-vehicle-photo`, and `process-officer-scan` (live
lookups / scan events).

**Important**: `sync-scv-list` writes **both** `is_self_contained = true` rows (confirmed
SCV) and **explicit `is_self_contained = false` rows** (plates that were previously SCV
but have been removed from the registry). A missing row means "unknown", not "not SCV".

---

### 2.2 `canonical_homeless`

**Purpose**: Cross-org canonical record of homeless vehicle designations per plate.
Replaces `canonical_vehicles.homeless_status` as the authoritative homeless source.

```sql
CREATE TABLE public.canonical_homeless (
  plate_number  TEXT PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'unknown',
    -- 'confirmed' | 'suspected' | 'cleared' | 'unknown'
  confirmed_by  UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  source        TEXT DEFAULT 'unknown',
    -- 'homeless_data_import' | 'officer_observation' | 'manual' | 'dispute_resolution'
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**RLS**:
- `authenticated` → SELECT all rows
- `service_role` → ALL
- Admins → INSERT/UPDATE via `rls_canonical_admin_write` policy

**Populated by**: `process-homeless-data` edge function; also updated by dispute
resolution workflow and officer manual override.

---

### 2.3 `dispute_intake`

**Purpose**: Public and staff-submitted disputes/challenges for notices, infringements,
and hardship/homeless claims. Supports the dispute portal linked from the infringement
notice PDF footer.

```sql
CREATE TABLE public.dispute_intake (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  zone_id               UUID REFERENCES public.zones(id) ON DELETE SET NULL,
  source_type           TEXT NOT NULL CHECK (source_type IN (
                          'notice_to_vacate','infringement','homeless_status','other')),
  source_reference      TEXT,        -- notice_number or observation_id
  plate_number          TEXT,
  claimant_name         TEXT,
  claimant_email        TEXT,
  claimant_phone        TEXT,
  message               TEXT NOT NULL,
  request_homeless_review BOOLEAN NOT NULL DEFAULT false,
  hardship_context      TEXT,
  evidence_statement    TEXT,
  submitted_via         TEXT NOT NULL DEFAULT 'public_portal',
  status                TEXT NOT NULL DEFAULT 'received' CHECK (status IN (
                          'received','under_review','info_requested',
                          'upheld','varied','rejected','closed')),
  assigned_to           UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  admin_notes           TEXT,
  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Key indexes**:
- `idx_dispute_intake_org_status (organization_id, status, submitted_at DESC)`
- `idx_dispute_intake_plate (plate_number, submitted_at DESC)`
- `idx_dispute_intake_reference (source_reference)`

**RLS**:
- Admins/master → SELECT and UPDATE for their org
- `service_role` → ALL (for `submit-dispute-intake` edge function which accepts
  unauthenticated public submissions)

**Important**: The `submit-dispute-intake` edge function does **not** require
authentication. It uses `SUPABASE_SERVICE_ROLE_KEY` to insert the row. This means the
edge function must validate input carefully and rate-limit by IP.

**Zone integration**: `zone_legal_config.dispute_portal_url` stores the public URL for
each zone's dispute portal. This URL is embedded in generated infringement notice PDFs.

---

### 2.4 `vehicle_discrepancies`

**Purpose**: Records detected conflicts between data sources (NZSCV, inference AI,
canonical_vehicles, MotorWeb, ALPR) for the same vehicle. Supports the Freedom Camping
(Self-Contained Vehicles) Amendment Act enforcement from 1 June 2026.

```sql
CREATE TABLE public.vehicle_discrepancies (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  observation_id   UUID NOT NULL REFERENCES public.observations(observation_id) ON DELETE CASCADE,
  plate_number     TEXT,
  organization_id  UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  zone_id          UUID REFERENCES public.zones(id) ON DELETE SET NULL,
  discrepancy_type TEXT NOT NULL,
    -- 'make_mismatch' | 'model_mismatch' | 'colour_mismatch'
    -- 'plate_mismatch_same_vehicle' | 'sc_sticker_not_in_register'
    -- 'sc_in_register_no_sticker' | 'sc_sticker_inconclusive'
  source_a         TEXT NOT NULL,   -- 'canonical' | 'nzscv' | 'inference' | 'motorweb' | 'alpr'
  source_b         TEXT NOT NULL,
  value_a          TEXT,
  value_b          TEXT,
  severity         TEXT NOT NULL DEFAULT 'warning',  -- 'warning' | 'critical'
  sc_law_active    BOOLEAN DEFAULT false,
  details          JSONB,
  requires_review  BOOLEAN DEFAULT true,
  reviewed_by      UUID REFERENCES public.user_profiles(id),
  reviewed_at      TIMESTAMPTZ,
  review_notes     TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);
```

**Key indexes**: `(observation_id)`, `(plate_number, created_at DESC)`,
`(organization_id, severity, requires_review)`, `(requires_review)` partial index.

**RLS**: Org-scoped admin read; officers read own observations' discrepancies; service
role ALL.

**Linked columns on `observations`**:
- `has_discrepancies` BOOLEAN DEFAULT false — set true when any discrepancy is created
- `discrepancy_flags` JSONB — summary array `[{type, severity, source_a, source_b, value_a, value_b}]`

**Severity escalation**: Before 2026-06-01 all discrepancies are `'warning'`. From
2026-06-01 (`sc_law_active = true`), SC sticker vs registry mismatches become `'critical'`.

---

### 2.5 `patrol_schedule_zones`

**Purpose**: Ordered list of zones assigned to a patrol. Tracks estimated vs actual visit
durations for KPI reporting.

```sql
CREATE TABLE public.patrol_schedule_zones (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patrol_id                 UUID NOT NULL REFERENCES patrols(id) ON DELETE CASCADE,
  zone_id                   UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  visit_order               INTEGER NOT NULL DEFAULT 0,
  estimated_duration_minutes INTEGER,
  actual_duration_minutes   INTEGER,
  visited_at                TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (patrol_id, zone_id)
);
```

**RLS**: Org members read; admins manage; officers update their own patrol's zone rows.

---

### 2.6 `officer_shifts`

**Purpose**: Tracks officer shift windows (start/end GPS, duration). Referenced by patrols
for scheduling FK purposes. Created by `20260409000002` with a guard for databases where
it may have been created earlier.

```sql
CREATE TABLE public.officer_shifts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id      UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_zone_id  UUID        REFERENCES public.zones(id) ON DELETE SET NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  end_reason      TEXT CHECK (end_reason IN ('logout','app_timeout','manual','zone_exit')),
  gps_start_lat   DOUBLE PRECISION,
  gps_start_lng   DOUBLE PRECISION,
  gps_end_lat     DOUBLE PRECISION,
  gps_end_lng     DOUBLE PRECISION,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Key indexes**: `(officer_id, started_at DESC)`, `(organization_id, started_at DESC)`,
partial `(officer_id)` WHERE `ended_at IS NULL`.

**RLS**: Officers read/insert/update own shifts; admins read org shifts.

---

### 2.7 Modified: `observations`

Three new columns added post-v2:

| Column | Type | Purpose |
|---|---|---|
| `vehicle_attribute_sources` | JSONB | Tracks source of make/model/colour/year for each observation. See structure below. |
| `has_discrepancies` | BOOLEAN DEFAULT false | Set true when `vehicle_discrepancies` rows exist for this observation |
| `discrepancy_flags` | JSONB | Summary array of discrepancy objects for quick UI rendering |

**`vehicle_attribute_sources` structure**:
```json
{
  "make_source":   "nzscv" | "canonical" | "inference" | "alpr" | null,
  "model_source":  "nzscv" | "canonical" | "inference" | "alpr" | null,
  "color_source":  "nzscv" | "canonical" | "inference" | "alpr" | null,
  "year_source":   "nzscv" | "canonical" | "inference" | "alpr" | null
}
```

This field is written by `process-officer-scan` and `cleanup-and-recalculate` to provide
auditability for where each attribute value came from.

---

### 2.8 Modified: `infringement_notices`

The v1/v2 schema was only partially applied in many deployments. V3 defines the complete
canonical schema including all column aliases:

**New/corrected columns** (added by `20260411000001`):

| Column | Type | Notes |
|---|---|---|
| `amount_cents` | INTEGER | Fee in cents — use this in all new code |
| `due_date` | DATE | Payment due date — use this in all new code |
| `created_by` | UUID → user_profiles | Use this instead of `issued_by` in new code |
| `notice_html_path` | TEXT | Private Storage object path for the rendered HTML artifact |
| `notice_html_hash` | TEXT | SHA-256 hash of the stored HTML artifact |

**Legacy columns still present** (do not use in new code):
- `fee_amount NUMERIC(10,2)` — superseded by `amount_cents`
- `payment_deadline DATE` — superseded by `due_date`
- `issued_by UUID` — superseded by `created_by`

**Backfill rule**: `amount_cents = CAST(fee_amount * 100 AS INTEGER)` applied automatically
by migration.

**Full status lifecycle**:
```
draft → issued → paid
              → reminder_sent → paid
              → court_referred
              → withdrawn
              → cancelled
```

**Storage**: HTML artifacts for printable notices are stored in the `notice-artifacts`
bucket (see §3). Path format: `infringements/<org_id>/<notice_id>.html`.

---

### 2.9 Modified: `flagged_vehicles`

**Status**: **Active** (not deprecated). V3 un-deprecates this table. The plan to merge
into `canonical_vehicles.is_flagged` is deferred until all callers are migrated.

New columns added by `20260415000001`:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `notes` | TEXT | NULL | Officer/system notes; appended on successive imports |
| `is_active` | BOOLEAN | true | false = soft-deleted/resolved flag |
| `last_known_site` | TEXT | NULL | Last known camping site from homeless data import |
| `date_recorded` | DATE | NULL | Date the safety concern was first recorded |
| `vehicle_description` | TEXT | NULL | Physical description from homeless data source |
| `name_contact` | TEXT | NULL | Contact name associated with this vehicle/occupant |
| `confirmed_homeless` | BOOLEAN | false | true when homeless status confirmed by data source |
| `created_by` | UUID → user_profiles | NULL | Who created the flag record |
| `attachments` | JSONB | `[]` | Array of file attachment references |

**Key indexes**:
- `idx_flagged_vehicles_active (organization_id, is_active)` WHERE `is_active = true`
- `idx_flagged_vehicles_plate_org (plate_number, organization_id)`

---

### 2.10 Modified: `zone_legal_config`

New columns added across two migrations:

**Payment channels** (added by `20260418000002`):

| Column | Type | Purpose |
|---|---|---|
| `payment_online_url` | TEXT | Public URL for online infringement payments |
| `payment_bank_account` | TEXT | Bank account number for direct payments |
| `payment_instructions` | TEXT | Free-text instructions shown on the notice |
| `objections_email` | TEXT | Email address for written objections |
| `objections_postal_address` | TEXT | Postal address for written objections |

**Dispute portal** (added by `20260418000006`):

| Column | Type | Purpose |
|---|---|---|
| `dispute_portal_url` | TEXT | Public URL embedded in notices for online disputes |

These fields are embedded into generated infringement notice PDFs by the
`generate-infringement` edge function.

---

### 2.11 Modified: `patrols`

New scheduling and timing columns added by `20260409000002`:

| Column | Type | Purpose |
|---|---|---|
| `scheduled_start_time` | TIMESTAMPTZ | Planned start time from schedule |
| `scheduled_end_time` | TIMESTAMPTZ | Planned end time from schedule |
| `actual_start_time` | TIMESTAMPTZ | Recorded actual start (set on patrol start) |
| `actual_end_time` | TIMESTAMPTZ | Recorded actual end (set on patrol end) |
| `duration_minutes` | INTEGER | Computed patrol duration in minutes |

These columns feed the `get_patrol_kpis()` RPC for punctuality and completion reporting.

---

### 2.12 Modified: `user_profiles` (roles)

The `role` CHECK constraint now allows five values:

```sql
CHECK (role IN ('master', 'admin', 'officer', 'admin_officer', 'nzscv_monitor'))
```

**`nzscv_monitor`** — Read-only role for monitoring the NZSCV registry and SCV status.
Cannot create observations, issue notices, or access breach alerts.

**Role matrix update**:

| Feature | master | admin | admin_officer | officer | nzscv_monitor |
|---|---|---|---|---|---|
| View canonical_scv | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit canonical_scv | ✓ | ✓ | ✓ | — | — |
| View dispute_intake | ✓ | ✓ | ✓ | — | — |
| Resolve disputes | ✓ | ✓ | ✓ | — | — |
| View vehicle_discrepancies | ✓ | ✓ | ✓ | own obs | — |
| View patrol KPIs | ✓ | ✓ | ✓ | own | — |

---

### 2.13 Zone Deduplication Constraint

Migration `20260403000001` applied a partial unique index to prevent future duplicate zones:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS zones_unique_name_per_org
  ON public.zones (organization_id, lower(trim(name)))
  WHERE is_active = true;
```

**Breaking change**: Attempting to insert a zone with the same (org, lowercase-trimmed name)
as an existing active zone will now fail with a unique constraint violation.

**"Other Location" rename**: Every org's fallback zone was renamed from `"Other Location"`
to `"<OrgName> - Other Location"` during migration to satisfy the uniqueness constraint.
The `ensure_other_location_zone()` RPC still works correctly — it creates/retrieves a zone
named `"<OrgName> - Other Location"`.

---

## 3. New Storage Buckets

### `notice-artifacts`

| Property | Value |
|---|---|
| Bucket ID | `notice-artifacts` |
| Public | false (private) |
| File size limit | 5 MB |
| Allowed MIME types | `text/html` |
| Path format | `infringements/<org_uuid>/<notice_id>.html` |

**RLS policies on `storage.objects`**:

- `notice_artifacts_org_select` — authenticated users in the owning org can SELECT
  (split on path `infringements/<org>/<file>`)
- `notice_artifacts_admin_delete` — admins of the owning org can DELETE

**⚠️ If creating bucket fails**: The migration catches `insufficient_privilege` and logs
a warning. In that case, create the bucket manually in the Supabase Dashboard and run:
```sql
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA storage TO authenticated;
```

---

## 4. New & Updated RPC Functions

### New: `get_patrol_kpis()`

```sql
get_patrol_kpis(
  p_organization_id UUID,
  p_from            TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_to              TIMESTAMPTZ DEFAULT now(),
  p_officer_id      UUID DEFAULT NULL
) RETURNS JSONB
```

Returns a JSONB object with:
- `total_patrols`, `completed`, `scheduled`, `in_progress`, `cancelled`
- `avg_duration_minutes`
- `total_vehicles_checked`, `total_breaches`, `breach_rate_pct`
- `on_time_starts`, `late_starts`, `punctuality_pct`
- `total_site_visits`, `avg_site_visit_minutes`
- `total_shift_hours`
- `officer_stats` (array, one entry per officer if `p_officer_id` is null)

`GRANT EXECUTE ON FUNCTION get_patrol_kpis TO authenticated;`

---

### New: `set_org_geometry()`

```sql
set_org_geometry(org_id UUID, geojson JSONB) RETURNS VOID
```

Parses a GeoJSON polygon using `ST_GeomFromGeoJSON` and persists it to
`organizations.boundary` (PostGIS geometry column). Raises an exception for invalid GeoJSON.

Called by `OrganizationBoundaryEditor.tsx`.

`GRANT EXECUTE ON FUNCTION set_org_geometry(UUID, JSONB) TO authenticated;`

---

### New: `check_compliance()`

```sql
check_compliance(
  p_plate_number TEXT,
  p_zone_id      UUID,
  p_recorded_at  TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
```

Returns a compliance assessment JSONB for a plate at a zone. Used by
`SpatialComplianceMap.tsx` for map-level compliance overlays. Internally calls
`calculate_vehicle_compliance_v3()`.

`GRANT EXECUTE ON FUNCTION check_compliance TO authenticated;`

---

### New: `safe_insert_observation()`

```sql
safe_insert_observation(p_data JSONB) RETURNS JSONB
```

Emergency fallback RPC that inserts an observation while temporarily bypassing all
triggers (`SET LOCAL session_replication_role = 'replica'`). Exists to prevent
`scan failed` errors when the `auto_evaluate_compliance()` trigger is broken by
column-type drift (the recurring `"COALESCE types integer and text cannot be matched"`
error). Not for normal use — prefer the standard `observations` INSERT.

---

### Updated: `get_zone_compliance_breakdown()`

Now returns two additional columns:

| Column | Type | Purpose |
|---|---|---|
| `zone_type` | TEXT | Zone type (e.g. `'general'`, `'specific'`, `'jurisdiction'`) |
| `parent_zone_id` | UUID | NULL for top-level jurisdictions; set for child zones |

**Frontend usage**: `ComplianceDashboard` uses `parent_zone_id IS NULL` to separate the
"Jurisdiction" tab (parent zones) from the "By Zone" tab (child zones).

---

### Updated: `ensure_other_location_zone()`

Now creates zones named `"<OrgName> - Other Location"` instead of `"Other Location"`.
This is required by the zone uniqueness constraint (§2.13).

---

## 5. Row-Level Security Additions

### 5.1 `canonical_scv` and `canonical_homeless`

- **All authenticated users** can SELECT (global registry not org-scoped).
- **Admins** (role in `admin`, `admin_officer`, `master`) can INSERT and UPDATE via:
  ```sql
  -- Migration: 20260423000001_rls_canonical_admin_write.sql
  CREATE POLICY "admins_write_canonical_scv" ON canonical_scv
    FOR INSERT OR UPDATE TO authenticated
    USING (get_user_role(auth.uid()) = ANY(ARRAY['admin','admin_officer','master']));
  ```
- **`service_role`** retains full ALL access.

### 5.2 `audit_log` hardening

Migration `20260423000002` tightened the `audit_log` SELECT policy so authenticated
users can only read audit rows for their own organisation:

```sql
CREATE POLICY "audit_log_org_select" ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    organization_id = ANY(get_user_organization_ids())
    OR get_user_role(auth.uid()) = 'master'
  );
```

Previously any authenticated user could read all audit logs. **This is a security fix.**

### 5.3 `officer_enforcement_update_policy`

Migration `20260417000002` adds a fine-grained UPDATE policy allowing officers to
update only the fields they need during an active enforcement action, without granting
full `UPDATE` on `observations`:

```sql
-- Officers may update evidence/status fields on their own observations
CREATE POLICY "officer_enforcement_update"
  ON public.observations FOR UPDATE TO authenticated
  USING (recorded_by = auth.uid())
  WITH CHECK (recorded_by = auth.uid());
```

---

## 6. Supabase Edge Functions (v3 Additions)

The following functions are **new since v2**. All other functions are listed in
`BUILD_PLAN.md` §8.

| Function | Trigger | Purpose |
|---|---|---|
| `submit-dispute-intake` | HTTP POST (unauthenticated) | Accepts public dispute submissions and inserts into `dispute_intake`. Validates input, rate-limits, and sends acknowledgment email. |
| `public-case-lookup` | HTTP GET (unauthenticated) | Allows notice recipients to look up a case by notice number and plate, returning limited non-PII information for the dispute portal. |

### `submit-dispute-intake`

```
POST /functions/v1/submit-dispute-intake
Content-Type: application/json

{
  "source_type":   "notice_to_vacate" | "infringement" | "homeless_status" | "other",
  "source_reference": "NT-2026-XXXX",
  "plate_number":  "ABC123",
  "claimant_name": "Jane Smith",
  "claimant_email": "jane@example.com",
  "message": "I dispute this notice because ...",
  "request_homeless_review": false,
  "hardship_context": null
}
```

**Authentication**: None required (public-facing). Uses service role key internally.

**Rate limiting**: IP-based, 3 submissions per 10 minutes (enforced at edge function level
via in-memory counter; consider Upstash Redis for production).

**Response**:
```json
{ "success": true, "intake_id": "<uuid>" }
```

### `public-case-lookup`

```
GET /functions/v1/public-case-lookup?notice_number=NT-2026-XXXX&plate=ABC123
```

**Authentication**: None required. Returns only non-PII case summary:
- notice number, status, offence date, zone name, dispute portal URL
- Does NOT return officer names, GPS coordinates, or recipient PII

---

## 7. Authoritative Data Source Architecture

This section supersedes the SCV and homeless lookup guidance in v2.

### 7.1 SCV (Self-Contained Vehicle) Lookups

**Authoritative source**: `canonical_scv` table.

**Lookup order** (in all edge functions):
1. Check `canonical_scv` by `plate_number`.
2. If found: use `is_self_contained` and `certificate_expiry` from that row.
3. If NOT found: fall back to NZSCV API call via proxy.
4. Never read `canonical_vehicles.self_contained` for compliance decisions.

**Functions updated**:
- `process-officer-scan` (Step 5)
- `recalculate-compliance-v3`
- `cleanup-and-recalculate`
- `vehicle-ingest`
- `check-nzscv-status`
- `analyze-vehicle-photo`
- DB trigger on `canonical_vehicles`

**`analyze-vehicle-photo` protection**: Must NOT overwrite `canonical_scv` with NZSCV API
results when `canonical_scv` already has `is_self_contained = true`. The
`canonicalHasSCVData` flag guards this.

### 7.2 Homeless Status Lookups

**Authoritative source**: `canonical_homeless` table.

**Lookup order**:
1. Check `canonical_homeless` by `plate_number`.
2. If found: use `status` field.
3. If NOT found: status is `'unknown'`.
4. Never read `canonical_vehicles.homeless_status` for compliance decisions.

### 7.3 Vehicle Attributes (Make/Model/Year/Colour)

**Source**: `canonical_vehicles` table — this table remains authoritative for vehicle
descriptive attributes. `canonical_scv` and `canonical_homeless` are for status only.

### 7.4 `vehicle_attribute_sources` Tracking

When `process-officer-scan` or `cleanup-and-recalculate` writes vehicle attributes to
an observation, it also writes `vehicle_attribute_sources` to record where each attribute
came from:

```json
{
  "make_source":  "nzscv",
  "model_source": "canonical",
  "color_source": "inference",
  "year_source":  "canonical"
}
```

Source priority (highest to lowest): `nzscv` → `canonical` → `inference` → `alpr`.

---

## 8. SCV Enforcement Law Date

**The Freedom Camping (Self-Contained Vehicles) Amendment Act enforcement date is
1 June 2026.**

Before this date:
- SC sticker vs registry discrepancies are logged as `severity = 'warning'`
- `vehicle_discrepancies.sc_law_active = false`

From 2026-06-01:
- SC sticker vs registry mismatches become `severity = 'critical'`
- `vehicle_discrepancies.sc_law_active = true`
- Compliance engine enforces `self_contained_required` zones strictly

All edge functions that detect SC discrepancies check `nz_now() >= '2026-06-01'::date`
to determine severity.

---

## 9. Frontend: New and Updated Pages

### New Pages (v3)

| Page | Path | Role | Description |
|---|---|---|---|
| `DisputeManagement` | `/admin/disputes` | admin, admin_officer, master | Review and action `dispute_intake` records. Assign, update status, add admin notes. |
| `DisputeIntakePortal` | `/dispute` (public) | None | Public-facing form for submitting disputes. Calls `submit-dispute-intake`. |
| `VehicleDiscrepancies` | `/admin/discrepancies` | admin, admin_officer, master | Review `vehicle_discrepancies` requiring manual review. Mark reviewed. |
| `PatrolScheduler` | `/admin/patrols/schedule` | admin, admin_officer | Create and manage patrol schedules with `patrol_schedule_zones`. |
| `PatrolKPIReport` | `/admin/patrols/kpis` | admin, master | KPI dashboard using `get_patrol_kpis()` RPC. |
| `NZSCVMonitor` | `/admin/nzscv` | admin, master, nzscv_monitor | Monitor `canonical_scv` table, trigger `sync-scv-list`. |

### Updated Pages (v3)

| Page | Change |
|---|---|
| `ComplianceDashboard` | Uses `zone_type` + `parent_zone_id` from `get_zone_compliance_breakdown()` to split Jurisdiction vs Zone tabs |
| `InfringementNotices` | Uses `amount_cents` + `due_date` + `created_by`; generates HTML artifacts to `notice-artifacts` bucket |
| `VehicleDetailPage` | Shows `vehicle_attribute_sources` provenance badges; links to `vehicle_discrepancies` |
| `ZoneManagement` | Enforces zone uniqueness constraint; shows zone deduplication warnings |
| `ZoneLegalConfig` | New fields: payment channels, objections contact, dispute portal URL |
| `BreachAlerts` | DB-level dedup applied; frontend dedup still runs as safety net |
| `PersonRecords` | Shows `canonical_homeless` status alongside `flagged_vehicles` |
| `AdminDashboard` | New KPI cards: open disputes, discrepancies requiring review, SCV enforcement countdown |

---

## 10. Build, Lint & Deploy

This section augments v2 §13. All existing build commands remain valid.

### 10.1 Build Commands (unchanged)

```bash
# Create root package.json if missing (no root package.json is committed)
cat > package.json << 'EOF'
{
  "name": "vite_react_shadcn_ts",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  }
}
EOF

bun install
bun run build   # TypeScript + Vite — must pass before deploy
bun run lint    # ESLint 9 flat config
```

### 10.2 New Environment Variables (v3)

In addition to the variables documented in v2, the following are required:

| Variable | Where | Purpose |
|---|---|---|
| `DISPUTE_RATE_LIMIT_PER_10MIN` | Edge function secret | Max dispute submissions per IP per 10 minutes (default: 3) |
| `DISPUTE_ACK_EMAIL_FROM` | Edge function secret | From address for dispute acknowledgment emails |

### 10.3 Migration Deployment Order (v3 migrations only)

Apply in this exact sequence (they have dependencies):

```
20260401000001  # scan pipeline schema fix
20260401000002  # hotfix coalesce type mismatch
20260402000001  # breach alert observation lookup
20260402000002  # observation_id column priority
20260403000001  # deduplicate zones (DATA MIGRATION — irreversible)
20260403000002  # update_other_location_zone_rpc
20260404000001  # safe_insert_observation RPC
20260404000002  # restore safe insert pipeline
20260405000001  # fix zone compliance breakdown count
20260406000001  # vehicle_discrepancies
20260407000001  # fix safe_insert no replication role
20260408000001  # fix vehicle year integer cast
20260409000001  # fix populate observation vehicle year cast
20260409000002  # patrol schedule & KPIs
20260410000001  # fix patrol auto start
20260411000001  # infringement_notices missing columns
20260411000002  # fix observation_id PK in functions
20260411000003  # normalise canonical_vehicle year to integer
20260415000001  # flagged_vehicles missing columns
20260416000001  # fix vehicle_observations v2 normalisation
20260417000001  # vehicle_attribute_sources column
20260417000002  # officer enforcement update policy
20260417000003  # notice artifact storage (creates bucket)
20260418000001  # reapply vehicle_observations v2 normalisation
20260418000002  # zone_legal_config notice contact fields
20260418000003  # cleanup legacy trigger paths
20260418000004  # deduplicate open breach alerts (DATA MIGRATION)
20260418000005  # missing utility RPCs
20260418000006  # dispute portal and intake
20260418000007  # dispute intake homeless fields
20260419000001  # nzscv_monitor role
20260420000001  # backfill child zone parent_ids (DATA MIGRATION)
20260421000001  # canonical_scv and canonical_homeless tables (DATA MIGRATION)
20260422000001  # fix zones legal columns schema cache
20260422000002  # fix trigger canonical_scv_homeless_lookup
20260423000001  # rls canonical admin write
20260423000002  # harden audit log RLS (SECURITY FIX)
20260424000001  # add zone_type to compliance breakdown
```

**DATA MIGRATION warnings**:
- `20260403000001` deduplicates zones — irreversible. Back up `zones` table first.
- `20260418000004` deduplicates open breach alerts — irreversible. Back up `breach_alerts`.
- `20260420000001` backfills `parent_zone_id` — safe but runs a full table scan.
- `20260421000001` backfills `canonical_scv` and `canonical_homeless` from existing
  `canonical_vehicles` data — may take several seconds on large datasets.

### 10.4 Edge Function Deployment (v3 additions)

```bash
supabase functions deploy submit-dispute-intake
supabase functions deploy public-case-lookup
```

Set secrets:
```bash
supabase secrets set DISPUTE_RATE_LIMIT_PER_10MIN=3
supabase secrets set DISPUTE_ACK_EMAIL_FROM=noreply@ironeaglesecurity.co.nz
```

---

## 11. V3 Learnings & Pitfalls

These supplement the 27 learnings documented in v2 §15.

**28. `canonical_scv` must have explicit `false` rows** — `sync-scv-list` writes rows with
`is_self_contained = false` for plates removed from the registry. A missing row means
"unknown". When rebuilding, always run `sync-scv-list` immediately after applying
`20260421000001` to populate the table; do not rely solely on the backfill.

**29. Zone uniqueness constraint requires coordinated rename** — If you see
`duplicate key violates unique constraint "zones_unique_name_per_org"` after `20260403000001`,
it means you have an additional zone named "Other Location" that was not renamed (e.g. from
a direct DB insert after the migration). Rename it to `"<OrgName> - Other Location"` or
another unique name.

**30. `infringement_notices.amount_cents` vs `fee_amount`** — Use `amount_cents` in all
new code. `fee_amount` is kept for backward compat. The `generate-infringement` edge
function writes both, so the UI should read `amount_cents` and fall back to
`ROUND(fee_amount * 100)` only for legacy rows.

**31. `dispute_intake` accepts unauthenticated submissions** — The `submit-dispute-intake`
edge function must not log or return PII in error messages. All validation errors should
return generic `"Submission failed"` to avoid leaking field details to malicious actors.

**32. `vehicle_discrepancies.sc_law_active` is set at insert time** — It captures whether
the SC enforcement law was active when the discrepancy was detected, not whether it's
active now. This is intentional for audit trail purposes. Do not update this field after
initial insert.

**33. `safe_insert_observation` is an emergency fallback** — Normal scans should use the
standard `observations` INSERT so that all triggers fire. Use `safe_insert_observation`
only when the `auto_evaluate_compliance()` trigger is broken (you will see
`COALESCE types integer and text cannot be matched` errors in logs).

**34. `get_zone_compliance_breakdown` parent/child split** — The `Jurisdiction` tab in
`ComplianceDashboard` should filter `WHERE parent_zone_id IS NULL`. The `By Zone` tab
should show `WHERE parent_zone_id IS NOT NULL`. Do not mix them — showing jurisdiction
zones in the "By Zone" tab inflates apparent compliance counts because jurisdiction zones
overlap their children.

**35. `nzscv_monitor` role cannot submit disputes or view breach details** — This role is
intentionally limited to `canonical_scv` read access and the NZSCV monitor page. Do not
add it to admin portal route guards without consulting the security model.

**36. Notice artifact storage bucket may need manual creation** — The `20260417000003`
migration creates the `notice-artifacts` bucket inside a `DO $$ BEGIN ... EXCEPTION WHEN
insufficient_privilege` block. If the bucket is not created (check with
`SELECT * FROM storage.buckets WHERE id = 'notice-artifacts'`), create it manually in the
Supabase Dashboard and apply the RLS policies from the migration file.

**37. Audit log RLS was not org-scoped before v3** — Prior to `20260423000002`, any
authenticated user could read all audit log entries across all organisations. This is now
fixed. If you have a deployment where this migration has not run, apply it immediately.

**38. `get_patrol_kpis` requires `actual_start_time` / `actual_end_time` to be set** —
Patrols that only have `started_at`/`ended_at` (the pre-v3 columns) will show 0 for
punctuality metrics. After deploying `20260409000002`, update the Field Officer Portal
to write `actual_start_time = now()` on patrol start and `actual_end_time = now()` on end.

---

## Appendix: Complete Table Inventory (v3)

Tables added or modified in v3 are **bold**.

### Core Tables (unchanged from v2)
- `organizations`, `user_profiles`, `zones`, `zone_legal_config`*, `compliance_matrix`,
  `observations`*, `breach_alerts`, `canonical_vehicles`, `infringement_notices`*,
  `notices_to_vacate`, `enforcement_cases`, `patrols`*, `patrol_checkpoints`,
  `flagged_vehicles`*, `homeless_records`, `investigation_jobs`, `person_records`,
  `audit_log`, `privacy_access_log`

### New Tables (v3)
- **`canonical_scv`** — SCV certification per plate
- **`canonical_homeless`** — Homeless status per plate
- **`dispute_intake`** — Public dispute submissions
- **`vehicle_discrepancies`** — Cross-source data conflicts
- **`patrol_schedule_zones`** — Ordered zone list per patrol
- **`officer_shifts`** — Officer shift time windows

*Modified in v3 (see §2 for details)

---

## §11 — BCPU: Person / Vehicle of Interest & Trespass Notices (v3.1)

### Overview

Data-sharing layer between organisations and service providers for persons and vehicles of interest, including official trespass notices under the NZ Trespass Act 1980. All personal data handling must comply with the NZ Privacy Act 2020 (Information Privacy Principles 1–6 & 11).

### Requirements

1. **Persons of Interest (POI)**: Organisations can flag persons as `poi` (person of interest), `banned`, or `trespassed` with photos, descriptions, and official trespass notice documents.
2. **Vehicles of Interest (VOI)**: Organisations can flag vehicles with plate number, make/model/colour/year, photos, and link to a POI record.
3. **Trespass Notices**: Official trespass notices under NZ Trespass Act 1980 (s.3 & s.4). Written notices valid max 2 years (730 days). Support verbal, written, and permanent notice types.
4. **Officer Entry**: Officers can add persons/vehicles as POI/banned/trespassed directly from the field. Includes photo capture and privacy notice acknowledgement.
5. **Data Visibility (RLS)**: Users can only view POI/VOI data if they belong to the owning organisation. Service providers may view data only when authorised and inside the organisation's geo-fence.
6. **NZ Privacy Act 2020 Compliance**: IPP 1 (lawful purpose), IPP 2 (direct collection), IPP 3 (inform individual), IPP 4 (proportionate collection), IPP 11 (disclosure restrictions). Privacy notice given flag recorded per record.

### New Tables

| Table | Purpose |
|---|---|
| `persons_of_interest` | Persons flagged by org (POI/banned/trespassed) |
| `vehicles_of_interest` | Vehicles flagged by org with optional POI link |
| `trespass_notices` | Official trespass notice records with legal basis |

### Migration

`20260426000011_poi_voi_trespass_risk_assessment.sql`

### Frontend

| File | Purpose |
|---|---|
| `src/pages/PointsOfInterest.tsx` | Tabbed management page (Persons / Vehicles / Trespass Notices) |
| `src/hooks/usePointsOfInterest.ts` | CRUD hooks for POI, VOI, and trespass notices |

### Route

`/points-of-interest` — Roles: admin, admin_officer, master, officer

---

## §12 — Site Risk Assessment (v3.1)

### Overview

Officers can complete site risk assessments for each site visit, ad-hoc or on request from organisation/service provider. Assessments follow NZ WorkSafe HSWA 2015 guidelines with pre-selected hazard categories, checkbox-based coverage, PPE requirements, and photo evidence.

### Requirements

1. **Ad-hoc or Requested**: Officers may create assessments independently or in response to an organisation/service provider job request.
2. **NZ WorkSafe HSWA 2015 Hazard Categories**: 18 pre-defined hazard checkboxes covering all major WorkSafe categories (slips/trips/falls, working at height, manual handling, vehicles/traffic, electrical, fire, hazardous substances, confined spaces, noise, weather, biological, lone working, aggressive persons, animals, water/drowning, poor lighting, uneven terrain, other).
3. **Safety Checklist**: Emergency plan sighted, first aid available, communication coverage, safe parking, site access, signage.
4. **PPE Selection**: Pre-defined PPE options (hi-vis, boots, hard hat, glasses, gloves, hearing, sun, wet weather, torch, first aid, comms device).
5. **Photo Evidence**: Easy photo upload and management for site conditions.
6. **Risk Levels**: Low, Medium, High, Critical — with visual indicators.
7. **Workflow**: Draft → Submitted → Reviewed → Archived.
8. **Org-scoped RLS**: Data restricted to authorised users within the organisation.

### New Table

| Table | Purpose |
|---|---|
| `site_risk_assessments` | NZ WorkSafe-guided site risk evaluations with hazard checklist |

### Migration

`20260426000011_poi_voi_trespass_risk_assessment.sql` (shared with §11)

### Frontend

| File | Purpose |
|---|---|
| `src/pages/SiteRiskAssessment.tsx` | Assessment management with creation form, hazard checkboxes, PPE, photos |
| `src/hooks/useSiteRiskAssessment.ts` | CRUD hooks with hazard category constants and PPE options |

### Route

`/site-risk-assessment` — Roles: admin, admin_officer, master, officer

### Key Learnings & Pitfalls

- **#39**: POI/VOI records store photos as `TEXT[]` (Supabase Storage URLs). Use `uploadFile()` from `src/lib/fileUpload.ts` with bucket `'evidence'`.
- **#40**: Trespass notice `duration_days` max is 730 (2 years per NZ Trespass Act 1980). `expires_at` is calculated from `issued_at + duration_days`.
- **#41**: `privacy_notice_given` must be set before creating POI records (NZ Privacy Act IPP 3). UI displays compliance banner.
- **#42**: Site risk assessment hazard checkboxes are individual boolean columns (not JSON) for efficient querying and filtering.
- **#43**: Service provider geo-fence restriction for POI data visibility requires checking officer's current GPS position against the organisation's zone boundaries (future enhancement via RPC).

---

*End of BUILD_PLAN_V3.md — Last updated 2026-04-26*
