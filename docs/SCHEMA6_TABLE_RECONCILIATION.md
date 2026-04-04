# Schema Extract #6 Table Reconciliation

Last updated: 2026-04-04
Source snapshot: `/tmp/rail-audit/schema6/extracted/20260404_005054`

## Summary

The `tables.txt` artifact reports 31 public tables, but this does not match the richer `live/database.ts` artifact from the same extract run.

For rebuild closure, table status should be determined from both:
- `tools/schema-extract/output/live/database.ts` shape (captured as `/tmp/rail-audit/schema6/extracted/live/database.ts`)
- canonical migration files in `supabase/migrations/`

## Classification

### A) Present in schema/types, absent from `tables.txt` (extract artifact mismatch)

These are not true missing tables. They exist in type snapshots and/or migration history:
- `user_profiles`
- `zone_signage_evidence`
- `observations`
- `breach_alerts`
- `canonical_vehicles`
- `infringement_notices`
- `notices_to_vacate`
- `patrols`
- `patrol_schedule_zones`
- `officer_shifts`
- `officer_welfare_settings`
- `officer_welfare_alerts`
- `officer_activity_log`
- `incidents`
- `health_safety_reports`
- `person_observations`
- `person_interactions`
- `audit_log`
- `dispute_intake`

### B) True gap set for rebuild keep-list (migration replay required)

These are absent from Schema #6 live type snapshot and should be explicitly restored from canonical migrations:
- `enforcement_cases`
- `enforcement_case_events`
- `patrol_checkpoints`
- `checkpoint_visits`
- `incident_attachments`
- `person_vehicle_links`
- `privacy_access_log`
- `retention_policies`

## Canonical Migration Sources

- `enforcement_cases`, `enforcement_case_events`, `incident_attachments`, `person_vehicle_links`
  - `supabase/migrations/20260220000005_core_pipeline_rebuild.sql`
- `retention_policies`
  - `supabase/migrations/20260219000002_evidence_integrity_and_legal_compliance.sql`
- `patrol_checkpoints`, `checkpoint_visits`
  - `supabase/migrations/20260302000003_patrol_checkpoints.sql`
- `privacy_access_log`
  - `supabase/migrations/20260302000004_privacy_curtain.sql`

## Decision

Use migration replay for the eight-table true gap set instead of inventing new schema definitions.
That keeps parity with existing project design and avoids accidental drift.
