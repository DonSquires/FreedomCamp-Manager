-- ============================================================================
-- Add missing operational columns to flagged_vehicles
-- Date: 2026-04-15
--
-- Context:
--   The original flagged_vehicles schema (20250101_initial_schema.sql) only
--   contained: id, organization_id, plate_number, reason, priority, flagged_by,
--   created_at, updated_at.
--
--   Multiple edge functions and the frontend already reference the following
--   columns which had never been added:
--     - notes             (process-homeless-data, useFlaggedVehicles hook)
--     - is_active         (stream-webhook, AdminFollowUpDrawer, useFlaggedVehicles)
--     - last_known_site   (process-homeless-data)
--     - date_recorded     (process-homeless-data)
--     - vehicle_description (process-homeless-data)
--     - name_contact      (process-homeless-data)
--     - confirmed_homeless (process-homeless-data)
--     - created_by        (process-homeless-data)
--     - attachments       (select-best-vehicle-photo)
--
--   NOTE: The BUILD_PLAN marks flagged_vehicles as "deprecated — merged into
--   canonical_vehicles.is_flagged". However, because active code still writes to
--   and reads from this table, we must add the missing columns now to prevent
--   runtime errors. A future migration can deprecate the table once all
--   callers are migrated to canonical_vehicles.
--
-- Idempotent: all statements use ADD COLUMN IF NOT EXISTS.
-- ============================================================================

BEGIN;

-- Core operational fields
ALTER TABLE public.flagged_vehicles
  ADD COLUMN IF NOT EXISTS notes              TEXT,
  ADD COLUMN IF NOT EXISTS is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_known_site    TEXT,
  ADD COLUMN IF NOT EXISTS date_recorded      DATE,
  ADD COLUMN IF NOT EXISTS vehicle_description TEXT,
  ADD COLUMN IF NOT EXISTS name_contact       TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_homeless BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_by         UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attachments        JSONB DEFAULT '[]'::jsonb;

-- Index for is_active queries (stream-webhook and AdminFollowUpDrawer filter on this)
CREATE INDEX IF NOT EXISTS idx_flagged_vehicles_active
  ON public.flagged_vehicles(organization_id, is_active)
  WHERE is_active = TRUE;

-- Index for plate + org lookups (process-homeless-data upsert pattern)
CREATE INDEX IF NOT EXISTS idx_flagged_vehicles_plate_org
  ON public.flagged_vehicles(plate_number, organization_id);

COMMENT ON COLUMN public.flagged_vehicles.notes              IS 'Officer / system notes. Appended on successive homeless data imports.';
COMMENT ON COLUMN public.flagged_vehicles.is_active          IS 'FALSE = soft-deleted / resolved flag. Defaults TRUE on insert.';
COMMENT ON COLUMN public.flagged_vehicles.last_known_site    IS 'Last known camping site from homeless data import.';
COMMENT ON COLUMN public.flagged_vehicles.date_recorded      IS 'Date the safety concern was first recorded.';
COMMENT ON COLUMN public.flagged_vehicles.vehicle_description IS 'Physical vehicle description from homeless data source.';
COMMENT ON COLUMN public.flagged_vehicles.name_contact       IS 'Contact name associated with this vehicle / occupant.';
COMMENT ON COLUMN public.flagged_vehicles.confirmed_homeless IS 'TRUE when the homeless status has been confirmed by a data source.';
COMMENT ON COLUMN public.flagged_vehicles.created_by         IS 'User who created this flag (NULL for system-generated flags).';
COMMENT ON COLUMN public.flagged_vehicles.attachments        IS 'Array of attachment objects [{url, type, label}]. Used by select-best-vehicle-photo.';

-- Verify
DO $$
DECLARE
  missing TEXT[] := '{}';
  col_name TEXT;
BEGIN
  FOREACH col_name IN ARRAY ARRAY['notes','is_active','last_known_site','date_recorded',
    'vehicle_description','name_contact','confirmed_homeless','created_by','attachments'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'flagged_vehicles'
        AND column_name = col_name
    ) THEN
      missing := array_append(missing, col_name);
    END IF;
  END LOOP;

  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION '20260415000001: flagged_vehicles still missing columns: %', array_to_string(missing, ', ');
  ELSE
    RAISE NOTICE '20260415000001: flagged_vehicles — all 9 columns confirmed present ✓';
  END IF;
END;
$$;

COMMIT;
