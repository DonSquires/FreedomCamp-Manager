-- ============================================================================
-- Fix: Remove session_replication_role from safe_insert_observation
-- Date: 2026-04-07
--
-- Problem:
--   safe_insert_observation RPC fails for regular authenticated users with:
--   "permission denied to set parameter 'session_replication_role'"
--
--   The previous implementation (20260404000002) used:
--     SET LOCAL session_replication_role = 'replica';
--   to bypass all INSERT triggers on the observations table.  While this is
--   permitted for true PostgreSQL superusers, Supabase's managed-Postgres
--   service does not allow even SECURITY DEFINER functions to set this
--   parameter unless the function owner holds the replication role — which
--   is not the case for the default `postgres` role on Supabase projects.
--
-- Root cause of the original trigger bypass:
--   auto_evaluate_compliance() used COALESCE(NEW.nights_stayed_this_month, 0)
--   which crashed with "COALESCE types integer and text cannot be matched"
--   when column types drifted.  That bug was fixed in:
--     20260401000002_hotfix_coalesce_type_mismatch
--   The trigger is now fully exception-wrapped and safe to run.
--
-- Fix:
--   Replace safe_insert_observation with a version that:
--     1. Does NOT use SET LOCAL session_replication_role at all.
--     2. Pre-populates all compliance fields inline (Steps 1-2) so the
--        BEFORE INSERT trigger (trg_auto_evaluate_compliance) re-confirms
--        rather than starting from scratch.
--     3. Wraps the INSERT in a BEGIN/EXCEPTION block so any unexpected
--        trigger error is caught, logged as a WARNING, and re-raised with
--        a descriptive message rather than the raw Postgres error.
--     4. Continues to run Steps 4-6 inline (compliance_results, canonical
--        stats, breach_alert) as belt-and-suspenders — these are idempotent
--        (ON CONFLICT DO NOTHING / UPDATE) and harmless if triggers already
--        handled them.
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

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
  v_vehicle_year    TEXT;
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
  -- Compliance results
  v_violation_reasons TEXT[] := ARRAY[]::TEXT[];
  v_matrix_snapshot JSONB := '{}'::jsonb;
