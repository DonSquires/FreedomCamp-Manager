-- ============================================================================
-- Compatibility shim: vehicle_observations_v2 -> observations
-- Date: 2026-03-17
--
-- Purpose:
--   Prevent runtime failures from stale SQL/function bodies that still refer to
--   public.vehicle_observations_v2 while the canonical table is public.observations.
--
-- Strategy:
--   - Keep observations as the single source of truth.
--   - Create an updatable compatibility view named vehicle_observations_v2.
--   - Add INSERT/UPDATE/DELETE rules so legacy DML against the old name writes
--     through to observations.
--
-- Notes:
--   - This does NOT rename the canonical table.
--   - This migration is idempotent and safe to re-run.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_obs_exists BOOLEAN;
  v_v2_table_exists BOOLEAN;
  v_v2_view_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'observations'
      AND table_type = 'BASE TABLE'
  ) INTO v_obs_exists;

  IF NOT v_obs_exists THEN
    RAISE EXCEPTION 'public.observations table is missing; cannot create compatibility view';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_observations_v2'
      AND table_type = 'BASE TABLE'
  ) INTO v_v2_table_exists;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.views
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_observations_v2'
  ) INTO v_v2_view_exists;

  IF v_v2_table_exists THEN
    RAISE NOTICE 'public.vehicle_observations_v2 exists as BASE TABLE; leaving unchanged';
  ELSIF NOT v_v2_view_exists THEN
    EXECUTE 'CREATE VIEW public.vehicle_observations_v2 AS SELECT * FROM public.observations';
    RAISE NOTICE 'Created compatibility view public.vehicle_observations_v2 -> public.observations';
  ELSE
    EXECUTE 'CREATE OR REPLACE VIEW public.vehicle_observations_v2 AS SELECT * FROM public.observations';
    RAISE NOTICE 'Refreshed compatibility view public.vehicle_observations_v2';
  END IF;
END;
$$;

-- Ensure legacy writes continue to work when vehicle_observations_v2 is a view.
DO $$
DECLARE
  v_v2_view_exists BOOLEAN;
  v_obs_pk_col text;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.views
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_observations_v2'
  ) INTO v_v2_view_exists;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'observations'
      AND column_name = 'observation_id'
  ) THEN
    v_obs_pk_col := 'observation_id';
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'observations'
      AND column_name = 'id'
  ) THEN
    v_obs_pk_col := 'id';
  ELSE
    RAISE EXCEPTION 'public.observations has neither observation_id nor id';
  END IF;

  IF v_v2_view_exists THEN
    EXECUTE 'DROP RULE IF EXISTS vehicle_observations_v2_insert ON public.vehicle_observations_v2';
    EXECUTE 'DROP RULE IF EXISTS vehicle_observations_v2_update ON public.vehicle_observations_v2';
    EXECUTE 'DROP RULE IF EXISTS vehicle_observations_v2_delete ON public.vehicle_observations_v2';

    EXECUTE $rule$
      CREATE RULE vehicle_observations_v2_insert AS
      ON INSERT TO public.vehicle_observations_v2
      DO INSTEAD
      INSERT INTO public.observations VALUES (NEW.*)
      RETURNING *
    $rule$;

    EXECUTE format($rule$
      CREATE RULE vehicle_observations_v2_update AS
      ON UPDATE TO public.vehicle_observations_v2
      DO INSTEAD
      UPDATE public.observations SET
        plate_number = NEW.plate_number,
        photo = NEW.photo,
        photo_url = NEW.photo_url,
        photo_hash = NEW.photo_hash,
        recorded_at = NEW.recorded_at,
        zone_id = NEW.zone_id,
        organization_id = NEW.organization_id,
        gps_latitude = NEW.gps_latitude,
        gps_longitude = NEW.gps_longitude,
        gps_accuracy = NEW.gps_accuracy,
        recorded_by = NEW.recorded_by,
        vehicle_make = NEW.vehicle_make,
        vehicle_model = NEW.vehicle_model,
        vehicle_color = NEW.vehicle_color,
        vehicle_year = NEW.vehicle_year,
        self_contained = NEW.self_contained,
        self_contained_expiry = NEW.self_contained_expiry,
        is_compliant = NEW.is_compliant,
        breach_type = NEW.breach_type,
        breach_reason = NEW.breach_reason,
        nights_stayed_this_month = NEW.nights_stayed_this_month,
        consecutive_nights = NEW.consecutive_nights,
        officer_notes = NEW.officer_notes,
        idempotency_key = NEW.idempotency_key,
        updated_at = NOW()
      WHERE observations.%1$I = OLD.%1$I
      RETURNING *
    $rule$, v_obs_pk_col);

    EXECUTE format($rule$
      CREATE RULE vehicle_observations_v2_delete AS
      ON DELETE TO public.vehicle_observations_v2
      DO INSTEAD
      DELETE FROM public.observations
      WHERE observations.%1$I = OLD.%1$I
      RETURNING *
    $rule$, v_obs_pk_col);

    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_observations_v2 TO authenticated';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_observations_v2 TO service_role';

    RAISE NOTICE 'Applied DML compatibility rules on public.vehicle_observations_v2';
  END IF;
END;
$$;

COMMIT;
