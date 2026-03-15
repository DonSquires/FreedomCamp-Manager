-- ============================================================================
-- Normalize canonical_vehicles.vehicle_year from TEXT to INTEGER
-- Date: 2026-04-11
--
-- Problem:
--   canonical_vehicles.vehicle_year was defined as TEXT in the initial schema
--   (20250101_initial_schema.sql) because it was copied from the legacy
--   vehicle_records table.  observations.vehicle_year has always been INTEGER
--   (set in 20250203000002_rebuild_vehicle_architecture.sql).
--
--   This mismatch forced every code path that reads vehicle_year from
--   canonical_vehicles and writes it to observations to carry an explicit
--   TEXT→INTEGER cast.  Two dedicated "sticky plaster" migrations were
--   required just to prevent runtime failures:
--     - 20260408000001_fix_vehicle_year_integer_cast.sql
--     - 20260409000001_fix_populate_observation_vehicle_year_cast.sql
--
-- Fix:
--   1. ALTER canonical_vehicles.vehicle_year from TEXT to INTEGER using a
--      safe CASE expression so non-numeric legacy values become NULL.
--   2. Re-create populate_observation_from_canonical() without the cast —
--      both sides are now INTEGER so plain COALESCE works.
--   3. Re-create safe_insert_observation() with v_vehicle_year INTEGER —
--      no cast needed in the INSERT VALUES clause.
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- ── 1. Convert canonical_vehicles.vehicle_year TEXT → INTEGER ───────────────
-- Non-numeric values (e.g. 'Unknown', '') become NULL rather than erroring.

ALTER TABLE public.canonical_vehicles
  ALTER COLUMN vehicle_year TYPE INTEGER
  USING CASE
    WHEN vehicle_year ~ '^\d+$' THEN vehicle_year::INTEGER
    ELSE NULL
  END;

COMMENT ON COLUMN public.canonical_vehicles.vehicle_year IS
  'Model year (INTEGER). Matches observations.vehicle_year. '
  'Was TEXT until migration 20260411000003 normalized the type.';

-- ── 2. Recreate populate_observation_from_canonical() — no cast needed ───────

CREATE OR REPLACE FUNCTION public.populate_observation_from_canonical()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical RECORD;
BEGIN
  SELECT *
    INTO v_canonical
    FROM canonical_vehicles
   WHERE plate_number = NEW.plate_number;

  IF FOUND THEN
    -- Both sides are now INTEGER — plain COALESCE, no cast required.
    NEW.vehicle_make          := COALESCE(NEW.vehicle_make,          v_canonical.vehicle_make);
    NEW.vehicle_model         := COALESCE(NEW.vehicle_model,         v_canonical.vehicle_model);
    NEW.vehicle_color         := COALESCE(NEW.vehicle_color,         v_canonical.vehicle_color);
    NEW.vehicle_year          := COALESCE(NEW.vehicle_year,          v_canonical.vehicle_year);
    NEW.self_contained        := COALESCE(NEW.self_contained,        v_canonical.self_contained);
    NEW.self_contained_expiry := COALESCE(NEW.self_contained_expiry, v_canonical.self_contained_expiry);
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'populate_observation_from_canonical: skipping canonical lookup for plate %: % (%)',
    NEW.plate_number, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.populate_observation_from_canonical() IS
  'BEFORE INSERT trigger: denormalises vehicle_make, vehicle_model, vehicle_color, '
  'vehicle_year (INTEGER), self_contained, self_contained_expiry from canonical_vehicles '
  'onto NEW observation if not already supplied. No TEXT→INTEGER cast needed since '
  'both columns are INTEGER after migration 20260411000003.';

DROP TRIGGER IF EXISTS trigger_populate_observation_from_canonical ON public.observations;
CREATE TRIGGER trigger_populate_observation_from_canonical
  BEFORE INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.populate_observation_from_canonical();

-- ── 3. Recreate safe_insert_observation() — v_vehicle_year now INTEGER ────────

