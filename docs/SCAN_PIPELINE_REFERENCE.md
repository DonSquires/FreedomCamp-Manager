# Scan Pipeline Reference — Working Architecture

> **Authoritative reference** for the observation scan pipeline.
> Based on the verified working system from February 2025 (migrations
> `20250203000002` through `20250214000001`) when officers could take photos
> and receive compliance notifications.

**Last updated:** 2026-03-13
**Status:** This document describes the target architecture that all code
paths must converge to.

---

## 1. The Working Flow (Feb 2025)

```
Officer Captures Photo
         │
         ▼
┌─────────────────────────────────┐
│ 1. Upload photo to Storage      │  Bucket: scans
│    (evidence preserved FIRST)   │  → public URL
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ 2. Resolve Zone                 │  GPS → zone geofence match
│    (or create "Other Location") │  → zone_id
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ 3. INSERT INTO observations     │  Minimal payload:
│                                 │    plate_number, photo, photo_url,
│                                 │    recorded_at, zone_id, org_id,
│                                 │    gps_lat/lng, recorded_by
└─────────────────────────────────┘
         │
   ┌─────┴──── TRIGGERS FIRE ────────────────────────────────┐
   │                                                          │
   │  BEFORE INSERT:                                          │
   │  ┌───────────────────────────────────────────────────┐   │
   │  │ 1. trigger_populate_observation_from_canonical    │   │
   │  │    → Reads canonical_vehicles by plate_number     │   │
   │  │    → Copies vehicle_make/model/color/year         │   │
   │  │    → Copies self_contained, self_contained_expiry │   │
   │  │    → Copies is_homeless status                    │   │
   │  └───────────────────────────────────────────────────┘   │
   │  ┌───────────────────────────────────────────────────┐   │
   │  │ 2. trg_auto_evaluate_compliance                   │   │
   │  │    → Looks up zone_compliance_matrix rules        │   │
   │  │    → Evaluates 4 compliance rules (see §3)        │   │
   │  │    → Sets is_compliant, breach_type, breach_reason│   │
   │  │    → Sets nights_stayed_this_month, consecutive   │   │
   │  └───────────────────────────────────────────────────┘   │
   │                                                          │
   │  (Row written to disk with vehicle + compliance data)    │
   │                                                          │
   │  AFTER INSERT:                                           │
   │  ┌───────────────────────────────────────────────────┐   │
   │  │ 3. trigger_auto_create_compliance_result          │   │
   │  │    → INSERT INTO compliance_results               │   │
   │  │    → Includes matrix_snapshot for audit trail      │   │
   │  │    → This triggers breach_alert creation if        │   │
   │  │      is_compliant = false                          │   │
   │  └───────────────────────────────────────────────────┘   │
   │  ┌───────────────────────────────────────────────────┐   │
   │  │ 4. trigger_update_canonical_stats_v2              │   │
   │  │    → Updates canonical_vehicles:                   │   │
   │  │      total_observations++, last_seen_at            │   │
   │  └───────────────────────────────────────────────────┘   │
   │  ┌───────────────────────────────────────────────────┐   │
   │  │ 5. trigger_update_monthly_stays                   │   │
   │  │    → Upserts vehicle_monthly_stays                 │   │
   │  │    → Tracks nights_stayed, consecutive_nights      │   │
   │  └───────────────────────────────────────────────────┘   │
   │  ┌───────────────────────────────────────────────────┐   │
   │  │ 6. trigger_sync_homeless_to_canonical             │   │
   │  │    → (only fires if has_homeless_claim = true)     │   │
   │  │    → Updates canonical_vehicles.is_homeless        │   │
   │  └───────────────────────────────────────────────────┘   │
   └──────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ 4. Return observation to UI     │  Officer sees:
│    with compliance result       │    ✅ Compliant or
│                                 │    ❌ Breach detected: [type]
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ 5. Fire-and-forget ALPR         │  Async plate recognition
│    (UPDATE mode)                │  Updates plate_number when done
│                                 │  Officer doesn't wait for this
└─────────────────────────────────┘
```

---

## 2. Compliance Rules (4 checks)

These are evaluated by `auto_evaluate_compliance()` (BEFORE INSERT trigger)
and `auto_create_compliance_result()` (AFTER INSERT trigger):

| # | Rule | Condition | Breach Type | Homeless Exempt? |
|---|------|-----------|-------------|------------------|
| 1 | **Day-visit only** | Zone is day-visit-only AND observation at 20:00–08:00 NZT | `day_visit_violation` | No |
| 2 | **Monthly nights** | `nights_stayed_this_month > nights_per_month` | `monthly_limit` | Yes (if confirmed) |
| 3 | **Consecutive nights** | `consecutive_nights > max_consecutive_nights` | `consecutive_nights` | Yes (if confirmed) |
| 4 | **Self-contained** | Zone requires CSC AND vehicle not self-contained | `self_contained` | Yes (if confirmed) |

