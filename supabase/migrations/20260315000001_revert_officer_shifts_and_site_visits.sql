-- ============================================================================
-- Revert: Officer Shifts and Patrol Site Visit Tracking
-- Date: 2026-03-15
--
-- Drops the officer_shifts and patrol_site_visits tables that were introduced
-- in migration 20260409000000_geofence_zone_checkpoints_and_site_visits.sql.
-- Also removes the checkpoint_type column added to patrol_checkpoints.
--
-- The patrol schedule / KPI tables (patrol_schedule_zones, patrols extra
-- columns) and the patrol auto-start fix are intentionally preserved.
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- Drop patrol_site_visits first (FK to officer_shifts)
DROP TABLE IF EXISTS public.patrol_site_visits CASCADE;

-- Drop officer_shifts
DROP TABLE IF EXISTS public.officer_shifts CASCADE;

-- Remove checkpoint_type column from patrol_checkpoints if present
ALTER TABLE public.patrol_checkpoints
  DROP COLUMN IF EXISTS checkpoint_type;

-- Remove shift_id from patrols if present (was an FK to officer_shifts)
ALTER TABLE public.patrols
  DROP COLUMN IF EXISTS shift_id;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
