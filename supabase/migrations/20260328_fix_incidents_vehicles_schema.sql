-- ============================================================================
-- FIX INCIDENTS & CANONICAL VEHICLES SCHEMA MISMATCHES
-- ============================================================================
-- Background
-- ----------
-- The `incidents` table was created in 20250101_initial_schema.sql.
-- Migration 20260224000003_incident_evidence_system.sql attempted to
-- recreate it with a richer schema, but used CREATE TABLE IF NOT EXISTS so
-- the statement was a no-op — the existing table was kept.  This migration
-- adds the missing columns to the live table.
--
-- canonical_vehicles is missing `is_exempt` (used by VehicleManagement UI)
-- and the homeless_status CHECK constraint must include 'declined' which the
-- UI already tracks.
-- ============================================================================

-- ============================================================================
-- 1. incidents — add columns introduced in the 2026 evidence system
-- ============================================================================

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS plate_number         TEXT,
  ADD COLUMN IF NOT EXISTS evidence_count       INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS primary_evidence_url TEXT,
  ADD COLUMN IF NOT EXISTS location_lat         NUMERIC(10,8),
  ADD COLUMN IF NOT EXISTS location_lng         NUMERIC(11,8),
  ADD COLUMN IF NOT EXISTS location_address     TEXT,
  ADD COLUMN IF NOT EXISTS notes                TEXT,
  ADD COLUMN IF NOT EXISTS metadata             JSONB       DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS user_id              UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at           TIMESTAMPTZ;

-- Index the new plate_number and deleted_at columns
CREATE INDEX IF NOT EXISTS idx_incidents_plate     ON public.incidents(plate_number) WHERE plate_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_deleted   ON public.incidents(created_at DESC) WHERE deleted_at IS NULL;

-- ============================================================================
-- 2. canonical_vehicles — add is_exempt flag
-- ============================================================================
-- `is_exempt` marks vehicles that have been granted a formal exemption from
-- freedom-camping enforcement (distinct from homeless status).

ALTER TABLE public.canonical_vehicles
  ADD COLUMN IF NOT EXISTS is_exempt BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_exempt
  ON public.canonical_vehicles(is_exempt) WHERE is_exempt = TRUE;

-- ============================================================================
-- 3. canonical_vehicles — add 'declined' to homeless_status CHECK constraint
-- ============================================================================
-- The UI (HOMELESS_UI_STATUSES) already tracks 'declined' (owner declined
-- homeless status).  Broaden the constraint to accept it.

ALTER TABLE public.canonical_vehicles
  DROP CONSTRAINT IF EXISTS canonical_vehicles_homeless_status_check;

ALTER TABLE public.canonical_vehicles
  ADD CONSTRAINT canonical_vehicles_homeless_status_check
    CHECK (homeless_status IN ('none', 'claimed', 'confirmed', 'suspected', 'declined'));

-- ============================================================================
-- Verification
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '✅ incidents: plate_number, evidence_count, location_*, notes, metadata, user_id, deleted_at added';
  RAISE NOTICE '✅ canonical_vehicles: is_exempt added';
  RAISE NOTICE '✅ canonical_vehicles: homeless_status CHECK updated to include declined';
END;
$$;
