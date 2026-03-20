-- ============================================================================
-- Reset reporting / enforcement state while keeping source-of-truth data
-- Date: 2026-03-20
--
-- Preserves:
--   - observations
--   - canonical_vehicles
--   - canonical_homeless
--   - homeless_records
--   - canonical_scv
--   - photo_metadata
--   - organizations / user_profiles
--   - zones / restrictions / zone_compliance_matrix / zone_legal_config
--   - officer_welfare_settings
--   - investigation_job_types / investigation_job_templates
--
-- Removes:
--   - derived reports, alerts, notices, incidents, patrol runs, logs,
--     reporting caches, import batches, staging data, and enforcement outputs.
--
-- IMPORTANT:
--   1. Run a database backup/snapshot before executing.
--   2. Run this in Supabase SQL Editor.
--   3. After execution, re-run repair/recalculation pipelines to rebuild
--      derived state from preserved observations.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1) Break FKs from preserved observations to tables we are about to clear.
-- --------------------------------------------------------------------------
UPDATE public.observations
SET
  incident_id = NULL,
  hs_incident_id = NULL,
  has_incident = false,
  has_hs_incident = false,
  updated_at = now()
WHERE incident_id IS NOT NULL
   OR hs_incident_id IS NOT NULL
   OR COALESCE(has_incident, false) = true
   OR COALESCE(has_hs_incident, false) = true;

-- --------------------------------------------------------------------------
-- 2) Reset derived state on preserved observations.
--    Keep raw capture fields: plate, org, zone, recorded_at, notes, GPS,
--    photo refs, manual flags, and legacy provenance.
-- --------------------------------------------------------------------------
UPDATE public.observations
SET
  breach_details = NULL,
  breach_detected_at = NULL,
  breach_reason = NULL,
  breach_type = NULL,
  breach_warning = NULL,
  breach_warning_reason = NULL,
  compliance_snapshot = NULL,
  consecutive_nights = NULL,
  discrepancy_flags = NULL,
  has_discrepancies = NULL,
  is_breach = NULL,
  is_compliant = NULL,
  movement_background_similarity = NULL,
  movement_decision = NULL,
  movement_moved = NULL,
  movement_vehicle_bbox_iou = NULL,
  nights_stayed_this_month = NULL,
  processing_completed_at = NULL,
  processing_error = NULL,
  processing_started_at = NULL,
  processing_status = NULL,
  updated_at = now();

-- --------------------------------------------------------------------------
-- 3) Reset derived counters on preserved canonical vehicles.
--    Keep identity, owner/NZSCV/homeless/profile photo fields intact.
-- --------------------------------------------------------------------------
UPDATE public.canonical_vehicles
SET
  enforcement_count = 0,
  last_enforcement_at = NULL,
  last_enforcement_type = NULL,
  last_note_at = NULL,
  last_note_preview = NULL,
  total_breaches = 0,
  total_hs_reports = 0,
  total_incidents = 0,
  total_notes = 0,
  total_observations = 0,
  updated_at = now();

-- Rehydrate first/last seen + observation counts from preserved observations.
WITH obs_rollup AS (
  SELECT
    plate_number,
    MIN(recorded_at) AS first_seen_at,
    MAX(recorded_at) AS last_seen_at,
    COUNT(*)::integer AS total_observations
  FROM public.observations
  WHERE deleted_at IS NULL
  GROUP BY plate_number
)
UPDATE public.canonical_vehicles cv
SET
  first_seen_at = o.first_seen_at,
  last_seen_at = o.last_seen_at,
  total_observations = o.total_observations,
  updated_at = now()
FROM obs_rollup o
WHERE o.plate_number = cv.plate_number;

-- --------------------------------------------------------------------------
-- 4) Truncate every public base table except the preservation whitelist.
--    Truncating them together avoids FK-order issues between derived tables.
-- --------------------------------------------------------------------------
-- Tables still referenced by preserved observations cannot be truncated, even
-- after we null the FK values above. PostgreSQL requires DELETE for those.
DELETE FROM public.health_safety_reports;
DELETE FROM public.incidents;

DO $$
DECLARE
  preserved_tables constant text[] := ARRAY[
    'canonical_homeless',
    'canonical_scv',
    'canonical_vehicles',
    'homeless_records',
    'observations',
    'photo_metadata',
    'organizations',
    'user_profiles',
    'zones',
    'restrictions',
    'zone_compliance_matrix',
    'zone_legal_config',
    'officer_welfare_settings',
    'investigation_job_templates',
    'investigation_job_types',
    'health_safety_reports',
    'incidents'
  ];
  excluded_extension_tables constant text[] := ARRAY[
    'geography_columns',
    'geometry_columns',
    'spatial_ref_sys'
  ];
  tables_to_truncate text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY tablename)
  INTO tables_to_truncate
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename <> ALL (preserved_tables)
    AND tablename <> ALL (excluded_extension_tables);

  IF tables_to_truncate IS NOT NULL THEN
    RAISE NOTICE 'Truncating derived/reporting tables: %', tables_to_truncate;
    EXECUTE 'TRUNCATE TABLE ' || tables_to_truncate || ' RESTART IDENTITY';
  ELSE
    RAISE NOTICE 'No candidate tables found to truncate.';
  END IF;
END $$;

COMMIT;

-- --------------------------------------------------------------------------
-- Suggested next steps after this reset:
--   1. Apply org-scoped zone canonicalization fix.
--   2. Run zone correction / reassignment review.
--   3. Re-run photo reingest for rows with real photos.
--   4. Run compliance recalculation.
--   5. Recreate breach / notice / report outputs from corrected observations.
-- --------------------------------------------------------------------------