-- ============================================================================
-- Fix: Remove all references to vehicle_observations_v2
-- Date: 2026-04-16
--
-- Problem:
--   The live database still has a version of safe_insert_observation() (and
--   possibly other functions) that INSERT INTO vehicle_observations_v2 instead
--   of INSERT INTO observations.  This causes:
--
--     "Save failed: safe_insert_observation: INSERT failed:
--      relation "vehicle_observations_v2" does not exist"
--
--   Root cause timeline:
--     1. The canonical observations table was created/renamed as part of
--        migration 20250203000002_rebuild_vehicle_architecture.sql.
--     2. Earlier migrations (20260218000003, 20260322000001) were supposed to
--        handle both the old table name (vehicle_observations_v2) and the new
--        name (observations) but contained a copy-paste bug: both the IF and
--        ELSIF clauses checked for "observations", so the vehicle_observations_v2
--        fallback was never exercised and any live-db state using that name
--        was silently skipped.
--     3. As a result, if the live DB still has the table named
--        vehicle_observations_v2, all safe_insert_observation calls fail.
--
-- Fix (this migration):
--   1. If vehicle_observations_v2 still exists as a BASE TABLE, rename it to
--      observations so that all downstream code works without modification.
--   2. Recreate safe_insert_observation() targeting observations — identical
--      to the authoritative version in 20260411000003 but guaranteed to
--      overwrite any stale live-DB version referencing the old table name.
--   3. Ensure the trigger_populate_observation_from_canonical trigger exists
--      on observations (re-creates it if it was dropped or missing).
--   4. Force PostgREST schema-cache reload.
--
-- Idempotent: safe to re-run on any DB state.
-- ============================================================================

BEGIN;

-- ── Step 1: Rename vehicle_observations_v2 → observations (if needed) ────────

DO $$
DECLARE
  v_has_v2  BOOLEAN;
  v_has_obs BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'vehicle_observations_v2'
      AND table_type   = 'BASE TABLE'
  ) INTO v_has_v2;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'observations'
      AND table_type   = 'BASE TABLE'
  ) INTO v_has_obs;

  IF v_has_v2 AND NOT v_has_obs THEN
    ALTER TABLE public.vehicle_observations_v2 RENAME TO observations;
    RAISE NOTICE 'Renamed public.vehicle_observations_v2 → public.observations ✓';

  ELSIF v_has_v2 AND v_has_obs THEN
    RAISE NOTICE 'Both vehicle_observations_v2 and observations exist — manual review required. Dropping vehicle_observations_v2.';
    DROP TABLE public.vehicle_observations_v2;

  ELSIF NOT v_has_v2 AND v_has_obs THEN
    RAISE NOTICE 'public.observations already exists under the correct name — no rename needed ✓';

  ELSE
    RAISE EXCEPTION 'Neither vehicle_observations_v2 nor observations table exists — cannot continue.';
  END IF;
END;
$$;

-- ── Step 2: Ensure observation_id is the PRIMARY KEY (not id) ────────────────
-- Migration 20260411000002 already handled this but we verify here defensively.

DO $$
DECLARE
  v_has_obs_id_col  BOOLEAN;
  v_obs_id_is_pk    BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'observations'
      AND column_name = 'observation_id'
  ) INTO v_has_obs_id_col;

  IF NOT v_has_obs_id_col THEN
    -- Add observation_id as the primary key if not present
    ALTER TABLE public.observations ADD COLUMN IF NOT EXISTS observation_id UUID DEFAULT gen_random_uuid();
    RAISE NOTICE 'Added observation_id column to observations ✓';
  ELSE
    RAISE NOTICE 'observations.observation_id already exists ✓';
  END IF;
END;
$$;

-- ── Step 3: Recreate populate_observation_from_canonical() trigger function ──
-- Both canonical_vehicles.vehicle_year and observations.vehicle_year are now
-- INTEGER (normalised in 20260411000003) — no cast required.

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
  'BEFORE INSERT trigger: denormalises vehicle_make/model/color/year/self_contained '
  'from canonical_vehicles onto the new observation row if not already supplied.';

DROP TRIGGER IF EXISTS trigger_populate_observation_from_canonical ON public.observations;
CREATE TRIGGER trigger_populate_observation_from_canonical
  BEFORE INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.populate_observation_from_canonical();

-- ── Step 4: Recreate safe_insert_observation() targeting observations ─────────
-- This is the authoritative version from 20260411000003, guaranteed to
-- overwrite any stale live-DB version that was referencing vehicle_observations_v2.

