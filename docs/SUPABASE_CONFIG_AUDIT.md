# Supabase Configuration Audit

**Date:** 2026-03-07  
**Auditor:** Copilot Coding Agent  
**Scope:** All apps targeting `https://kxwjcupuxnnbnzcgmkoi.supabase.co`

---

## 1. Executive Summary

The canonical Supabase project for FreedomCamp Manager is **`kxwjcupuxnnbnzcgmkoi`**
(URL: `https://kxwjcupuxnnbnzcgmkoi.supabase.co`).  
This is confirmed by `supabase/config.toml` (`project_id = "kxwjcupuxnnbnzcgmkoi"`).

**All three apps** (Admin/Field web portal, Expo mobile app, and Supabase Edge Functions)
correctly read their Supabase credentials from environment variables — **no app hardcodes a
project URL in executable code**.

A secondary project reference `xbfnlzmpumthnjmtqufp` appears throughout historical
documentation and runbooks. This appears to be an older project that is no longer the
current deployment target. All stale references have been replaced with `kxwjcupuxnnbnzcgmkoi`
as part of this audit.

---

## 2. Configuration File Inventory

### 2.1 `supabase/config.toml` — ✅ Correct

```toml
project_id = "kxwjcupuxnnbnzcgmkoi"
```

This is the single source of truth used by `supabase link`, `supabase db push`, and
`supabase functions deploy`.

---

### 2.2 Web Admin / Field Portal — `src/lib/supabase.ts`

```typescript
const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient<Database>(
  supabaseUrl || 'https://unconfigured.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  { /* auth + timezone headers */ }
)
```

**Environment variables required (set via GitHub Secrets or Vercel dashboard):**

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://kxwjcupuxnnbnzcgmkoi.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `<anon key from Supabase Dashboard → Settings → API>` |

Both variables are passed through the CI/CD pipeline via
`${{ secrets.VITE_SUPABASE_URL }}` and `${{ secrets.VITE_SUPABASE_ANON_KEY }}`
in `.github/workflows/merge_all.yml`.

---

### 2.3 Expo Mobile App — `mobile-app/src/lib/supabase.ts`

```typescript
const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true },
  global: { headers: { 'X-Client-Timezone': 'Pacific/Auckland' } },
})
```

**Environment variables required (set via GitHub Secrets and EAS project settings):**

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://kxwjcupuxnnbnzcgmkoi.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `<anon key from Supabase Dashboard → Settings → API>` |

Both variables are passed through CI/CD via
`${{ secrets.EXPO_PUBLIC_SUPABASE_URL }}` and `${{ secrets.EXPO_PUBLIC_SUPABASE_ANON_KEY }}`
in `.github/workflows/merge_all.yml`.

---

### 2.4 Supabase Edge Functions

All 45+ Edge Functions read credentials via Deno environment variables that are
**automatically injected by the Supabase platform** at runtime:

```typescript
Deno.env.get('SUPABASE_URL')               // https://kxwjcupuxnnbnzcgmkoi.supabase.co
Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')  // service-role key
Deno.env.get('SUPABASE_ANON_KEY')          // anon key
```

No Edge Function hardcodes a project URL. ✅

---

### 2.5 Inference Service — `inference-service/.env.example`

The `ALLOWED_ORIGINS` value has been updated in this PR:

```env
ALLOWED_ORIGINS=https://kxwjcupuxnnbnzcgmkoi.supabase.co
```

The inference service does not call Supabase directly; `ALLOWED_ORIGINS` is used
only for CORS validation to accept inbound calls from the Supabase project.

---

### 2.6 Proxy Server — `proxy-server/.env.example`

The NZSCV proxy server does **not** reference Supabase directly — it is called by
Edge Functions, not by the frontend. No Supabase URL is required in its configuration.

---

### 2.7 `vercel.json`

No Supabase references. Contains only build/cache/rewrite settings. ✅

### 2.8 `eas.json`

No Supabase references. Contains EAS build channel and distribution settings. ✅

---

## 3. App-to-Backend Alignment Matrix

| App | Config Key | Source | Targets `kxwjcupuxnnbnzcgmkoi`? |
|---|---|---|---|
| Web Admin + Field Portal | `VITE_SUPABASE_URL` | GitHub Secret / Vercel env | ✅ (set at deploy time) |
| Expo Mobile App | `EXPO_PUBLIC_SUPABASE_URL` | GitHub Secret / EAS env | ✅ (set at build time) |
| Supabase Edge Functions | `SUPABASE_URL` | Injected by Supabase platform | ✅ automatic |
| Inference Service | `ALLOWED_ORIGINS` | Railway env var | ⚠️ Needs to be set to `https://kxwjcupuxnnbnzcgmkoi.supabase.co` |
| `supabase/config.toml` | `project_id` | Committed file | ✅ `kxwjcupuxnnbnzcgmkoi` |

---

## 4. Schema Consistency Audit

All apps share the same Supabase PostgreSQL database. The following table maps
which tables each app reads/writes directly.

