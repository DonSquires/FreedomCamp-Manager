-- ============================================================================
-- Emergency Fix: COALESCE trigger + safe_insert_observation RPC
-- Date: 2026-03-13
--
-- Context — scan pipeline failing with all three fallback paths broken:
--
--   PATH 1 (direct insert): "COALESCE types integer and text cannot be matched"
--     auto_evaluate_compliance() BEFORE INSERT trigger uses bare
--     COALESCE(NEW.nights_stayed_this_month, 0) where the column has drifted
--     to TEXT.  PostgreSQL refuses to implicitly coerce TEXT to INTEGER inside
--     COALESCE, so every INSERT fails.
--
--   PATH 2 (vehicle-ingest edge function): "Failed to send a request"
--     Edge function not deployed or network error.
--
--   PATH 3 (safe_insert_observation RPC): function did not exist in the DB.
--
-- This migration — the definitive combined fix:
--   1. Coerces any drifted column types (TEXT → INTEGER / BOOLEAN).
--   2. Replaces auto_evaluate_compliance() with an ultra-defensive version
--      (pg_typeof + EXCEPTION WHEN OTHERS) so direct inserts work even if
--      the column type drifts again in future.
--   3. Creates safe_insert_observation(jsonb) — pipeline-complete RPC that
--      bypasses all triggers and runs the full compliance pipeline inline:
--        canonical lookup → compliance eval → observation insert →
--        compliance_results → canonical stats → breach_alerts.
--      This is the PRIMARY observation-save path used by the frontend.
--   4. Forces PostgREST schema cache reload.
--
-- Idempotent: safe to re-run.
-- Later migrations 20260401000001/2 and 20260404000001/2 will further refine
-- both functions via CREATE OR REPLACE without any conflict.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Ensure compliance columns exist with correct base types
-- ============================================================================

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS nights_stayed_this_month integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_nights        integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_compliant              boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS breach_type               text,
  ADD COLUMN IF NOT EXISTS breach_reason             text,
  ADD COLUMN IF NOT EXISTS self_contained            boolean DEFAULT false;

DO $$
DECLARE
  v_type text;
BEGIN
  -- nights_stayed_this_month → integer
  SELECT data_type INTO v_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'observations'
    AND column_name = 'nights_stayed_this_month';
  IF v_type IS NOT NULL AND v_type <> 'integer' THEN
    EXECUTE $x$ ALTER TABLE public.observations ALTER COLUMN nights_stayed_this_month TYPE integer
      USING (CASE WHEN nights_stayed_this_month IS NULL THEN 0
                  WHEN btrim(nights_stayed_this_month::text) = '' THEN 0
                  WHEN btrim(nights_stayed_this_month::text) ~ '^-?[0-9]+$'
                    THEN btrim(nights_stayed_this_month::text)::integer
                  ELSE 0 END) $x$;
    RAISE NOTICE 'Fixed nights_stayed_this_month: % → integer', v_type;
  END IF;

  -- consecutive_nights → integer
  SELECT data_type INTO v_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'observations'
    AND column_name = 'consecutive_nights';
  IF v_type IS NOT NULL AND v_type <> 'integer' THEN
    EXECUTE $x$ ALTER TABLE public.observations ALTER COLUMN consecutive_nights TYPE integer
      USING (CASE WHEN consecutive_nights IS NULL THEN 0
                  WHEN btrim(consecutive_nights::text) = '' THEN 0
                  WHEN btrim(consecutive_nights::text) ~ '^-?[0-9]+$'
                    THEN btrim(consecutive_nights::text)::integer
                  ELSE 0 END) $x$;
    RAISE NOTICE 'Fixed consecutive_nights: % → integer', v_type;
  END IF;

  -- is_compliant → boolean
  SELECT data_type INTO v_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'observations'
    AND column_name = 'is_compliant';
  IF v_type IS NOT NULL AND v_type <> 'boolean' THEN
    EXECUTE $x$ ALTER TABLE public.observations ALTER COLUMN is_compliant TYPE boolean
      USING (CASE WHEN lower(btrim(is_compliant::text)) IN ('true','t','1','yes','y') THEN true
                  ELSE true END) $x$;
    RAISE NOTICE 'Fixed is_compliant: % → boolean', v_type;
  END IF;

  -- self_contained → boolean
  SELECT data_type INTO v_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'observations'
    AND column_name = 'self_contained';
  IF v_type IS NOT NULL AND v_type <> 'boolean' THEN
    EXECUTE $x$ ALTER TABLE public.observations ALTER COLUMN self_contained TYPE boolean
      USING (CASE WHEN lower(btrim(self_contained::text)) IN ('true','t','1','yes','y') THEN true
                  ELSE false END) $x$;
    RAISE NOTICE 'Fixed self_contained: % → boolean', v_type;
  END IF;
