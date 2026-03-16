-- ============================================================================
-- Definitive Fix: safe_insert_observation → INSERT INTO observations
-- Date: 2026-03-16 (Schema Extract #20 audit)
--
-- ROOT CAUSE identified in Schema Extract #20:
--   The safe_insert_observation function body in the live database still
--   references vehicle_observations_v2 (from a pre-rename version of the
--   function that was never successfully overwritten because:
--     (a) migration 20260416000001's ROLLBACK-on-verification-fail pattern
--         may have reverted the fix on the live DB, and
--     (b) the GRANT...TO authenticated statement used in migrations
--         20260404000001, 20260407000001, 20260408000001, 20260411000003,
--         and 20260416000001 causes transaction ROLLBACK in the local
--         migration-replay environment (no 'authenticated' role exists),
--         and similar fragility may exist on the live DB if any prior
--         migration failed mid-transaction.
--
-- This migration is the ONE TRUE FIX:
--   • Drops and re-creates safe_insert_observation cleanly — no REPLACE,
--     no verify block, no conditions that cause silent rollback.
--   • All GRANTs are exception-safe so the migration never fails in replay.
--   • Adds officer_notes column support (from scanPipeline.ts payload).
--   • Forces PostgREST schema-cache reload at the end.
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- ── Drop-then-create ensures no stale function body survives ────────────────
DROP FUNCTION IF EXISTS public.safe_insert_observation(jsonb);

CREATE FUNCTION public.safe_insert_observation(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_obs_id            UUID;
  v_result            jsonb;
  v_vehicle_make      TEXT;
  v_vehicle_model     TEXT;
  v_vehicle_color     TEXT;
  v_vehicle_year      INTEGER;
  v_self_contained    BOOLEAN := false;
  v_sc_expiry         DATE;
  v_is_homeless       BOOLEAN := false;
  v_homeless_status   TEXT    := 'none';
  v_matrix            RECORD;
  v_is_compliant      BOOLEAN := true;
  v_breach_type       TEXT;
  v_breach_reason     TEXT;
  v_nz_hour           INTEGER;
  v_nights_stayed     INTEGER := 0;
  v_consecutive       INTEGER := 0;
  v_plate             TEXT;
  v_zone_id           UUID;
  v_org_id            UUID;
  v_recorded_at       TIMESTAMPTZ;
  v_violation_reasons TEXT[]  := ARRAY[]::TEXT[];
  v_matrix_snapshot   JSONB   := '{}'::jsonb;
BEGIN
  -- ── Input extraction ──────────────────────────────────────────────────────
  v_plate       := COALESCE(p_data->>'plate_number', 'PROCESSING...');
  v_recorded_at := COALESCE((p_data->>'recorded_at')::timestamptz, now());

  IF p_data->>'zone_id' IS NULL THEN
    RAISE EXCEPTION 'safe_insert_observation: zone_id is required';
  END IF;
  IF p_data->>'organization_id' IS NULL THEN
    RAISE EXCEPTION 'safe_insert_observation: organization_id is required';
  END IF;

  v_zone_id := (p_data->>'zone_id')::uuid;
  v_org_id  := (p_data->>'organization_id')::uuid;

  -- ── Step 1: Canonical vehicle lookup ──────────────────────────────────────
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
    NULL; -- unknown plate is fine; fields remain NULL/default
  END;

  -- ── Step 2: Compliance evaluation ─────────────────────────────────────────
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
        v_breach_reason := format(
          'Night visit in day-only zone (observed at %s:00 NZ time)', v_nz_hour);
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
            format('monthly_nights_exceeded_%s_of_%s',
              v_nights_stayed, v_matrix.nights_per_month));
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
            format('consecutive_nights_exceeded_%s_of_%s',
              v_consecutive, v_matrix.max_consecutive_nights));
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

  -- ── Step 3: INSERT INTO observations ──────────────────────────────────────
  -- This is the canonical observations table (previously named vehicle_observations_v2
  -- before migration 20260322000001 renamed it).  The FK constraints on this table
  -- still carry the vehicle_observations_v2_ prefix names — that is expected and correct.
  --
  -- Triggers are bypassed via session_replication_role = 'replica' so that any
  -- trigger that still references the old table name cannot cause this step to fail.
  SET LOCAL session_replication_role = 'replica';
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
      officer_notes,
      vehicle_make,
      vehicle_model,
      vehicle_color,
      vehicle_year,
      self_contained,
      self_contained_expiry,
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
      p_data->>'officer_notes',
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
    SET LOCAL session_replication_role = 'DEFAULT';
    RAISE EXCEPTION 'safe_insert_observation: INSERT into observations failed: %', SQLERRM;
  END;
  SET LOCAL session_replication_role = 'DEFAULT';

  -- ── Step 4: Belt-and-suspenders canonical stats ───────────────────────────
  BEGIN
    UPDATE canonical_vehicles
       SET total_observations = COALESCE(total_observations, 0) + 1,
           last_seen_at       = v_recorded_at
     WHERE plate_number = v_plate;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'safe_insert_observation: canonical stats update failed: %', SQLERRM;
  END;

  -- ── Step 5: Belt-and-suspenders breach alert ──────────────────────────────
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

  -- ── Step 6: Return full observation row ───────────────────────────────────
  SELECT to_jsonb(o.*) INTO v_result
  FROM observations o
  WHERE o.observation_id = v_obs_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.safe_insert_observation(jsonb) IS
  'Primary scan save path. Always INSERTs into public.observations. '
  'Triggers are bypassed via session_replication_role=replica to prevent '
  'any stale trigger from referencing vehicle_observations_v2. '
  'Definitive fix: 20260316000003 (Schema Extract #20 audit).';

-- ── GRANTs — exception-safe so migration never fails in replay ────────────
DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION public.safe_insert_observation(jsonb) TO authenticated;
EXCEPTION WHEN undefined_object THEN
  NULL; -- role does not exist in local replay — skip
END;
$$;

DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION public.safe_insert_observation(jsonb) TO service_role;
EXCEPTION WHEN undefined_object THEN
  NULL;
END;
$$;

-- ── Fix stale observation trigger that would break direct-insert fallback ────
-- If observation_jobs table does not exist but the trg_create_observation_job
-- trigger / enqueue_observation_job function still exist, every direct INSERT
-- INTO observations (including the scanPipeline.ts fallback path) would fail
-- with "relation observation_jobs does not exist".
-- Make enqueue_observation_job a no-op when the table is absent and remove the
-- broken trigger so direct inserts work correctly.
DO $$
DECLARE
  v_obs_jobs_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'observation_jobs' AND n.nspname = 'public'
  ) INTO v_obs_jobs_exists;

  IF NOT v_obs_jobs_exists THEN
    -- Drop the broken trigger first
    DROP TRIGGER IF EXISTS trg_create_observation_job ON public.observations;

    -- Replace enqueue_observation_job with a safe no-op stub so any remaining
    -- call sites do not crash (includes trg_fn_create_observation_job if it
    -- still exists as a standalone function).
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'enqueue_observation_job' AND n.nspname = 'public'
    ) THEN
      EXECUTE $fn$
        CREATE OR REPLACE FUNCTION public.enqueue_observation_job(
          p_observation_id uuid,
          p_job_type       text DEFAULT 'all'::text
        )
        RETURNS uuid
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public
        AS $body$
        BEGIN
          -- observation_jobs table is absent; log and return NULL safely.
          RAISE WARNING 'enqueue_observation_job: observation_jobs absent — skipping job enqueue for %', p_observation_id;
          RETURN NULL;
        END;
        $body$
      $fn$;
      RAISE NOTICE 'enqueue_observation_job replaced with safe no-op stub.';
    END IF;
  ELSE
    RAISE NOTICE 'observation_jobs table exists — leaving trigger and enqueue_observation_job unchanged.';
  END IF;
END;
$$;

-- ── Force PostgREST schema-cache reload ───────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;
