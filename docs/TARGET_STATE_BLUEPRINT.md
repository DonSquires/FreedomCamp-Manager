# FreedomCamp Manager — Target State Blueprint

> **Type**: Implementation-ready technical specification.
> **Supersedes**: CLEAN_REBUILD_DESIGN.md (V4) for backend implementation decisions.
> **Status**: Authoritative design spec — 2026-04-20.

This document answers one question:
**"What exactly do we build, in what order, to reach a clean, secure, maintainable backend?"**

---

## Table of Contents

1. [Roles & Access Model](#1-roles--access-model)
2. [Core Schema (36 tables)](#2-core-schema-36-tables)
3. [Provider–Client Access Grants (new)](#3-providerclient-access-grants-new)
4. [RLS Helper Functions (canonical)](#4-rls-helper-functions-canonical)
5. [RLS Policy Pattern (canonical)](#5-rls-policy-pattern-canonical)
6. [Edge Function Set (17)](#6-edge-function-set-17)
7. [Infrastructure Wiring](#7-infrastructure-wiring)
8. [Migration Strategy](#8-migration-strategy)
9. [Rollout Phases](#9-rollout-phases)
10. [Critical Path Dependencies](#10-critical-path-dependencies)

---

## 1. Roles & Access Model

### Five roles (no more, no less)

| Role | Who | DB scope |
|---|---|---|
| `officer` | Field patrol officer | Own org only. Read zones/canonical data. Write observations. |
| `admin_officer` | Dual field + desk officer | Everything officer gets + everything admin gets. |
| `admin` | Compliance manager | Own org + descendant orgs (RLS via `get_user_organization_ids()`). |
| `master` | Account/contract manager | Assigned orgs only: primary + descendants + `extra_organization_ids`. |
| `grand_master` | Platform owner (Iron Eagle) | All active orgs. No restriction. |

**Removed roles**: `nzscv_monitor` (replace with scoped master access).

### Hierarchy rules

```
grand_master
  └── (sees all orgs)

master
  └── primary_org + get_descendant_organizations(primary_org) + extra_organization_ids
         └── (assigned by grand_master via AccessControlPage)

admin / admin_officer
  └── primary_org + get_descendant_organizations(primary_org)
         + authorized_work_locations + extra_organization_ids

officer
  └── primary_org only
         + authorized_work_locations (per-user cross-org patches)
```

### Service provider access (First Security → LINZ/Nelson City Council)

The current model grants access by placing client org IDs into `authorized_work_locations`
or `extra_organization_ids` on each officer's profile. This is brittle, hard to audit,
and does not model the business reality of a provider–client contract.

**The fix is implemented in §3.**

---

## 2. Core Schema (36 tables)

### 2.1 Category map

```
Foundation (2)
  organizations, user_profiles

Zones (4)
  zones, zone_compliance_matrix, zone_legal_config, zone_signage_evidence

Scan pipeline (1)
  observations

Enforcement (6)
  breach_alerts, infringement_notices, infringement_notice_counters,
  notices_to_vacate, enforcement_cases, enforcement_case_events

Vehicles / canonical (3)
  canonical_vehicles, canonical_scv, canonical_homeless

Patrol / shift (5)
  patrols, patrol_schedule_zones, officer_shifts,
  patrol_checkpoints*, checkpoint_visits*

Welfare (3)
  officer_welfare_settings, officer_welfare_alerts, officer_activity_log

Incidents (3)
  incidents, incident_attachments, health_safety_reports

People (4)
  person_records, person_observations, person_vehicle_links, person_interactions

Disputes (1)
  dispute_intake

Privacy / Audit (3)
  privacy_access_log, privacy_curtain_settings, retention_policies,
  audit_log (4th)

NEW (1)
  provider_client_access_grants   ← §3
```

`*` optional but included in phase 1 (lone-worker QR safety)

### 2.2 Key design rules

1. Every org-scoped table carries `organization_id uuid NOT NULL REFERENCES organizations(id)`.
2. Compliance state lives on `observations` columns — not in a separate `compliance_results` table.
3. `canonical_*` tables are plate-keyed, cross-org references. No `organization_id` on them. All authenticated users can read; only service_role can write.
4. `breach_type` values are a closed CHECK constraint: `consecutive_nights | monthly_limit | self_contained | after_hours | day_visit_violation | allowed_days_violation | plate_mismatch | data_integrity_issue`.
5. `breach_alerts.status` is a closed CHECK constraint: `pending | acknowledged | enforcement_started | resolved | dismissed`.

### 2.3 Tables to cut before go-live

| Table | Action |
|---|---|
| `vehicle_monthly_stays` | Drop — compliance RPC counts from observations directly |
| `flagged_vehicles` | Merge into `canonical_homeless`, then drop |
| `homeless_records` | Merge into `canonical_homeless`, then drop |
| `compliance_results` | Already dropped in migration 20260221 |
| `vehicle_records`, `vehicle_observations`, `plate_scans` | Drop — replaced by canonical_vehicles + observations |
| `photo_metadata` | Drop — merged into observations.photo_url + photo_hash |
| `drift_events` | Drop — not in current pipeline |
| `nzscv_cache` | Drop — canonical_scv is the cache |
| `scan_idempotency_keys` | Drop — idempotency_key column on observations |
| `enforcement_actions` | Drop — superseded by enforcement_case_events |
| `alert_queue`, `alert_acknowledgements` | Drop — merged into breach_alerts |
| `boundary_review_queue`, `access_requests` | Drop — not used |
| `missing_photo_queue`, `photo_recovery_audit_log` | Drop — internal tool artifacts |
| `observation_deletions` | Drop — use audit_log |
| `legacy_evidence_reviews` | Drop |

### 2.4 Phase 2 tables (not in initial build)

`canonical_persons`, `vehicle_discrepancies`, `investigation_jobs`,
`investigation_job_templates`, `privacy_impact_assessments`,
`session_mode_switch_log`, `notice_templates`

---

## 3. Provider–Client Access Grants (new)

### 3.1 The problem

Iron Eagle Security (service provider) deploys officers to patrol LINZ-managed zones
and Nelson City Council zones. Those officers are not employees of LINZ or NCC. Today,
access is bodged via `authorized_work_locations` on each officer profile. This:

- Requires manual per-officer patching for every new contract
- Cannot express time-bounded or service-specific consent
- Cannot be audited at the contract level
- Does not model the "allow without roster" opt-in that clients need

### 3.2 Solution: `provider_client_access_grants` table

```sql
CREATE TABLE public.provider_client_access_grants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who is the service provider (e.g. Iron Eagle Security org)
  provider_org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Which client org are they being granted access to (e.g. LINZ, NCC)
  client_org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- What service type this grant covers
  service_type        text NOT NULL DEFAULT 'freedom_camping'
                        CHECK (service_type IN (
                          'freedom_camping', 'guarding', 'patrol', 'noise_control', 'all'
                        )),

  -- The key opt-in flag: can the service provider's officers work in client zones
  -- without being rostered against those specific zones?
  allow_without_roster boolean NOT NULL DEFAULT false,

  -- Optional scope narrowing
  zone_ids            uuid[],   -- NULL = all client zones
  site_ids            uuid[],   -- NULL = all client sites

  -- Validity window (NULL = indefinite)
  effective_from      timestamptz NOT NULL DEFAULT now(),
  effective_to        timestamptz,

  -- Governance
  is_active           boolean NOT NULL DEFAULT true,
  granted_by          uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  revoked_by          uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  revoked_at          timestamptz,
  notes               text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (provider_org_id, client_org_id, service_type)
);

CREATE INDEX idx_provider_client_grants_provider ON public.provider_client_access_grants(provider_org_id) WHERE is_active;
CREATE INDEX idx_provider_client_grants_client   ON public.provider_client_access_grants(client_org_id)   WHERE is_active;

-- RLS: grand_master and master can manage grants; admin can view grants for their org
ALTER TABLE public.provider_client_access_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gm_manage_provider_client_grants"
  ON public.provider_client_access_grants FOR ALL
  USING (get_user_role(auth.uid()) IN ('grand_master', 'master'));

CREATE POLICY "admin_read_provider_client_grants"
  ON public.provider_client_access_grants FOR SELECT
  USING (
    provider_org_id = ANY(get_user_organization_ids())
    OR client_org_id = ANY(get_user_organization_ids())
  );
```

### 3.3 RPC: `get_user_effective_access_scope()`

This replaces scattered `authorized_work_locations` patches with a single canonical lookup:

```sql
CREATE OR REPLACE FUNCTION public.get_user_effective_access_scope()
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org_id    uuid;
  v_role      text;
  v_base_ids  uuid[];
  v_grant_ids uuid[];
  v_result    uuid[];
BEGIN
  SELECT organization_id, role
  INTO   v_org_id, v_role
  FROM   public.user_profiles
  WHERE  id = auth.uid();

  -- Base access from existing get_user_organization_ids() (includes hierarchy,
  -- authorized_work_locations, extra_organization_ids)
  v_base_ids := get_user_organization_ids();

  -- Extend with provider-client grants if the user's org has active grants
  IF v_org_id IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT pcg.client_org_id)
    INTO   v_grant_ids
    FROM   public.provider_client_access_grants pcg
    WHERE  pcg.provider_org_id = ANY(v_base_ids)
      AND  pcg.is_active = true
      AND  (pcg.effective_to IS NULL OR pcg.effective_to > now());

    IF v_grant_ids IS NOT NULL THEN
      v_result := array_cat(v_base_ids, v_grant_ids);
    ELSE
      v_result := v_base_ids;
    END IF;
  ELSE
    v_result := v_base_ids;
  END IF;

  SELECT ARRAY_AGG(DISTINCT org_id)
  INTO   v_result
  FROM   unnest(COALESCE(v_result, ARRAY[]::uuid[])) AS org_id;

  RETURN COALESCE(v_result, ARRAY[]::uuid[]);

EXCEPTION WHEN invalid_text_representation OR data_exception THEN
  RETURN COALESCE(v_base_ids, ARRAY[]::uuid[]);
END;
$fn$;

COMMENT ON FUNCTION public.get_user_effective_access_scope() IS
  'Returns all org IDs accessible to the current user, including provider-client contract grants.
   Use this for enforcement/scan data access. Use get_user_organization_ids() for admin/management data.';
```

### 3.4 How to answer "First Security officer scans LINZ zones without roster"

1. `grand_master` or Iron Eagle `master` creates a row in `provider_client_access_grants`:
   - `provider_org_id` = Iron Eagle Security org
   - `client_org_id` = LINZ (or Nelson City Council)
   - `service_type` = 'freedom_camping'
   - `allow_without_roster` = `true`

2. The First Security officer's `organization_id` is Iron Eagle (or a child of Iron Eagle).
   `get_user_effective_access_scope()` includes LINZ in the returned array.

3. RLS policies on `observations`, `breach_alerts`, `zones`, `canonical_vehicles` use
   `organization_id = ANY(get_user_effective_access_scope())` — officer can read/write
   LINZ-scoped data.

4. If `allow_without_roster = false`, the consuming code (edge function or frontend) must
   additionally check the `roster_shifts` table before permitting the scan. The grant
   record still controls which orgs are visible at the DB level, but the application
   layer enforces the roster requirement.

---

## 4. RLS Helper Functions (canonical)

These are the **only** helper functions used in RLS policies. All are `SECURITY DEFINER`
to prevent recursion when reading `user_profiles`.

```sql
-- Returns the current user's role ('officer', 'admin', etc.)
CREATE OR REPLACE FUNCTION public.get_user_role(uid uuid DEFAULT auth.uid())
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_role text; BEGIN
  SELECT role INTO v_role FROM public.user_profiles WHERE id = uid;
  RETURN v_role;
EXCEPTION WHEN OTHERS THEN RETURN NULL; END; $$;

-- Returns the current user's primary org id
CREATE OR REPLACE FUNCTION public.get_user_organization_id(uid uuid DEFAULT auth.uid())
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_id uuid; BEGIN
  SELECT organization_id INTO v_id FROM public.user_profiles WHERE id = uid;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN RETURN NULL; END; $$;

-- Returns array of all org IDs the user may manage (hierarchy + overrides).
-- grand_master: all active orgs.
-- master/admin/admin_officer: primary + descendants + work_locations + extra_org_ids.
-- officer: primary only + work_locations.
-- Defined in full in migration 20260502000001_master_org_scoped_access.sql.
-- Referenced here as the canonical helper for admin/management data access.
-- (body not repeated — see that migration)

-- Returns all org IDs accessible to the current user for enforcement data access.
-- Extends get_user_organization_ids() with provider-client contract grants.
-- Defined in §3.3 above.
-- Use this helper on: observations, breach_alerts, zones, canonical_vehicles queries.
```

### Decision rule: which helper to use

| Context | Helper |
|---|---|
| Enforcement data: observations, scans, zones, breach alerts, canonical lookups | `get_user_effective_access_scope()` |
| Admin management: user management, roster, dispatch, billing | `get_user_organization_ids()` |
| Role-gate checks | `get_user_role()` |
| Primary org FK matching | `get_user_organization_id()` |

---

## 5. RLS Policy Pattern (canonical)

### Standard patterns

**Pattern A — Org-scoped enforcement data (observations, breach_alerts, zones, etc.):**
```sql
CREATE POLICY "org_scope_enforcement"
  ON public.<table> FOR ALL
  USING (organization_id = ANY(get_user_effective_access_scope()));
```

**Pattern B — Org-scoped management data (roster, dispatch, users):**
```sql
CREATE POLICY "org_scope_management"
  ON public.<table> FOR ALL
  USING (organization_id = ANY(get_user_organization_ids()));
```

**Pattern C — Role-gated write + org-scoped read:**
```sql
-- Admins manage; officers read own
CREATE POLICY "admins_manage"
  ON public.<table> FOR ALL
  USING (
    get_user_role() IN ('admin', 'admin_officer', 'master', 'grand_master')
    AND organization_id = ANY(get_user_organization_ids())
  );
CREATE POLICY "officers_read"
  ON public.<table> FOR SELECT
  USING (organization_id = ANY(get_user_effective_access_scope()));
```

**Pattern D — Grand master only:**
```sql
CREATE POLICY "grand_master_only"
  ON public.<table> FOR ALL
  USING (get_user_role() = 'grand_master');
```

**Pattern E — Cross-org canonical tables (canonical_scv, canonical_homeless, canonical_vehicles):**
```sql
-- Any authenticated user can read; only service_role can write
CREATE POLICY "authenticated_read"
  ON public.<table> FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_role_write"
  ON public.<table> FOR ALL TO service_role USING (true) WITH CHECK (true);
```

### Tables that currently use the wrong pattern (must fix)

| Table | Current problem | Fix |
|---|---|---|
| `incidents` | Uses inline `up.organization_id = incidents.organization_id` join | Pattern C |
| `patrols` | Uses inline join instead of helper | Pattern A |
| `user_profiles` self-read policies | Recursive query risk | Use `get_user_role()` + `get_user_organization_id()` |
| `roster_shifts` | Updated in 20260607 — verify grand_master is included | Pattern B (confirmed in migration) |
| `dispatch_jobs` | Updated in 20260607 — OK | Pattern B (confirmed in migration) |
| `client_sites` | Updated in 20260607 — OK | Pattern A (confirmed in migration) |
| `ptt_channels` / PTT tables | Uses `profile.organization_id` exact match | Pattern A using effective scope |

### Eliminate `user_belongs_to_org()`

The function `user_belongs_to_org()` checks only `user_profiles.organization_id =
target_org` and `extra_organization_ids`, and does not include descendants or
provider–client grants. All callers must be migrated to one of the patterns above before
this function is dropped.

---

## 6. Edge Function Set (17)

Every edge function follows this boilerplate:

```typescript
import { withCors } from '../_shared/withCors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(withCors(async (req) => {
  // 1. Auth check
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  // 2. Handler logic here

}));
```

### Catalog

| # | Function | HTTP | Callers | Purpose |
|---|---|---|---|---|
| 1 | `process-officer-scan` | POST | FieldOfficerPortal + offline queue | Full scan pipeline: photo → ONNX → plate → SCV → zone → compliance → breach |
| 2 | `cleanup-and-recalculate` | POST | pg_cron (3am NZT) + admin UI | Nightly 7-phase batch: zone correction, dedup, vehicle refresh, compliance recalc, overnight breach detection, photo reconciliation, SCV sync |
| 3 | `generate-notice-to-vacate` | POST | Enforcement.tsx | NTV PDF generation + storage in notice-artifacts bucket |
| 4 | `generate-infringement` | POST | Enforcement.tsx | Infringement notice PDF (FCA 2011 s.20) |
| 5 | `sync-scv-list` | POST | pg_cron (daily) + admin trigger | Sync NZSCV registry → canonical_scv |
| 6 | `create-user` | POST | Users.tsx (admin) | Create auth user + user_profiles row + send invite email |
| 7 | `monitor-officer-welfare` | POST | pg_cron (5-min) | Check missed check-ins, GPS inactivity → welfare alerts + Expo push |
| 8 | `send-report-email` | POST | Reports.tsx | Generate compliance/enforcement/zone-stats reports and email to recipient |
| 9 | `export-data` | POST | Reports.tsx | Stream CSV/JSON export of observations, breaches, or audit log |
| 10 | `import-data` | POST | DataImport.tsx | Historical data import with tabular NLP field mapping |
| 11 | `submit-dispute-intake` | POST | PublicDisputePortal.tsx (no auth) | Public dispute submission → dispute_intake row + confirmation email |
| 12 | `public-case-lookup` | POST | PublicDisputePortal.tsx (no auth) | Look up notice/infringement by reference — returns status, no PII |
| 13 | `hotspot-data` | POST | Dashboard.tsx, LiveMap.tsx | Heatmap density data per zone |
| 14 | `process-homeless-data` | POST | DataImport.tsx | Import homeless register from CSV/Excel → canonical_homeless |
| 15 | `nightly-privacy-cleanup` | POST | pg_cron (1am NZT) | Apply retention policies; anonymise aged observations; clean audit log |
| 16 | `manage-user` | POST | Users.tsx (admin) | Set/reset password; deactivate/reactivate user |
| 17 | `photo-maintenance` | POST | pg_cron (2am NZT) | Reconcile missing photos; reingest failed photos; clean orphaned storage objects |

**Phase 2 only (disabled in UI but keep code deployed):**
- `onspace-ai-chat` — admin AI chat assistant
- `process-credential-document` — AI COA/warrant OCR
- `process-investigation-document` — AI investigation document processing
- `ptt-signaling-token` — PTT channel token broker (already production)

### Functions to delete

```
recalculate-compliance
recalculate-compliance-v2
recalculate-compliance-v3
alpr-process
alpr-retry
orc-ingest
plate-scanner-photo-first
scan-breaches
check-nzscv-status
analyze-vehicle-photo
vehicle-ingest
stream-webhook
duplicate-detection
correct-zone-assignments
zone-correction
check-zone-corrections
check-data-integrity
check-almost-breaches
get-compliance-statistics
observations-list
observations-in-bounds
generate-dashboard-report
generate-leadership-pack
generate-vehicle-report
generate-incident-pdf
admin-incident-ops
enrich-from-motorweb
select-best-vehicle-photo
link-evidence-photos
photo-recovery
daily-photo-reconciler
reingest-photos
scrape-vehicle-photos
parkpow-photo-sync
parkpow-sync
sync-spatial-layers
suggest-new-zone
test-compliance-matrix
update-compliance-policy
send-invite-email
send-push-notification (merge into monitor-officer-welfare)
set-user-password (merge into manage-user)
update-user-password (merge into manage-user)
create_auth_and_profiles (merge into create-user)
upload-file
get-weather
```

---

## 7. Infrastructure Wiring

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  React SPA (Vercel)                                                         │
│  src/ — TypeScript, Vite, Tailwind, shadcn/ui                               │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ HTTPS / WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Supabase                                                                   │
│                                                                             │
│  Auth (JWT)  ←──── all requests verified here                               │
│                                                                             │
│  PostgreSQL 15                                                              │
│    36 tables  |  RLS on all  |  pg_cron (nightly + 5-min welfare)          │
│    RPCs: calculate_vehicle_compliance_v3, get_user_effective_access_scope   │
│            get_user_organization_ids, get_user_role, get_descendant_orgs    │
│                                                                             │
│  Edge Functions (Deno) — 17 active (see §6)                                │
│    process-officer-scan  ──────────────────────────────────────► RunPod    │
│      └── POST /infer (photo → ONNX embedding + plate)             (Bob AI) │
│    cleanup-and-recalculate ─────────────────────────────────────► Railway  │
│      Phase 7: POST /api/nzscv/vehicle-info                         (proxy) │
│    ptt-signaling-token  ────────────────────────────────────────► VPS      │
│      POST /api/token/mint (JWT channel token)                   72.61.123.97│
│                                                                             │
│  Storage                                                                    │
│    scans/          — officer scan photos                                    │
│    notice-artifacts/ — generated PDFs (NTV, infringement)                  │
│    incident-evidence/ — enforcement case photos                             │
│    evidence/       — tender + reference materials                           │
└─────────────────────────────────────────────────────────────────────────────┘
          │                        │                          │
          ▼                        ▼                          ▼
┌──────────────────┐  ┌────────────────────┐  ┌─────────────────────────────┐
│  Railway         │  │  RunPod Serverless  │  │  Voice VPS 72.61.123.97     │
│  proxy-server/   │  │  inference-service/ │  │  ptt-server/ (Docker)       │
│  Static IP       │  │  + runpod-worker/   │  │  turn-server/ (Coturn)      │
│                  │  │                     │  │                             │
│  /api/nzscv/...  │  │  /infer             │  │  ws://.../ws (WebRTC sig)   │
│  /motorweb/...   │  │  /nlp/tabular/...   │  │  /api/token/mint            │
│                  │  │  /chat (Phase 2)    │  │  /api/diagnostics           │
│  Auth:           │  │  /self-heal/*       │  │                             │
│  x-proxy-secret  │  │                     │  │  Auth:                      │
│                  │  │  Auth:              │  │  x-proxy-secret (mint)      │
└──────────────────┘  │  INFERENCE_API_KEY  │  │  JWT (websocket)            │
  Whitelisted IP at   │  or Supabase JWT    │  └─────────────────────────────┘
  NZSCV + MotorWeb    └────────────────────┘
```

### Secrets reference (Supabase vault)

| Secret | Used by |
|---|---|
| `INFERENCE_SERVICE_URL` | process-officer-scan, cleanup-and-recalculate |
| `INFERENCE_API_KEY` | Same functions |
| `PROXY_SERVER_URL` (aliases: PROXY_SERVICE_URL, NZSCV_PROXY_URL) | cleanup-and-recalculate Phase 7, sync-scv-list |
| `PROXY_SECRET` | Same functions |
| `PTT_SERVER_URL` | ptt-signaling-token |
| `PTT_PROXY_SECRET` | ptt-signaling-token |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | send-report-email, generate-notice-to-vacate, create-user |

---

## 8. Migration Strategy

### 8.1 Access control migration (do first — highest risk)

```
Step 1: Add provider_client_access_grants table (§3.2)
Step 2: Add get_user_effective_access_scope() RPC (§3.3)
Step 3: Backfill grants from existing authorized_work_locations assignments:
          - Identify Iron Eagle org ID
          - Identify client org IDs (LINZ, NCC, etc.)
          - INSERT one grant row per provider–client pair
Step 4: Update high-traffic RLS policies to use new scope helper:
          - observations
          - breach_alerts
          - zones
          - canonical_vehicles lookups
Step 5: Verify dual-read period (both old and new policies active)
Step 6: Drop user_belongs_to_org() once all callers migrated
```

### 8.2 RLS normalization (do second)

```
Step 1: Audit every table for policies using inline user_profiles joins
        (pattern: WHERE up.organization_id = <table>.organization_id)
Step 2: Replace with get_user_organization_ids() or get_user_effective_access_scope()
Step 3: Verify master role uses primary+descendants only (not all orgs)
        — confirmed fixed in 20260502000001_master_org_scoped_access.sql
Step 4: Verify grand_master_only policies on cross-org analytics tables
Step 5: Verify PTT channel authorization uses effective scope
```

### 8.3 Schema cleanup (do third)

```
Step 1: Verify all callers of flagged_vehicles have been migrated to canonical_homeless
Step 2: Verify all callers of homeless_records have been migrated to canonical_homeless
Step 3: DROP TABLE flagged_vehicles
Step 4: DROP TABLE homeless_records
Step 5: DROP TABLE vehicle_monthly_stays (confirm compliance RPC counts from observations)
Step 6: DROP remaining legacy tables listed in §2.3
Step 7: Regenerate src/types/database.ts:
          supabase gen types typescript --project-id <id> > src/types/database.ts
```

### 8.4 Function consolidation (do fourth)

```
Step 1: Route any remaining callers of dead edge functions to their replacement
Step 2: Remove dead functions from supabase/functions/ directory
Step 3: Confirm supabase functions list matches the 17-function target
Step 4: Update cleanup-and-recalculate to include all 7 phases
        (currently 3 phases: zone, dedup, compliance)
        Add: Phase 4 overnight breach detection, Phase 5 vehicle refresh,
             Phase 6 photo maintenance, Phase 7 SCV sync
Step 5: Confirm process-officer-scan handles stream-webhook path
```

### 8.5 Schema parity (do last)

```
Step 1: Regenerate database.ts after all cuts above
Step 2: Run bun run build — resolve any TypeScript errors from missing types
Step 3: Run bun run lint
Step 4: Smoke test core flows against staging
```

---

## 9. Rollout Phases

### Phase A — Foundation (1–2 days)

**Goal**: Can log in, create orgs/users.

- [ ] Confirm single grand_master user exists
- [ ] Confirm `provider_client_access_grants` table applied
- [ ] Confirm `get_user_effective_access_scope()` RPC deployed
- [ ] Confirm `create-user` edge function returns 200 for invite
- [ ] `organizations` + `user_profiles` RLS verified per §5 patterns

---

### Phase B — Access control correctness (1 day)

**Goal**: First Security officer can scan LINZ zones; NCC officer cannot see Iron Eagle data.

- [ ] Create test grant row: Iron Eagle → LINZ, `allow_without_roster=true`
- [ ] Log in as First Security officer, verify LINZ zones appear in zones query
- [ ] Log in as NCC officer, verify Iron Eagle observations NOT in results
- [ ] Verify master user sees only their assigned orgs (not all orgs)
- [ ] Verify grand_master sees all orgs

---

### Phase C — Scan pipeline (2–3 days)

**Goal**: Officer scans plate → gets compliance verdict.

- [ ] `INFERENCE_SERVICE_URL` + `INFERENCE_API_KEY` set in Supabase vault
- [ ] `PROXY_SERVER_URL` + `PROXY_SECRET` set in Supabase vault
- [ ] `process-officer-scan` returns compliance verdict in < 6 seconds
- [ ] Offline queue syncs on reconnect
- [ ] `canonical_scv` lookup returns correct SCV status
- [ ] Breach alert created for non-compliant observation
- [ ] `calculate_vehicle_compliance_v3()` RPC called (not v1/v2)

---

### Phase D — Admin operations (2–3 days)

**Goal**: Admin can manage their full daily workflow.

- [ ] Dashboard KPIs load from `get_admin_dashboard_stats()` RPC
- [ ] Breach alert list shows correct org-scoped data
- [ ] NTV PDF generated and stored in notice-artifacts bucket
- [ ] Live map shows officer GPS positions
- [ ] Zone CRUD works; compliance matrix syncs via trigger

---

### Phase E — Nightly pipeline (1 day)

**Goal**: Nightly cleanup runs without manual intervention.

- [ ] pg_cron entry confirmed for `cleanup-and-recalculate` at 3am NZT
- [ ] All 7 phases execute: zone correction, dedup, vehicle refresh, overnight breach, compliance recalc, photo reconciliation, SCV sync
- [ ] pg_cron entry for `monitor-officer-welfare` at 5-minute interval
- [ ] pg_cron entry for `nightly-privacy-cleanup` at 1am NZT

---

### Phase F — Legacy table retirement (1 day)

**Goal**: No more dual code paths for flagged_vehicles / homeless_records.

- [ ] Confirmed zero active callers of `flagged_vehicles`
- [ ] Confirmed zero active callers of `homeless_records`
- [ ] `DROP TABLE flagged_vehicles` migration applied
- [ ] `DROP TABLE homeless_records` migration applied
- [ ] `DROP TABLE vehicle_monthly_stays` migration applied
- [ ] All remaining legacy tables from §2.3 cut list dropped
- [ ] `database.ts` regenerated; `bun run build` clean

---

### Phase G — Dead function cleanup (1 day)

**Goal**: Zero dead functions deployed.

- [ ] All 52 cut functions removed from `supabase/functions/` directory
- [ ] `supabase functions list` returns exactly 17 active + 3 Phase 2 disabled
- [ ] All Phase 2 functions disabled in UI (feature flag or hidden route)
- [ ] `bun run lint` clean

---

### Phase H — Provider-client UI (1 day)

**Goal**: Grand master can manage provider–client grants from the UI.

- [ ] `Platform.tsx` includes Contracts tab: list/add/revoke `provider_client_access_grants`
- [ ] Grant creation wizard: select provider org, client org, service type, allow_without_roster
- [ ] Revoke action sets `is_active=false`, `revoked_at`, `revoked_by`
- [ ] Audit trail: grant changes appear in `audit_log`

---

## 10. Critical Path Dependencies

```
1. provider_client_access_grants table
   └── required before: get_user_effective_access_scope()
         └── required before: RLS policy updates on observations/zones/breaches

2. RLS policy updates (normalize all to helper functions)
   └── required before: user_belongs_to_org() can be dropped
         └── required before: database.ts regeneration

3. canonical_homeless backfill complete
   └── required before: flagged_vehicles can be dropped
         └── required before: process-homeless-data only writes to canonical_homeless

4. cleanup-and-recalculate Phase 4–7 implemented
   └── required before: the following functions can be deleted:
         check-almost-breaches, scan-breaches, enrich-from-motorweb,
         sync-scv-list (scheduled), daily-photo-reconciler

5. process-officer-scan stream-webhook path tested
   └── required before: stream-webhook function can be deleted

6. database.ts regenerated after all table cuts
   └── required before: bun run build clean
         └── required before: staging smoke test
               └── required before: production deploy
```

### Minimum viable fix order (if doing in production without full rebuild)

Priority 1 — Security/access correctness:
1. Apply `provider_client_access_grants` migration
2. Apply `get_user_effective_access_scope()` RPC
3. Backfill grants for existing Iron Eagle → LINZ/NCC relationships
4. Update observations, zones, breach_alerts RLS to use effective scope

Priority 2 — Data integrity:
5. Complete canonical_homeless backfill
6. Drop flagged_vehicles and homeless_records
7. Regenerate database.ts

Priority 3 — Operational hygiene:
8. Add cleanup-and-recalculate phases 4–7
9. Delete dead edge functions
10. Remove developer pages from production UI

---

*End of TARGET_STATE_BLUEPRINT.md*
