-- ============================================================================
-- Fix: vehicle_year type mismatch in populate_observation_from_canonical
-- Date: 2026-04-09
--
-- Problem:
--   safe_insert_observation (and any direct observation INSERT) fails with:
--     "COALESCE types integer and text cannot be matched"
--
--   Root cause:
--     observations.vehicle_year  is INTEGER in the live database.
--     canonical_vehicles.vehicle_year  is TEXT in the live database.
--
--   The BEFORE INSERT trigger function populate_observation_from_canonical()
--   executes:
--
--     NEW.vehicle_year := COALESCE(NEW.vehicle_year, v_canonical.vehicle_year);
--
--   When NEW.vehicle_year is NULL (which it is on every insert where the
--   caller does not supply a year), PostgreSQL evaluates both COALESCE
--   arguments to determine a common type.  INTEGER and TEXT have no
--   implicit common type, so every INSERT that goes through this trigger
--   fails with the error above.
--
--   Note: 20260408000001 fixed the same mismatch inside safe_insert_observation
--   itself (the inline canonical lookup in Step 1), but the BEFORE INSERT
--   trigger populate_observation_from_canonical() was not updated at that time
--   and continues to cause the failure.
--
-- Fix:
--   Replace populate_observation_from_canonical() with a version that casts
--   canonical_vehicles.vehicle_year (TEXT) to INTEGER using a safe regex
--   guard, so non-numeric text (or NULL) becomes NULL rather than an error.
--
--   The function is also given SECURITY DEFINER, SET search_path = public,
--   and a top-level EXCEPTION block so that any unforeseen type-drift in
--   other columns degrades gracefully instead of blocking every INSERT.
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.populate_observation_from_canonical()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical RECORD;
BEGIN
  -- Fetch canonical vehicle details
  SELECT *
    INTO v_canonical
    FROM canonical_vehicles
   WHERE plate_number = NEW.plate_number;

  IF FOUND THEN
    -- Copy permanent vehicle data if not already provided in the observation.
    --
    -- vehicle_year requires an explicit cast:
    --   observations.vehicle_year  is INTEGER
    --   canonical_vehicles.vehicle_year  is TEXT
    -- Using a regex guard so non-numeric text becomes NULL rather than an error.
    NEW.vehicle_make  := COALESCE(NEW.vehicle_make,  v_canonical.vehicle_make);
    NEW.vehicle_model := COALESCE(NEW.vehicle_model, v_canonical.vehicle_model);
    NEW.vehicle_color := COALESCE(NEW.vehicle_color, v_canonical.vehicle_color);
    NEW.vehicle_year  := COALESCE(
      NEW.vehicle_year,
      CASE
        WHEN v_canonical.vehicle_year IS NOT NULL
         AND v_canonical.vehicle_year ~ '^\d+$'
        THEN v_canonical.vehicle_year::integer
        ELSE NULL
      END
    );
    NEW.self_contained        := COALESCE(NEW.self_contained,        v_canonical.self_contained);
    NEW.self_contained_expiry := COALESCE(NEW.self_contained_expiry, v_canonical.self_contained_expiry);
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Any unexpected column-type drift: log a warning and let the INSERT
  -- proceed with whatever values were already on NEW.
  RAISE WARNING 'populate_observation_from_canonical: skipping canonical lookup for plate %: % (%)',
    NEW.plate_number, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.populate_observation_from_canonical() IS
  'BEFORE INSERT trigger on observations: looks up canonical_vehicles by '
  'plate_number and denormalises vehicle_make, vehicle_model, vehicle_color, '
  'vehicle_year (safely cast TEXT→INTEGER), self_contained, '
  'self_contained_expiry onto NEW if not already supplied.';

-- Re-attach the trigger (idempotent: drop + recreate)
DROP TRIGGER IF EXISTS trigger_populate_observation_from_canonical ON public.observations;

CREATE TRIGGER trigger_populate_observation_from_canonical
  BEFORE INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.populate_observation_from_canonical();

COMMENT ON TRIGGER trigger_populate_observation_from_canonical ON public.observations IS
  'Runs populate_observation_from_canonical() before each observation INSERT '
  'to denormalise canonical vehicle data onto the new row.';

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  v_year_obs_type  text;
  v_year_cv_type   text;
  v_trigger_exists boolean;
BEGIN
  SELECT data_type INTO v_year_obs_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'observations'
    AND column_name = 'vehicle_year';

  SELECT data_type INTO v_year_cv_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'canonical_vehicles'
    AND column_name = 'vehicle_year';

  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c  ON t.tgrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'observations'
      AND t.tgname  = 'trigger_populate_observation_from_canonical'
  ) INTO v_trigger_exists;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  20260409000001 — populate_observation_from_canonical FIX';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  observations.vehicle_year type       : % %',
    COALESCE(v_year_obs_type, 'MISSING'),
    CASE WHEN v_year_obs_type = 'integer' THEN '✓ (INTEGER)' ELSE '⚠ check type' END;
  RAISE NOTICE '  canonical_vehicles.vehicle_year type : % %',
    COALESCE(v_year_cv_type, 'MISSING'),
    CASE WHEN v_year_cv_type = 'text' THEN '(TEXT — cast applied)' ELSE '' END;
  RAISE NOTICE '  trigger_populate_observation_from_canonical: %',
    CASE WHEN v_trigger_exists THEN 'OK ✓' ELSE 'MISSING ✗' END;
  RAISE NOTICE '  Fix: CASE WHEN vehicle_year ~ ''^\\d+$'' THEN vehicle_year::integer ELSE NULL END';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END;
$$;

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