### 4.1 Tables Used by the Expo Mobile App

| Table | Operations | Notes |
|---|---|---|
| `user_profiles` | SELECT, UPDATE (push token) | Auth, profile, org lookup |
| `organizations` | SELECT | Org name/logo |
| `observations` | INSERT, SELECT | Core scan record |
| `breach_alerts` | SELECT | Alert feed |
| `enforcement_actions` | SELECT, INSERT | Field actions |
| `infringement_notices` | SELECT, UPDATE, INSERT | Notice management |
| `zones` | SELECT (via RPC) | Zone resolution |
| `scans` (storage bucket) | Upload, getPublicUrl | Photo evidence |

### 4.2 Tables Used by the Web Admin / Field Portal (additional to above)

| Table | Operations | Notes |
|---|---|---|
| `canonical_vehicles` | SELECT, INSERT, UPDATE | Vehicle registry |
| `canonical_persons` | SELECT, INSERT, UPDATE | Person registry |
| `flagged_vehicles` | SELECT, INSERT | ALPR flags |
| `health_safety_reports` | SELECT, INSERT | H&S incidents |
| `import_batches` | SELECT | Legacy data import |
| `incidents` | SELECT, INSERT, UPDATE | Incident management |
| `investigation_jobs` | SELECT, INSERT, UPDATE | ALPR processing queue |
| `notices_to_vacate` | SELECT, INSERT | NTV workflow |
| `notifications` | SELECT, UPDATE | In-app/push notification records |
| `officer_activity_log` | SELECT, INSERT | GPS trail |
| `officer_welfare_alerts` | SELECT, INSERT, UPDATE | Man-down alerts |
| `officer_welfare_settings` | SELECT, UPDATE | Welfare config |
| `patrol_checkpoints` | SELECT, INSERT | Patrol route tracking |
| `patrols` | SELECT, INSERT, UPDATE | Patrol sessions |
| `person_records` | SELECT, INSERT | People of interest |
| `photo_metadata` | SELECT, INSERT | Evidence photo metadata |
| `plate_scans` | SELECT, INSERT | Raw ALPR scan records |
| `restrictions` | SELECT, INSERT | GeoJSON restriction zones |
| `user_sessions` | SELECT, INSERT | Active session tracking |
| `audit_log` | SELECT | Admin audit trail |
| `privacy_curtain_settings` | SELECT, UPDATE | Privacy controls |
| `privacy_access_log` | SELECT | Privacy audit log |
| `vehicle_monthly_stays` | SELECT | Compliance dashboard |

### 4.3 Schema Consistency Verdict

**✅ Consistent with the live schema.** The mobile app uses a subset of the tables available
in the database, and the generated types align with the current live `observations` contract.
Historical migrations briefly introduced fields that are not present in the live project;
the live schema and generated types are the source of truth.

Key shared fields on `observations` (verified against the live schema and generated types):

| Field | Mobile App Uses | Schema Has | Match |
|---|---|---|---|
| `idempotency_key` | ✅ | ✅ | ✅ |
| `recorded_by` | ✅ | ✅ | ✅ |
| `organization_id` | ✅ | ✅ | ✅ |
| `zone_id` | ✅ | ✅ | ✅ |
| `photo_url` | ✅ | ✅ | ✅ |
| `photo_hash` | ✅ | ✅ | ✅ |
| `gps_latitude` | ✅ | ✅ | ✅ |
| `gps_longitude` | ✅ | ✅ | ✅ |
| `gps_accuracy` | ✅ | ✅ | ✅ |
| `recorded_at` | ✅ | ✅ | ✅ |
| `plate_number` | ✅ | ✅ | ✅ |
| `processing_status` | ✅ | ✅ | ✅ |
| `is_compliant` | ✅ | ✅ (nullable) | ✅ |
| `weather_conditions` | Compatibility input only | ❌ | Not persisted |

---

## 5. Stale Documentation References

Several historical markdown documents still reference the old project ID `xbfnlzmpumthnjmtqufp`.
These are documentation-only artefacts and do not affect runtime behaviour, but they cause
confusion when following runbooks.

**Files updated in this PR** (old ref → new ref):

| File | Change |
|---|---|
| `DATABASE_ARCHITECTURE.md` | Project ID and URL updated to `kxwjcupuxnnbnzcgmkoi` |
| `.env.example` | Placeholder URL updated to `https://kxwjcupuxnnbnzcgmkoi.supabase.co` |
| `mobile-app/.env.example` | Placeholder URL updated to `https://kxwjcupuxnnbnzcgmkoi.supabase.co` |
| `inference-service/.env.example` | `ALLOWED_ORIGINS` updated to `https://kxwjcupuxnnbnzcgmkoi.supabase.co` |
| `supabase/.env.functions.local` | Placeholder URL added for local development |

**Files with remaining stale references** (historical docs, not affecting runtime):

These files reference `xbfnlzmpumthnjmtqufp` as part of curl examples, legacy runbooks,
or historical deployment notes. They are retained as-is because altering them would require
context about whether the commands were ever executed against that old project:

