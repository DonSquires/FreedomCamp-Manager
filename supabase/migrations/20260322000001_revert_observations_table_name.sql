-- ============================================================================
-- Revert table name only
-- Date: 2026-03-22
--
-- Goal:
--   Rename public.vehicle_observations_v2 -> public.observations.
--
-- Scope:
--   Name change only. No views, grants, comments, or schema side-effects.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  has_v2_table boolean;
  has_obs_table boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_observations_v2'
      AND table_type = 'BASE TABLE'
  ) INTO has_v2_table;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'observations'
      AND table_type = 'BASE TABLE'
  ) INTO has_obs_table;

  IF has_v2_table AND NOT has_obs_table THEN
    ALTER TABLE public.vehicle_observations_v2 RENAME TO observations;
    RAISE NOTICE 'Renamed public.vehicle_observations_v2 -> public.observations';
  ELSIF has_v2_table AND has_obs_table THEN
    RAISE NOTICE 'Both public.vehicle_observations_v2 and public.observations exist; no rename performed.';
  ELSIF NOT has_v2_table AND has_obs_table THEN
    RAISE NOTICE 'public.observations already exists; no rename needed.';
  ELSE
    RAISE EXCEPTION 'Neither public.vehicle_observations_v2 nor public.observations exists.';
  END IF;
END;
$$;

COMMIT;