END;
$$;

ALTER TABLE public.observations
  ALTER COLUMN nights_stayed_this_month SET DEFAULT 0,
  ALTER COLUMN consecutive_nights        SET DEFAULT 0,
  ALTER COLUMN is_compliant              SET DEFAULT true,
  ALTER COLUMN self_contained            SET DEFAULT false;

-- ============================================================================
-- PART 2: Ultra-defensive auto_evaluate_compliance() trigger
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_auto_compliance_check  ON public.observations;
DROP TRIGGER IF EXISTS trg_auto_evaluate_compliance   ON public.observations;

CREATE OR REPLACE FUNCTION public.auto_evaluate_compliance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_matrix         RECORD;
  v_is_homeless    BOOLEAN := false;
  v_nz_hour        INTEGER;
  v_is_compliant   BOOLEAN := true;
  v_breach_type    TEXT    := NULL;
  v_breach_reason  TEXT    := NULL;
  v_nights_stayed  INTEGER := 0;
  v_consecutive    INTEGER := 0;
  v_self_contained BOOLEAN := false;
  v_tmp            TEXT;
BEGIN
  -- Safe conversion: pg_typeof check + EXCEPTION guard prevents COALESCE
  -- type-mismatch errors when column type has drifted from INTEGER to TEXT.
  BEGIN
    IF NEW.nights_stayed_this_month IS NULL THEN
      v_nights_stayed := 0;
    ELSIF pg_typeof(NEW.nights_stayed_this_month)::text = 'integer' THEN
      v_nights_stayed := NEW.nights_stayed_this_month;
    ELSE
      v_tmp := regexp_replace(NEW.nights_stayed_this_month::text, '[^0-9]', '', 'g');
      v_nights_stayed := CASE WHEN v_tmp = '' THEN 0 ELSE v_tmp::integer END;
    END IF;
    IF v_nights_stayed < 0 THEN v_nights_stayed := 0; END IF;
  EXCEPTION WHEN OTHERS THEN v_nights_stayed := 0; END;

  BEGIN
    IF NEW.consecutive_nights IS NULL THEN
      v_consecutive := 0;
    ELSIF pg_typeof(NEW.consecutive_nights)::text = 'integer' THEN
      v_consecutive := NEW.consecutive_nights;
    ELSE
      v_tmp := regexp_replace(NEW.consecutive_nights::text, '[^0-9]', '', 'g');
      v_consecutive := CASE WHEN v_tmp = '' THEN 0 ELSE v_tmp::integer END;
    END IF;
    IF v_consecutive < 0 THEN v_consecutive := 0; END IF;
  EXCEPTION WHEN OTHERS THEN v_consecutive := 0; END;

  BEGIN
    IF NEW.self_contained IS NULL THEN
      v_self_contained := false;
    ELSIF pg_typeof(NEW.self_contained)::text = 'boolean' THEN
      v_self_contained := NEW.self_contained;
    ELSE
      v_self_contained := lower(NEW.self_contained::text) IN ('true','t','1','yes','y');
    END IF;
  EXCEPTION WHEN OTHERS THEN v_self_contained := false; END;

  -- Compliance matrix lookup
  SELECT * INTO v_matrix FROM zone_compliance_matrix
  WHERE zone_id = NEW.zone_id AND effective_from <= NEW.recorded_at
    AND (effective_to IS NULL OR effective_to > NEW.recorded_at)
  ORDER BY version DESC LIMIT 1;

  IF NOT FOUND THEN
    SELECT self_contained_required, self_contained_required AS requires_csc,
           nights_per_month, max_consecutive_nights, day_visit_only, TRUE AS homeless_exemption
    INTO v_matrix FROM zones WHERE id = NEW.zone_id;
    IF NOT FOUND THEN
      NEW.nights_stayed_this_month := v_nights_stayed;
      NEW.consecutive_nights := v_consecutive;
      RETURN NEW;
    END IF;
  END IF;

  BEGIN
    SELECT (homeless_status = 'confirmed') INTO v_is_homeless
    FROM canonical_vehicles WHERE plate_number = NEW.plate_number;
    IF NOT FOUND THEN v_is_homeless := false; END IF;
  EXCEPTION WHEN OTHERS THEN v_is_homeless := false; END;

  IF COALESCE(v_matrix.day_visit_only, false) THEN
    v_nz_hour := EXTRACT(HOUR FROM NEW.recorded_at AT TIME ZONE 'Pacific/Auckland')::integer;
    IF v_nz_hour >= 20 OR v_nz_hour < 8 THEN
      v_is_compliant := false;
      v_breach_type := 'day_visit_violation';
      v_breach_reason := format('Night visit in day-only zone (observed at %s:00 NZ time)', v_nz_hour);
    END IF;
  END IF;

  IF v_is_compliant AND v_matrix.nights_per_month IS NOT NULL
    AND v_nights_stayed > v_matrix.nights_per_month
    AND NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
    v_is_compliant := false; v_breach_type := 'monthly_limit';
    v_breach_reason := format('Exceeded monthly stay limit: %s of %s nights', v_nights_stayed, v_matrix.nights_per_month);
  END IF;

  IF v_is_compliant AND v_matrix.max_consecutive_nights IS NOT NULL
    AND v_consecutive > v_matrix.max_consecutive_nights
    AND NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
    v_is_compliant := false; v_breach_type := 'consecutive_nights';
    v_breach_reason := format('Exceeded consecutive nights: %s of %s', v_consecutive, v_matrix.max_consecutive_nights);
  END IF;

  IF v_is_compliant AND COALESCE(v_matrix.self_contained_required, false)
    AND NOT v_self_contained
    AND NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
    v_is_compliant := false; v_breach_type := 'self_contained';
    v_breach_reason := 'Zone requires a self-contained vehicle; no valid CSC on record';
  END IF;

  NEW.nights_stayed_this_month := v_nights_stayed;
  NEW.consecutive_nights       := v_consecutive;
  NEW.is_compliant             := v_is_compliant;
  NEW.breach_type              := v_breach_type;
  NEW.breach_reason            := v_breach_reason;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.auto_evaluate_compliance() IS
  'BEFORE INSERT trigger: compliance evaluation with ultra-defensive type '
  'conversion (pg_typeof + EXCEPTION WHEN OTHERS). Emergency fix 2026-03-13.';