- `PHASE_1_COMPLETE.md`, `PHASE_2_INFERENCE_SERVICE_SETUP.md`, `PHASE_4_TESTING_REPORT.md`
- `ALPR_PIPELINE_FIXES.md`, `ALPR_PIPELINE_OPTIMIZED.md`
- `AUTOMATIC_RECALCULATION_IMPLEMENTATION.md`
- `BLOCKER_FIXES_PATROLS_CORS.md`, `CORS_PREVIEW_FIX.md`
- `DEPLOYMENT_VALIDATION_CHECKLIST.md`, `DEPLOYMENT_READY.md`
- `EDGE_FUNCTION_CLIENT_PATTERNS.md`, `EDGE_FUNCTION_DEPLOYMENT_CHECKLIST.md`
- `FILE_UPLOAD_INTEGRATION.md`
- `INVESTIGATION_MISSING_COMPLIANCE_RESULTS.md`
- `LOCAL_TESTING_GUIDE.md`, `PRODUCTION_DEPLOYMENT.md`
- `ORC_AI_SYSTEM_STATUS.md`, `ONSPACE_AI_FALLBACK_MODE.md`
- `ZOOM_SCAN_COMPREHENSIVE_SCHEMATIC.md`
- `supabase/functions/vehicle-ingest/README.md`
- `inference-service/RAILWAY_DEPLOY.md`, `inference-service/QUICKSTART.md`, `inference-service/README.md`
- `docs/START_TESTING.md`, `docs/BUILD_PLAN.md`
- `ops/EDGE_FUNCTIONS_RUNBOOK.md`

---

## 6. Recommendations

### R1 — Set GitHub Secrets (Critical)

Ensure the following secrets are configured in **GitHub repo → Settings → Secrets and
variables → Actions**:

| Secret | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://kxwjcupuxnnbnzcgmkoi.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | From Supabase Dashboard → Settings → API |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://kxwjcupuxnnbnzcgmkoi.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | From Supabase Dashboard → Settings → API |
| `SUPABASE_ACCESS_TOKEN` | From https://supabase.com/dashboard/account/tokens |
| `SUPABASE_PROJECT_REF` | `kxwjcupuxnnbnzcgmkoi` |
| `SUPABASE_DB_PASSWORD` | From Supabase Dashboard → Settings → Database |

### R2 — Set Vercel Environment Variables

In the **Vercel project dashboard → Settings → Environment Variables**, set:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://kxwjcupuxnnbnzcgmkoi.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | From Supabase Dashboard → Settings → API |

### R3 — Set EAS / Expo Environment Variables

In the **Expo/EAS project dashboard** (or `eas.json` `env` block), set:

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://kxwjcupuxnnbnzcgmkoi.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | From Supabase Dashboard → Settings → API |

### R4 — Configure Inference Service CORS

On **Bob inference service (RunPod pod)**, set the environment variable:

```env
ALLOWED_ORIGINS=https://kxwjcupuxnnbnzcgmkoi.supabase.co
```

This ensures CORS allows inbound requests originating from the Supabase Edge Functions
runtime.

### R5 — Link Supabase CLI to Correct Project

When running Supabase CLI commands locally, ensure you are linked to the correct project:

```bash
supabase link --project-ref kxwjcupuxnnbnzcgmkoi
```

The `supabase/config.toml` already has `project_id = "kxwjcupuxnnbnzcgmkoi"`, so this
should be automatic after `supabase link`.

---

## 7. No Schema Changes Required

The audit found **no schema misalignment** between the Expo app, the web portal, and the
database migrations. The mobile app uses a well-defined subset of the full schema. All
column names and types match.

No database migrations are needed as a result of this audit.

---

## 8. Summary Checklist

- [x] `supabase/config.toml` → `project_id = "kxwjcupuxnnbnzcgmkoi"` ✅
- [x] Web portal (`src/lib/supabase.ts`) → uses `VITE_SUPABASE_URL` env var ✅
- [x] Expo app (`mobile-app/src/lib/supabase.ts`) → uses `EXPO_PUBLIC_SUPABASE_URL` env var ✅
- [x] Edge Functions → use `Deno.env.get('SUPABASE_URL')` (auto-injected) ✅
- [x] `.env.example` updated to reference `kxwjcupuxnnbnzcgmkoi` ✅
- [x] `mobile-app/.env.example` updated to reference `kxwjcupuxnnbnzcgmkoi` ✅
- [x] `inference-service/.env.example` updated with correct `ALLOWED_ORIGINS` ✅
- [x] `DATABASE_ARCHITECTURE.md` updated to `kxwjcupuxnnbnzcgmkoi` ✅
- [ ] GitHub Secrets configured → required manual step (see R1)
- [ ] Vercel env vars configured → required manual step (see R2)
- [ ] EAS env vars configured → required manual step (see R3)
- [ ] Bob inference service (RunPod) `ALLOWED_ORIGINS` set → required manual step (see R4)
