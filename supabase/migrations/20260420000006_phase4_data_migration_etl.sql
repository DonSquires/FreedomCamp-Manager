-- ============================================================================
-- Phase 4 Data Migration ETL
-- ============================================================================
-- Purpose: Migrate legacy data sources into the V4 canonical tables.
--
-- Steps:
--   1. Backfill canonical_homeless from flagged_vehicles (homeless-flagged plates)
--   2. Row-count parity view for the 36 retained tables
--   3. Reconciliation helper: detect orphaned observations (no zone match)
--   4. Reconciliation helper: detect breach_alerts with no observation link
--   5. Archive strategy marker for out-of-scope tables
-- ============================================================================

-- ── 1. ETL: flagged_vehicles → canonical_homeless ────────────────────────────
-- flagged_vehicles is an org-scoped "watch list" table. Plates flagged with
-- priority = 'high' or 'critical' are promoted into canonical_homeless with
-- status = 'suspected'. Plates already in canonical_homeless are not
-- downgraded — only upgraded if the incoming status is higher.

DO $$
BEGIN
  IF to_regclass('public.canonical_homeless') IS NOT NULL
     AND to_regclass('public.flagged_vehicles') IS NOT NULL THEN
    INSERT INTO public.canonical_homeless (
      plate_number,
      status,
      source,
      notes,
      created_at,
      updated_at
    )
    SELECT
      fv.plate_number,
      -- Map priority → homeless status. 'high'/'critical' → suspected; lower → skip.
      CASE
        WHEN fv.priority IN ('high', 'critical') THEN 'suspected'
        ELSE 'none'
      END                    AS status,
      'flagged_vehicles_etl' AS source,
      fv.reason              AS notes,
      fv.created_at,
      fv.updated_at
    FROM public.flagged_vehicles fv
    WHERE fv.priority IN ('high', 'critical')
      AND fv.plate_number IS NOT NULL
      AND fv.plate_number != ''
    ON CONFLICT (plate_number) DO UPDATE SET
      status = CASE
        -- Only upgrade status; confirmed/claimed are never downgraded to suspected
        WHEN public.canonical_homeless.status IN ('confirmed', 'claimed') THEN public.canonical_homeless.status
        WHEN EXCLUDED.status = 'suspected'
         AND public.canonical_homeless.status = 'none'  THEN 'suspected'
        ELSE public.canonical_homeless.status
      END,
      notes      = COALESCE(public.canonical_homeless.notes, EXCLUDED.notes),
      updated_at = GREATEST(public.canonical_homeless.updated_at, EXCLUDED.updated_at);
  END IF;
END $$;


-- ── 2. Row-count parity view ─────────────────────────────────────────────────
-- A view returning estimated row counts for all V4 retained tables.
-- Uses pg_stat_user_tables for reliability across schema changes.
-- Run ANALYZE first for accurate counts.

CREATE OR REPLACE VIEW public.v4_table_parity AS
SELECT
  relname                                              AS table_name,
  n_live_tup                                          AS estimated_row_count,
  last_autoanalyze::date                              AS last_analyzed
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND relname IN (
    'organizations', 'user_profiles', 'zones', 'zone_compliance_matrix',
    'zone_legal_config', 'observations', 'breach_alerts', 'infringement_notices',
    'notices_to_vacate', 'enforcement_cases', 'enforcement_case_events',
    'dispute_intake', 'canonical_vehicles', 'canonical_scv', 'canonical_homeless',
    'patrols', 'patrol_schedule_zones', 'patrol_checkpoints', 'checkpoint_visits',
    'officer_shifts', 'officer_welfare_settings', 'officer_welfare_alerts',
    'officer_activity_log', 'person_records', 'person_observations',
    'person_interactions', 'person_vehicle_links', 'incident_attachments',
    'audit_log', 'privacy_access_log', 'privacy_curtain_settings',
    'retention_policies'
  )
ORDER BY relname;

COMMENT ON VIEW public.v4_table_parity IS
  'Phase 4 parity report: estimated row counts for all V4 retained tables. Run ANALYZE first for accuracy.';


-- ── 3. Reconciliation: orphaned observations ─────────────────────────────────
-- Observations that reference a zone_id that no longer exists.
-- Returns plates + zone_id so operators can reassign or archive.

CREATE OR REPLACE VIEW public.recon_orphaned_observations AS
SELECT
  o.id,
  o.plate_number,
  o.zone_id,
  o.recorded_at,
  o.organization_id
FROM public.observations o
LEFT JOIN public.zones z ON z.id = o.zone_id
WHERE o.zone_id IS NOT NULL
  AND z.id IS NULL
ORDER BY o.recorded_at DESC;

COMMENT ON VIEW public.recon_orphaned_observations IS
  'Reconciliation: observations referencing deleted zones. Rows here need zone reassignment or archiving.';


-- ── 4. Reconciliation: breach_alerts with no observation ─────────────────────
-- breach_alerts that reference an observation_id not in the observations table.

CREATE OR REPLACE VIEW public.recon_orphaned_breach_alerts AS
SELECT
  ba.id,
  ba.observation_id,
  ba.plate_number,
  ba.zone_id,
  ba.created_at,
  ba.organization_id
FROM public.breach_alerts ba
LEFT JOIN public.observations o ON o.id = ba.observation_id
WHERE ba.observation_id IS NOT NULL
  AND o.id IS NULL
ORDER BY ba.created_at DESC;

COMMENT ON VIEW public.recon_orphaned_breach_alerts IS
  'Reconciliation: breach_alerts referencing deleted observations. These should be dismissed.';


-- ── 5. Reconciliation: observations missing compliance evaluation ─────────────
-- Observations that have no breach_alert and is_compliant IS NULL (never evaluated).

CREATE OR REPLACE VIEW public.recon_unevaluated_observations AS
SELECT
  o.id,
  o.plate_number,
  o.zone_id,
  o.recorded_at,
  o.organization_id,
  o.is_compliant
FROM public.observations o
WHERE o.is_compliant IS NULL
  AND o.recorded_at > now() - INTERVAL '90 days'
ORDER BY o.recorded_at DESC;

COMMENT ON VIEW public.recon_unevaluated_observations IS
  'Reconciliation: observations in the last 90 days with no compliance evaluation. Run cleanup-and-recalculate to fix.';


-- ── 6. Archive strategy marker ───────────────────────────────────────────────
-- Tables that are OUTSIDE the V4 clean model scope and are candidates for
-- archiving after parity confirmation. This comment is intentionally left as
-- a SQL comment so it is preserved in migration history.

-- Tables confirmed as OUTSIDE V4 scope (data migration to canonical tables complete):
--   flagged_vehicles    → superseded by canonical_homeless (ETL above); keep until cutover confirmed
--   homeless_records    → superseded by canonical_homeless; backfill already in 20260421000001
--   canonical_vehicles  → columns self_contained/homeless_status superseded by canonical_scv/canonical_homeless
--                         but canonical_vehicles itself is KEPT as the plate-level vehicle registry
--
-- Tables with undetermined scope (audit required before archiving):
--   incidents           → may overlap with enforcement_cases; investigate before archiving
--   health_safety_reports → org-scoped; no direct V4 equivalent; keep for now
--   zone_signage_evidence → kept (court-ready evidence); no archiving planned
--
-- DO NOT DROP any table listed here until:
--   a) v4_table_parity shows the canonical replacement has equivalent data
--   b) All edge functions and frontend pages have been updated to use the new table
--   c) A full smoke test has been run per REBUILD_TODO Phase 5