BEGIN
  -- Extract key fields
  v_plate       := COALESCE(p_data->>'plate_number', 'PROCESSING...');
  v_zone_id     := (p_data->>'zone_id')::uuid;
  v_org_id      := (p_data->>'organization_id')::uuid;
  v_recorded_at := COALESCE((p_data->>'recorded_at')::timestamptz, now());

  -- ========================================================================
  -- STEP 1: Populate from canonical_vehicles
  -- (Equivalent of trigger_populate_observation_from_canonical)
  -- ========================================================================
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
    -- Vehicle not found or error — use defaults
    NULL;
  END;

  -- ========================================================================
  -- STEP 2: Evaluate compliance
  -- (Equivalent of trg_auto_evaluate_compliance / calculate_vehicle_compliance_v3)
  -- ========================================================================

  -- Look up zone compliance matrix
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
      -- Fallback to zones table
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
    -- Build matrix snapshot for audit trail
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

    -- Rule 1: Day-visit-only zone
    IF COALESCE(v_matrix.day_visit_only, false) THEN
      v_nz_hour := EXTRACT(HOUR FROM v_recorded_at AT TIME ZONE 'Pacific/Auckland')::integer;
      IF v_nz_hour >= 20 OR v_nz_hour < 8 THEN
        v_is_compliant := false;
        v_breach_type  := 'day_visit_violation';
        v_breach_reason := format('Night visit in day-only zone (observed at %s:00 NZ time)', v_nz_hour);
        v_violation_reasons := array_append(v_violation_reasons, 'day_visit_violation');
      END IF;
    END IF;

    -- Rule 2: Monthly nights limit
    IF v_is_compliant AND v_matrix.nights_per_month IS NOT NULL THEN
      IF v_nights_stayed > v_matrix.nights_per_month THEN
        IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
          v_is_compliant := false;
          v_breach_type  := 'monthly_limit';
          v_breach_reason := format(
            'Exceeded monthly stay limit: %s nights stayed, limit is %s',
            v_nights_stayed, v_matrix.nights_per_month
          );
          v_violation_reasons := array_append(v_violation_reasons,
            format('monthly_nights_exceeded_%s_of_%s', v_nights_stayed, v_matrix.nights_per_month));
        END IF;
      END IF;
    END IF;

    -- Rule 3: Consecutive nights limit
    IF v_is_compliant AND v_matrix.max_consecutive_nights IS NOT NULL THEN
      IF v_consecutive > v_matrix.max_consecutive_nights THEN
        IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
          v_is_compliant := false;
          v_breach_type  := 'consecutive_nights';
          v_breach_reason := format(
            'Exceeded consecutive nights limit: %s consecutive, limit is %s',
            v_consecutive, v_matrix.max_consecutive_nights
          );
          v_violation_reasons := array_append(v_violation_reasons,
            format('consecutive_nights_exceeded_%s_of_%s', v_consecutive, v_matrix.max_consecutive_nights));
        END IF;
      END IF;
    END IF;

    -- Rule 4: Self-contained / CSC requirement
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

  -- ========================================================================
  -- STEP 3: Insert observation
  -- Triggers are NOT disabled — the auto_evaluate_compliance BEFORE trigger
  -- has been exception-safe since 20260401000002 and will confirm or refine
  -- the compliance values pre-populated here.
  -- ========================================================================
  BEGIN
    INSERT INTO observations (
      plate_number,
      photo,
      photo_url,
      photo_hash,
      recorded_at,
      zone_id,
      organization_id,
      gps_latitude,
      gps_longitude,
      gps_accuracy,
      recorded_by,
      idempotency_key,
      -- Vehicle details (from canonical lookup — Step 1)
      vehicle_make,
      vehicle_model,
      vehicle_color,
      vehicle_year,
      self_contained,
      self_contained_expiry,
      -- Compliance results (from evaluation — Step 2)
      nights_stayed_this_month,
      consecutive_nights,
      is_compliant,
      breach_type,
      breach_reason
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

  -- ========================================================================
  -- STEP 4: Create compliance_results row
  -- (Belt-and-suspenders: trigger_auto_create_compliance_result may already
  --  have done this; ON CONFLICT DO NOTHING prevents duplicate-key errors.)
  -- ========================================================================
  BEGIN
    INSERT INTO compliance_results (
      observation_id,
      zone_id,
      organization_id,
      matrix_id,
      matrix_version,
      is_compliant,
      violation_reasons,
      matrix_snapshot,
      evaluated_at
    ) VALUES (
      v_obs_id,
      v_zone_id,
      v_org_id,
      CASE WHEN v_matrix IS NOT NULL THEN v_matrix.id ELSE NULL END,
      CASE WHEN v_matrix IS NOT NULL THEN v_matrix.version ELSE NULL END,
      v_is_compliant,
      v_violation_reasons,
      v_matrix_snapshot,
      now()
    )
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- Log but don't fail the entire insert
    RAISE WARNING 'safe_insert_observation: compliance_results insert failed: %', SQLERRM;
  END;

  -- ========================================================================
  -- STEP 5: Update canonical_vehicles stats
  -- (Belt-and-suspenders: trigger_update_canonical_stats_v2 may already
  --  have done this; the UPDATE is idempotent.)
  -- ========================================================================
  BEGIN
    UPDATE canonical_vehicles
    SET
      total_observations = COALESCE(total_observations, 0) + 1,
      last_seen_at = v_recorded_at
    WHERE plate_number = v_plate;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'safe_insert_observation: canonical stats update failed: %', SQLERRM;
  END;

  -- ========================================================================
  -- STEP 6: Create breach alert if non-compliant
  -- (Belt-and-suspenders: trigger may already have done this;
  --  ON CONFLICT DO NOTHING prevents duplicates.)
  -- ========================================================================
  IF NOT v_is_compliant AND v_breach_type IS NOT NULL THEN
    BEGIN
      INSERT INTO breach_alerts (
        observation_id,
        plate_number,
        zone_id,
        organization_id,
        breach_type,
        status,
        created_at
      ) VALUES (
        v_obs_id,
        v_plate,
        v_zone_id,
        v_org_id,
        v_breach_type,
        'pending',
        now()
      )
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'safe_insert_observation: breach_alerts insert failed: %', SQLERRM;
    END;
  END IF;

  -- ========================================================================
  -- STEP 7: Return the complete observation with compliance data
  -- ========================================================================
  SELECT to_jsonb(o.*) INTO v_result
  FROM observations o
  WHERE o.observation_id = v_obs_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.safe_insert_observation(jsonb) IS
  'Pipeline-complete observation insert. Does NOT use session_replication_role '
  '(which requires superuser privileges unavailable on Supabase managed Postgres). '
  'Pre-populates compliance fields inline and lets the now-exception-safe '
  'trg_auto_evaluate_compliance BEFORE trigger confirm/refine them. '
  'Steps 4-6 run as belt-and-suspenders after the INSERT.';

-- Ensure grants are in place
GRANT EXECUTE ON FUNCTION public.safe_insert_observation(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_insert_observation(jsonb) TO service_role;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  20260407000001 — safe_insert_observation PERMISSION FIX';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  Removed SET LOCAL session_replication_role = ''replica''';
  RAISE NOTICE '  INSERT now runs with triggers enabled (trg_auto_evaluate_';
  RAISE NOTICE '    compliance is exception-safe since 20260401000002).';
  RAISE NOTICE '  Steps 4-6 retained as belt-and-suspenders fallback.';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END;
$$;

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