Rules are looked up from `zone_compliance_matrix` (preferred) or `zones` table (fallback).

---

## 3. Tables Written on Each Observation

A single observation INSERT causes writes to **4–5 tables**:

| Table | Operation | Trigger/Source |
|-------|-----------|----------------|
| `observations` | INSERT | Direct insert |
| `compliance_results` | INSERT | `trigger_auto_create_compliance_result` |
| `canonical_vehicles` | UPDATE (stats) | `trigger_update_canonical_stats_v2` |
| `vehicle_monthly_stays` | UPSERT | `trigger_update_monthly_stays` |
| `breach_alerts` | INSERT (conditional) | Triggered from `compliance_results` INSERT |

---

## 4. Three Insert Paths (Current)

The FieldOfficerPortal has three paths to insert observations:

| Path | Method | Triggers Fire? | Compliance Complete? |
|------|--------|---------------|---------------------|
| **PATH 1** | Direct `.from('observations').insert()` | ✅ All 7 | ✅ Full pipeline |
| **PATH 2** | `vehicle-ingest` edge function → `adaptiveObservationInsert()` | ✅ All 7 (or RPC fallback) | ✅ Full pipeline |
| **PATH 3** | `safe_insert_observation` RPC | ❌ Bypassed | ✅ Inline equivalent (restored in 20260404000002) |

All three paths converge to the same outcome:
- PATH 1: Triggers fire directly on INSERT
- PATH 2: Uses `adaptiveObservationInsert()` from `_shared/observationInsert.ts`
  which retries on schema drift errors and falls back to `safe_insert_observation`
  RPC when the COALESCE trigger error persists
- PATH 3: `safe_insert_observation` RPC runs the full compliance pipeline inline
  (canonical lookup → compliance evaluation → compliance_results → breach_alerts)

---

## 5. Source Migrations (Working Period)

| Migration | Date | Purpose |
|-----------|------|---------|
| `20250203000002_rebuild_vehicle_architecture.sql` | Feb 3 | Created canonical_vehicles, observations table, BEFORE INSERT triggers |
| `20250203000004_update_overnight_logic.sql` | Feb 3 | Created trigger_update_monthly_stays |
| `20250213000002_phase1_database_cleanup.sql` | Feb 13 | Consolidated triggers, added sync_homeless_to_canonical |
| `20250214000001_auto_create_compliance_results.sql` | Feb 14 | **Key: auto_create_compliance_result trigger** — the compliance notification system |
| `20260401000002_hotfix_coalesce_type_mismatch.sql` | Apr 1 | Fixed COALESCE error in auto_evaluate_compliance with exception-wrapped type handling |
| `20260404000002_restore_safe_insert_pipeline.sql` | Apr 4 | Restored full pipeline in safe_insert_observation RPC |

---

## 6. Key Files

| File | Role |
|------|------|
| `src/pages/FieldOfficerPortal.tsx` | Officer scan UI — photo capture, GPS, upload, observation insert |
| `src/lib/edgeFunctions.ts` | Edge function client — `ingestVehicleObservation()`, `processALPR()` |
| `supabase/functions/vehicle-ingest/index.ts` | Server-side ingest orchestrator (inference, canonical vehicle, observation insert) |
| `supabase/functions/alpr-process/index.ts` | 3-stage plate recognition pipeline |
| `supabase/functions/_shared/observationInsert.ts` | Adaptive insert helper with COALESCE error handling |
| `supabase/functions/_shared/alpr.ts` | Plate Recognizer API client |
| `docs/LIVE_TRIGGERS.md` | Authoritative trigger reference (7 observation triggers) |

---

## 7. Debugging Checklist

When scans fail, check in order:

1. **COALESCE error?** → Deploy migration `20260401000002` (fixes trigger) or check PATH 3 fallback is active
2. **Missing column error?** → Adaptive insert strips unknown columns — check logs for dropped columns
3. **Observation saved but no compliance?** → Check `compliance_results` table for the observation_id
4. **No breach alerts?** → Check that `create_breach_alert_from_compliance()` trigger exists on `compliance_results`
5. **Vehicle details NULL?** → Check `canonical_vehicles` has a row for the plate_number
6. **Monthly stays not tracking?** → Check `vehicle_monthly_stays` table and `trigger_update_monthly_stays`