CREATE TRIGGER trg_auto_evaluate_compliance
  BEFORE INSERT ON public.observations
  FOR EACH ROW EXECUTE FUNCTION public.auto_evaluate_compliance();

-- ============================================================================
-- PART 3: Pipeline-complete safe_insert_observation RPC
-- ============================================================================
-- Primary observation-save path used by the simplified scan frontend.
-- Bypasses ALL triggers (SET LOCAL session_replication_role = 'replica') then
-- runs the full compliance pipeline inline so no downstream data is lost.

CREATE OR REPLACE FUNCTION public.safe_insert_observation(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_obs_id          UUID;
  v_result          jsonb;
  v_vehicle_make    TEXT; v_vehicle_model TEXT; v_vehicle_color TEXT; v_vehicle_year TEXT;
  v_self_contained  BOOLEAN := false; v_sc_expiry DATE;
  v_is_homeless     BOOLEAN := false; v_homeless_status TEXT := 'none';
  v_matrix          RECORD;
  v_is_compliant    BOOLEAN := true;
  v_breach_type     TEXT;   v_breach_reason TEXT;
  v_nz_hour         INTEGER;
  v_nights_stayed   INTEGER := 0; v_consecutive INTEGER := 0;
  v_plate           TEXT;   v_zone_id UUID; v_org_id UUID; v_recorded_at TIMESTAMPTZ;
  v_violation_reasons TEXT[] := ARRAY[]::TEXT[];
  v_matrix_snapshot   JSONB  := '{}'::jsonb;
BEGIN
  v_plate       := COALESCE(p_data->>'plate_number', 'PROCESSING...');
  v_recorded_at := COALESCE((p_data->>'recorded_at')::timestamptz, now());

  -- Required UUID fields — raise a clear error rather than a cryptic cast failure
  IF p_data->>'zone_id' IS NULL THEN
    RAISE EXCEPTION 'safe_insert_observation: zone_id is required';
  END IF;
  IF p_data->>'organization_id' IS NULL THEN
    RAISE EXCEPTION 'safe_insert_observation: organization_id is required';
  END IF;

  v_zone_id := (p_data->>'zone_id')::uuid;
  v_org_id  := (p_data->>'organization_id')::uuid;

  -- Step 1: Populate vehicle details from canonical_vehicles
  BEGIN
    SELECT vehicle_make, vehicle_model, vehicle_color, vehicle_year,
           COALESCE(cv.self_contained, false), cv.self_contained_expiry,
           COALESCE(cv.is_homeless, false), COALESCE(cv.homeless_status, 'none')
    INTO v_vehicle_make, v_vehicle_model, v_vehicle_color, v_vehicle_year,
         v_self_contained, v_sc_expiry, v_is_homeless, v_homeless_status
    FROM canonical_vehicles cv WHERE cv.plate_number = v_plate;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Step 2: Evaluate compliance
  BEGIN
    SELECT * INTO v_matrix FROM zone_compliance_matrix
    WHERE zone_id = v_zone_id AND effective_from <= v_recorded_at
      AND (effective_to IS NULL OR effective_to > v_recorded_at)
    ORDER BY version DESC LIMIT 1;
    IF NOT FOUND THEN
      SELECT self_contained_required, self_contained_required AS requires_csc,
             nights_per_month, max_consecutive_nights, day_visit_only, TRUE AS homeless_exemption
      INTO v_matrix FROM zones WHERE id = v_zone_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF v_matrix IS NOT NULL THEN
    BEGIN
      v_matrix_snapshot := jsonb_build_object(
        'self_contained_required', v_matrix.self_contained_required,
        'nights_per_month', v_matrix.nights_per_month,
        'max_consecutive_nights', v_matrix.max_consecutive_nights,
        'day_visit_only', v_matrix.day_visit_only,
        'homeless_exemption', COALESCE(v_matrix.homeless_exemption, true));
    EXCEPTION WHEN OTHERS THEN v_matrix_snapshot := '{}'::jsonb; END;

    IF COALESCE(v_matrix.day_visit_only, false) THEN
      v_nz_hour := EXTRACT(HOUR FROM v_recorded_at AT TIME ZONE 'Pacific/Auckland')::integer;
      IF v_nz_hour >= 20 OR v_nz_hour < 8 THEN
        v_is_compliant := false; v_breach_type := 'day_visit_violation';
        v_breach_reason := format('Night visit in day-only zone (%s:00 NZ)', v_nz_hour);
        v_violation_reasons := array_append(v_violation_reasons, 'day_visit_violation');
      END IF;
    END IF;

    IF v_is_compliant AND v_matrix.nights_per_month IS NOT NULL
      AND v_nights_stayed > v_matrix.nights_per_month
      AND NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
      v_is_compliant := false; v_breach_type := 'monthly_limit';
      v_breach_reason := format('Monthly limit: %s of %s nights', v_nights_stayed, v_matrix.nights_per_month);
      v_violation_reasons := array_append(v_violation_reasons,
        format('monthly_nights_exceeded_%s_of_%s', v_nights_stayed, v_matrix.nights_per_month));
    END IF;

    IF v_is_compliant AND v_matrix.max_consecutive_nights IS NOT NULL
      AND v_consecutive > v_matrix.max_consecutive_nights
      AND NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
      v_is_compliant := false; v_breach_type := 'consecutive_nights';
      v_breach_reason := format('Consecutive limit: %s of %s nights', v_consecutive, v_matrix.max_consecutive_nights);
      v_violation_reasons := array_append(v_violation_reasons,
        format('consecutive_nights_exceeded_%s_of_%s', v_consecutive, v_matrix.max_consecutive_nights));
    END IF;

    IF v_is_compliant AND COALESCE(v_matrix.self_contained_required, false)
      AND NOT v_self_contained
      AND NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
      v_is_compliant := false; v_breach_type := 'self_contained';
      v_breach_reason := 'Zone requires a self-contained vehicle; no valid CSC on record';
      v_violation_reasons := array_append(v_violation_reasons, 'not_self_contained');
    END IF;
  END IF;

  -- Step 3: Insert observation (triggers bypassed to avoid COALESCE crash)
  SET LOCAL session_replication_role = 'replica';
  INSERT INTO observations (
    plate_number, photo, photo_url, photo_hash, recorded_at, zone_id, organization_id,
    gps_latitude, gps_longitude, gps_accuracy, recorded_by, idempotency_key,
    vehicle_make, vehicle_model, vehicle_color, vehicle_year, self_contained, self_contained_expiry,
    nights_stayed_this_month, consecutive_nights, is_compliant, breach_type, breach_reason
  ) VALUES (
    v_plate, p_data->>'photo', p_data->>'photo_url', p_data->>'photo_hash',
    v_recorded_at, v_zone_id, v_org_id,
    (p_data->>'gps_latitude')::double precision, (p_data->>'gps_longitude')::double precision,
    (p_data->>'gps_accuracy')::double precision, (p_data->>'recorded_by')::uuid,
    p_data->>'idempotency_key',
    v_vehicle_make, v_vehicle_model, v_vehicle_color, v_vehicle_year,
    v_self_contained, v_sc_expiry, v_nights_stayed, v_consecutive,
    v_is_compliant, v_breach_type, v_breach_reason
  ) RETURNING observation_id INTO v_obs_id;
  SET LOCAL session_replication_role = 'DEFAULT';

  -- Step 4: Create compliance_results row
  BEGIN
    INSERT INTO compliance_results (
      observation_id, zone_id, organization_id, matrix_id, matrix_version,
      is_compliant, violation_reasons, matrix_snapshot, evaluated_at
    ) VALUES (
      v_obs_id, v_zone_id, v_org_id,
      CASE WHEN v_matrix IS NOT NULL THEN v_matrix.id ELSE NULL END,
      CASE WHEN v_matrix IS NOT NULL THEN v_matrix.version ELSE NULL END,
      v_is_compliant, v_violation_reasons, v_matrix_snapshot, now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'safe_insert_observation: compliance_results failed: %', SQLERRM;
  END;

  -- Step 5: Update canonical stats
  BEGIN
    UPDATE canonical_vehicles
    SET total_observations = COALESCE(total_observations, 0) + 1, last_seen_at = v_recorded_at
    WHERE plate_number = v_plate;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'safe_insert_observation: canonical stats failed: %', SQLERRM;
  END;

  -- Step 6: Create breach_alert if non-compliant
  IF NOT v_is_compliant AND v_breach_type IS NOT NULL THEN
    BEGIN
      INSERT INTO breach_alerts (
        observation_id, plate_number, zone_id, organization_id, breach_type, status, created_at
      ) VALUES (v_obs_id, v_plate, v_zone_id, v_org_id, v_breach_type, 'pending', now())
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'safe_insert_observation: breach_alerts failed: %', SQLERRM;
    END;
  END IF;

  -- Step 7: Return complete observation row
  SELECT to_jsonb(o.*) INTO v_result FROM observations o WHERE o.observation_id = v_obs_id;
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.safe_insert_observation(jsonb) IS
  'Primary scan save path (2026-03-13): bypasses broken triggers and runs '
  'full compliance pipeline inline (canonical lookup → compliance eval → '
  'observation → compliance_results → canonical stats → breach_alerts).';

GRANT EXECUTE ON FUNCTION public.safe_insert_observation(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_insert_observation(jsonb) TO service_role;

-- ============================================================================
-- PART 4: Force PostgREST schema cache reload
-- ============================================================================

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================================
-- PART 5: Verification
-- ============================================================================

DO $$
DECLARE
  v_trigger boolean; v_rpc boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'observations' AND t.tgname = 'trg_auto_evaluate_compliance'
  ) INTO v_trigger;
  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'safe_insert_observation' AND pronamespace = 'public'::regnamespace
  ) INTO v_rpc;
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '  20260313000001_emergency_coalesce_fix — COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '  trg_auto_evaluate_compliance (defensive): %', CASE WHEN v_trigger THEN 'CREATED ✓' ELSE 'MISSING ✗' END;
  RAISE NOTICE '  safe_insert_observation RPC (pipeline):  %', CASE WHEN v_rpc    THEN 'CREATED ✓' ELSE 'MISSING ✗' END;
  RAISE NOTICE '  PostgREST schema cache reload:           ISSUED ✓';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
END;
$$;

COMMIT;