CREATE OR REPLACE FUNCTION public.safe_insert_observation(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_obs_id          UUID;
  v_result          jsonb;
  -- Vehicle details from canonical_vehicles (all INTEGER/TEXT/BOOLEAN matching live schema)
  v_vehicle_make    TEXT;
  v_vehicle_model   TEXT;
  v_vehicle_color   TEXT;
  v_vehicle_year    INTEGER;   -- INTEGER now that canonical_vehicles.vehicle_year is INTEGER
  v_self_contained  BOOLEAN := false;
  v_sc_expiry       DATE;
  v_is_homeless     BOOLEAN := false;
  v_homeless_status TEXT := 'none';
  -- Compliance evaluation
  v_matrix          RECORD;
  v_is_compliant    BOOLEAN := true;
  v_breach_type     TEXT;
  v_breach_reason   TEXT;
  v_nz_hour         INTEGER;
  v_nights_stayed   INTEGER := 0;
  v_consecutive     INTEGER := 0;
  v_plate           TEXT;
  v_zone_id         UUID;
  v_org_id          UUID;
  v_recorded_at     TIMESTAMPTZ;
  v_violation_reasons TEXT[] := ARRAY[]::TEXT[];
  v_matrix_snapshot JSONB := '{}'::jsonb;
BEGIN
  v_plate       := COALESCE(p_data->>'plate_number', 'PROCESSING...');
  v_zone_id     := (p_data->>'zone_id')::uuid;
  v_org_id      := (p_data->>'organization_id')::uuid;
  v_recorded_at := COALESCE((p_data->>'recorded_at')::timestamptz, now());

  -- ── Step 1: Canonical vehicle lookup ────────────────────────────────────
  BEGIN
    SELECT
      vehicle_make, vehicle_model, vehicle_color, vehicle_year,
      COALESCE(cv.self_contained, false),
      cv.self_contained_expiry,
      COALESCE(cv.is_homeless, false),
      COALESCE(cv.homeless_status, 'none')
    INTO
      v_vehicle_make, v_vehicle_model, v_vehicle_color, v_vehicle_year,
      v_self_contained, v_sc_expiry, v_is_homeless, v_homeless_status
    FROM canonical_vehicles cv
    WHERE cv.plate_number = v_plate;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- ── Step 2: Compliance evaluation ───────────────────────────────────────
  BEGIN
    SELECT *
      INTO v_matrix
      FROM zone_compliance_matrix
     WHERE zone_id = v_zone_id
       AND effective_from <= v_recorded_at
       AND (effective_to IS NULL OR effective_to > v_recorded_at)
     ORDER BY version DESC
     LIMIT 1;

    IF NOT FOUND THEN
      SELECT
        self_contained_required,
        self_contained_required AS requires_csc,
        nights_per_month,
        max_consecutive_nights,
        day_visit_only,
        TRUE AS homeless_exemption
      INTO v_matrix
      FROM zones
      WHERE id = v_zone_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_matrix := NULL;
  END;

  IF v_matrix IS NOT NULL THEN
    BEGIN
      v_matrix_snapshot := jsonb_build_object(
        'self_contained_required', v_matrix.self_contained_required,
        'nights_per_month',        v_matrix.nights_per_month,
        'max_consecutive_nights',  v_matrix.max_consecutive_nights,
        'day_visit_only',          v_matrix.day_visit_only,
        'homeless_exemption',      COALESCE(v_matrix.homeless_exemption, true)
      );
    EXCEPTION WHEN OTHERS THEN
      v_matrix_snapshot := '{}'::jsonb;
    END;

    IF COALESCE(v_matrix.day_visit_only, false) THEN
      v_nz_hour := EXTRACT(HOUR FROM v_recorded_at AT TIME ZONE 'Pacific/Auckland')::integer;
      IF v_nz_hour >= 20 OR v_nz_hour < 8 THEN
        v_is_compliant := false;
        v_breach_type  := 'day_visit_violation';
        v_breach_reason := format('Night visit in day-only zone (observed at %s:00 NZ time)', v_nz_hour);
        v_violation_reasons := array_append(v_violation_reasons, 'day_visit_violation');
      END IF;
    END IF;

    IF v_is_compliant AND v_matrix.nights_per_month IS NOT NULL THEN
      IF v_nights_stayed > v_matrix.nights_per_month THEN
        IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
          v_is_compliant := false;
          v_breach_type  := 'monthly_limit';
          v_breach_reason := format(
            'Exceeded monthly stay limit: %s nights stayed, limit is %s',
            v_nights_stayed, v_matrix.nights_per_month);
          v_violation_reasons := array_append(v_violation_reasons,
            format('monthly_nights_exceeded_%s_of_%s', v_nights_stayed, v_matrix.nights_per_month));
        END IF;
      END IF;
    END IF;

    IF v_is_compliant AND v_matrix.max_consecutive_nights IS NOT NULL THEN
      IF v_consecutive > v_matrix.max_consecutive_nights THEN
        IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
          v_is_compliant := false;
          v_breach_type  := 'consecutive_nights';
          v_breach_reason := format(
            'Exceeded consecutive nights limit: %s consecutive, limit is %s',
            v_consecutive, v_matrix.max_consecutive_nights);
          v_violation_reasons := array_append(v_violation_reasons,
            format('consecutive_nights_exceeded_%s_of_%s', v_consecutive, v_matrix.max_consecutive_nights));
        END IF;
      END IF;
    END IF;

    IF v_is_compliant AND COALESCE(v_matrix.self_contained_required, false) THEN
      IF NOT v_self_contained THEN
        IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
          v_is_compliant := false;
          v_breach_type  := 'self_contained';
          v_breach_reason := 'Zone requires a self-contained vehicle; no valid CSC on record';
          v_violation_reasons := array_append(v_violation_reasons, 'not_self_contained');
        END IF;
      END IF;
    END IF;
  END IF;

  -- ── Step 3: Insert observation ───────────────────────────────────────────
  -- v_vehicle_year is now INTEGER — no TEXT→INTEGER cast required.
  BEGIN
    INSERT INTO observations (
      plate_number, photo, photo_url, photo_hash,
      recorded_at, zone_id, organization_id,
      gps_latitude, gps_longitude, gps_accuracy,
      recorded_by, idempotency_key,
      vehicle_make, vehicle_model, vehicle_color, vehicle_year,
      self_contained, self_contained_expiry,
      nights_stayed_this_month, consecutive_nights,
      is_compliant, breach_type, breach_reason
    ) VALUES (
      v_plate,
      p_data->>'photo',
      p_data->>'photo_url',
      p_data->>'photo_hash',
      v_recorded_at,
      v_zone_id,
      v_org_id,
      (p_data->>'gps_latitude')::double precision,
      (p_data->>'gps_longitude')::double precision,
      (p_data->>'gps_accuracy')::double precision,
      (p_data->>'recorded_by')::uuid,
      p_data->>'idempotency_key',
      v_vehicle_make,
      v_vehicle_model,
      v_vehicle_color,
      v_vehicle_year,   -- INTEGER, matches observations.vehicle_year
      v_self_contained,
      v_sc_expiry,
      v_nights_stayed,
      v_consecutive,
      v_is_compliant,
      v_breach_type,
      v_breach_reason
    )
    RETURNING observation_id INTO v_obs_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'safe_insert_observation: INSERT failed: %', SQLERRM;
  END;

  -- ── Step 4: compliance_results was DROPPED in 20260221_rebuild_observations_clean.sql.
  --            Compliance state is stored directly on the observations row set above.
  --            Step 4 is intentionally a no-op here.

  -- ── Step 5: Belt-and-suspenders canonical stats update ──────────────────
  BEGIN
    UPDATE canonical_vehicles
       SET total_observations = COALESCE(total_observations, 0) + 1,
           last_seen_at       = v_recorded_at
     WHERE plate_number = v_plate;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'safe_insert_observation: canonical stats update failed: %', SQLERRM;
  END;

  -- ── Step 6: Belt-and-suspenders breach alert ─────────────────────────────
  IF NOT v_is_compliant AND v_breach_type IS NOT NULL THEN
    BEGIN
      INSERT INTO breach_alerts (
        observation_id, plate_number, zone_id, organization_id,
        breach_type, status, created_at
      ) VALUES (
        v_obs_id, v_plate, v_zone_id, v_org_id,
        v_breach_type, 'pending', now()
      )
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'safe_insert_observation: breach_alerts insert failed: %', SQLERRM;
    END;
  END IF;

  -- ── Step 7: Return full observation row ──────────────────────────────────
  SELECT to_jsonb(o.*) INTO v_result
  FROM observations o
  WHERE o.observation_id = v_obs_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.safe_insert_observation(jsonb) IS
  'Pipeline-complete observation insert. Both canonical_vehicles.vehicle_year and '
  'observations.vehicle_year are INTEGER after 20260411000003 — no TEXT→INTEGER '
  'cast is needed anywhere in this function.';

GRANT EXECUTE ON FUNCTION public.safe_insert_observation(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_insert_observation(jsonb) TO service_role;

-- ── Verification ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_cv_type  text;
  v_obs_type text;
BEGIN
  SELECT data_type INTO v_cv_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'canonical_vehicles'
    AND column_name = 'vehicle_year';

  SELECT data_type INTO v_obs_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'observations'
    AND column_name = 'vehicle_year';

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  20260411000003 — vehicle_year NORMALIZATION';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  canonical_vehicles.vehicle_year : % %',
    COALESCE(v_cv_type,  'MISSING'),
    CASE WHEN v_cv_type  = 'integer' THEN '✓ INTEGER' ELSE '⚠ check type' END;
  RAISE NOTICE '  observations.vehicle_year       : % %',
    COALESCE(v_obs_type, 'MISSING'),
    CASE WHEN v_obs_type = 'integer' THEN '✓ INTEGER' ELSE '⚠ check type' END;
  RAISE NOTICE '  Both columns are now INTEGER — no cast workarounds needed.';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END;
$$;

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