CREATE OR REPLACE FUNCTION public.safe_insert_observation(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_obs_id          UUID;
  v_result          jsonb;
  -- Vehicle details from canonical_vehicles
  v_vehicle_make    TEXT;
  v_vehicle_model   TEXT;
  v_vehicle_color   TEXT;
  v_vehicle_year    INTEGER;
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
        v_is_compliant  := false;
        v_breach_type   := 'day_visit_violation';
        v_breach_reason := format('Night visit in day-only zone (observed at %s:00 NZ time)', v_nz_hour);
        v_violation_reasons := array_append(v_violation_reasons, 'day_visit_violation');
      END IF;
    END IF;

    IF v_is_compliant AND v_matrix.nights_per_month IS NOT NULL THEN
      IF v_nights_stayed > v_matrix.nights_per_month THEN
        IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
          v_is_compliant  := false;
          v_breach_type   := 'monthly_limit';
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
          v_is_compliant  := false;
          v_breach_type   := 'consecutive_nights';
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
          v_is_compliant  := false;
          v_breach_type   := 'self_contained';
          v_breach_reason := 'Zone requires a self-contained vehicle; no valid CSC on record';
          v_violation_reasons := array_append(v_violation_reasons, 'not_self_contained');
        END IF;
      END IF;
    END IF;
  END IF;

  -- ── Step 3: Insert observation into observations ──────────────────────────
  -- NOTE: Always INSERT INTO observations — never vehicle_observations_v2.
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
      v_vehicle_year,
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
  --            Compliance state is stored directly on the observations row.
  --            This step is intentionally a no-op.

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
  'Pipeline-complete observation insert. Always targets the observations table. '
  'Normalised by migration 20260416000001 to eliminate any vehicle_observations_v2 reference.';

GRANT EXECUTE ON FUNCTION public.safe_insert_observation(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_insert_observation(jsonb) TO service_role;

-- ── Step 5: Fix RLS policies to use observations (not vehicle_observations_v2) ─
-- These are no-ops if the table is already named observations.
-- Drop any stale policies on vehicle_observations_v2 (silently skip if not found).

DO $$
BEGIN
  -- Drop stale v2 policies if they happen to still be on the old table name
  DROP POLICY IF EXISTS users_view_observations_v2    ON public.vehicle_observations_v2;
  DROP POLICY IF EXISTS users_create_observations_v2  ON public.vehicle_observations_v2;
  DROP POLICY IF EXISTS admins_manage_observations_v2 ON public.vehicle_observations_v2;
EXCEPTION WHEN undefined_table THEN
  NULL; -- table doesn't exist, nothing to drop
END;
$$;

-- ── Step 6: Force PostgREST schema-cache reload ───────────────────────────────

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

-- ── Verification ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_obs_table_exists   BOOLEAN;
  v_v2_table_exists    BOOLEAN;
  v_func_exists        BOOLEAN;
  v_func_body          TEXT;
  v_func_targets_obs   BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'observations' AND table_type = 'BASE TABLE'
  ) INTO v_obs_table_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vehicle_observations_v2' AND table_type = 'BASE TABLE'
  ) INTO v_v2_table_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'safe_insert_observation' AND pronamespace = 'public'::regnamespace
  ) INTO v_func_exists;

  IF v_func_exists THEN
    SELECT prosrc INTO v_func_body
    FROM pg_proc
    WHERE proname = 'safe_insert_observation' AND pronamespace = 'public'::regnamespace;

    v_func_targets_obs := (
      v_func_body ILIKE '%INSERT INTO observations%'
      AND v_func_body NOT ILIKE '%INSERT INTO vehicle_observations_v2%'
    );
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  20260416000001 — vehicle_observations_v2 NORMALISATION';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  observations table exists:              %', CASE WHEN v_obs_table_exists THEN '✓' ELSE '✗ MISSING' END;
  RAISE NOTICE '  vehicle_observations_v2 still exists:  %', CASE WHEN v_v2_table_exists  THEN '✗ PROBLEM' ELSE '✓ gone' END;
  RAISE NOTICE '  safe_insert_observation() exists:       %', CASE WHEN v_func_exists     THEN '✓' ELSE '✗ MISSING' END;
  RAISE NOTICE '  safe_insert_observation() targets obs:  %', CASE WHEN v_func_targets_obs THEN '✓ observations' ELSE '✗ WRONG TABLE' END;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';

  IF v_v2_table_exists THEN
    RAISE EXCEPTION 'vehicle_observations_v2 still exists after normalisation — manual intervention required.';
  END IF;
  IF NOT v_obs_table_exists THEN
    RAISE EXCEPTION 'observations table is missing — cannot continue.';
  END IF;
  IF NOT v_func_targets_obs THEN
    RAISE EXCEPTION 'safe_insert_observation() does not target observations — check function body.';
  END IF;
END;
$$;

COMMIT;
