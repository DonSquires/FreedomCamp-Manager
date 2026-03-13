-- ============================================================================
-- Emergency Fix: COALESCE trigger error + safe_insert_observation RPC
-- Date: 2026-03-13
--
-- Context:
--   Scan pipeline started failing with the 3-path fallback chain all failing:
--
--   PATH 1 (direct insert): "COALESCE types integer and text cannot be matched"
--     The auto_evaluate_compliance() BEFORE INSERT trigger uses bare
--     COALESCE(NEW.nights_stayed_this_month, 0) where the column type has
--     drifted to TEXT.  PostgreSQL cannot implicitly coerce between TEXT and
--     INTEGER inside COALESCE.
--
--   PATH 2 (vehicle-ingest edge function): "Failed to send a request to the
--     Edge Function"
--     Root cause: the function downloaded the photo (≈333 KB) + waited for
--     Railway inference (5 s timeout) + ALPR backup (3.5 s timeout) = ≈9.3 s
--     total, approaching Supabase's ≈10 s wall-clock limit.  The function was
--     killed before it could return a CORS-decorated response; the browser
--     received a TypeError and supabase-js reported the relay error.
--     Fix applied in FieldOfficerPortal.tsx + vehicle-ingest/index.ts:
--       • Frontend now computes a real SHA-256 hash client-side and passes it
--         as photo_hash.  When vehicle-ingest receives photo_url + photo_hash
--         (no raw bytes) it operates in "storage-first" mode: skips the byte
--         download and inference entirely, saving ≈8.5 s of execution time.
--       • Inference/ALPR are deferred to the fire-and-forget ALPR call at
--         FieldOfficerPortal STEP 8 which runs after the observation is saved.
--
--   PATH 3 (safe_insert_observation RPC): 150 ms failure
--     The RPC function did not exist in the production DB yet.
--
-- This migration:
--   1. Replaces auto_evaluate_compliance() with an exception-wrapped version
--      that never uses bare COALESCE(column, integer_literal).  This fixes
--      PATH 1 so direct inserts work again.
--   2. Creates safe_insert_observation(jsonb) RPC so PATH 3 works as a last-
--      resort fallback even if PATH 1 and PATH 2 fail.
--
-- Idempotent: safe to re-run. Later migrations 20260401000001/2 and
-- 20260404000001/2 will further refine both functions.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Fix auto_evaluate_compliance() trigger
-- ============================================================================
-- Drop any stale legacy triggers before replacing the function.
DROP TRIGGER IF EXISTS trigger_auto_compliance_check ON public.observations;
DROP TRIGGER IF EXISTS trg_auto_evaluate_compliance   ON public.observations;

-- Ensure the compliance columns exist with correct base types so the new
-- trigger function doesn't fail on a fresh schema.
ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS nights_stayed_this_month integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_nights        integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_compliant              boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS breach_type               text,
  ADD COLUMN IF NOT EXISTS breach_reason             text,
  ADD COLUMN IF NOT EXISTS self_contained            boolean DEFAULT false;

CREATE OR REPLACE FUNCTION public.auto_evaluate_compliance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_matrix          RECORD;
  v_is_homeless     BOOLEAN := false;
  v_nz_hour         INTEGER;
  v_is_compliant    BOOLEAN := true;
  v_breach_type     TEXT    := NULL;
  v_breach_reason   TEXT    := NULL;
  v_nights_stayed   INTEGER := 0;
  v_consecutive     INTEGER := 0;
  v_self_contained  BOOLEAN := false;
BEGIN
  -- ─── Safe type conversion: handles INTEGER, TEXT, or NULL ─────────────────
  -- Each block catches ALL exceptions and falls back to a safe default.
  -- This prevents "COALESCE types integer and text cannot be matched" errors
  -- when column types have drifted from INTEGER to TEXT.

  BEGIN
    v_nights_stayed := COALESCE(
      NULLIF(regexp_replace(NEW.nights_stayed_this_month::text, '[^0-9]', '', 'g'), '')::integer,
      0
    );
    IF v_nights_stayed < 0 THEN v_nights_stayed := 0; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_nights_stayed := 0;
  END;

  BEGIN
    v_consecutive := COALESCE(
      NULLIF(regexp_replace(NEW.consecutive_nights::text, '[^0-9]', '', 'g'), '')::integer,
      0
    );
    IF v_consecutive < 0 THEN v_consecutive := 0; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_consecutive := 0;
  END;

  BEGIN
    v_self_contained := lower(COALESCE(NEW.self_contained::text, 'false'))
                        IN ('true', 't', '1', 'yes', 'y');
  EXCEPTION WHEN OTHERS THEN
    v_self_contained := false;
  END;

  -- ─── Compliance matrix lookup ──────────────────────────────────────────────
  SELECT *
    INTO v_matrix
    FROM zone_compliance_matrix
   WHERE zone_id = NEW.zone_id
     AND effective_from <= NEW.recorded_at
     AND (effective_to IS NULL OR effective_to > NEW.recorded_at)
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
    WHERE id = NEW.zone_id;

    IF NOT FOUND THEN
      -- No zone rules — write sanitised values and allow the insert.
      NEW.nights_stayed_this_month := v_nights_stayed;
      NEW.consecutive_nights       := v_consecutive;
      RETURN NEW;
    END IF;
  END IF;

  -- ─── Homeless status ────────────────────────────────────────────────────────
  BEGIN
    SELECT (homeless_status = 'confirmed')
      INTO v_is_homeless
      FROM canonical_vehicles
     WHERE plate_number = NEW.plate_number;
    IF NOT FOUND THEN v_is_homeless := false; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_is_homeless := false;
  END;

  -- ─── Compliance rules ───────────────────────────────────────────────────────
  IF COALESCE(v_matrix.day_visit_only, false) THEN
    v_nz_hour := EXTRACT(HOUR FROM NEW.recorded_at AT TIME ZONE 'Pacific/Auckland')::integer;
    IF v_nz_hour >= 20 OR v_nz_hour < 8 THEN
      v_is_compliant  := false;
      v_breach_type   := 'day_visit_violation';
      v_breach_reason := format('Night visit in day-only zone (observed at %s:00 NZ time)', v_nz_hour);
    END IF;
  END IF;

  IF v_is_compliant AND v_matrix.nights_per_month IS NOT NULL THEN
    IF v_nights_stayed > v_matrix.nights_per_month THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant  := false;
        v_breach_type   := 'monthly_limit';
        v_breach_reason := format(
          'Exceeded monthly stay limit: %s nights stayed, limit is %s',
          v_nights_stayed, v_matrix.nights_per_month
        );
      END IF;
    END IF;
  END IF;

  IF v_is_compliant AND v_matrix.max_consecutive_nights IS NOT NULL THEN
    IF v_consecutive > v_matrix.max_consecutive_nights THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant  := false;
        v_breach_type   := 'consecutive_nights';
        v_breach_reason := format(
          'Exceeded consecutive nights limit: %s consecutive nights, limit is %s',
          v_consecutive, v_matrix.max_consecutive_nights
        );
      END IF;
    END IF;
  END IF;

  IF v_is_compliant AND (
    COALESCE(v_matrix.self_contained_required, false) OR
    COALESCE(v_matrix.requires_csc, false)
  ) THEN
    IF NOT v_self_contained THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant  := false;
        v_breach_type   := 'self_contained';
        v_breach_reason := 'Zone requires a self-contained vehicle; no valid CSC on record';
      END IF;
    END IF;
  END IF;

  -- Write results back onto the row.
  NEW.nights_stayed_this_month := v_nights_stayed;
  NEW.consecutive_nights       := v_consecutive;
  NEW.is_compliant             := v_is_compliant;
  NEW.breach_type              := v_breach_type;
  NEW.breach_reason            := v_breach_reason;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.auto_evaluate_compliance() IS
  'BEFORE INSERT trigger: evaluates compliance rules and sets is_compliant, '
  'breach_type, breach_reason.  Uses exception-wrapped type conversion to '
  'prevent COALESCE type-mismatch errors from column type drift. '
  'Emergency fix applied 2026-03-13.';

CREATE TRIGGER trg_auto_evaluate_compliance
  BEFORE INSERT ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_evaluate_compliance();

-- ============================================================================
-- PART 2: Create safe_insert_observation RPC (PATH 3 fallback)
-- ============================================================================
-- Bypasses all triggers by setting session_replication_role = 'replica'.
-- Used as the last-resort fallback when the BEFORE INSERT trigger is broken.
-- The pipeline-complete version (inline compliance + compliance_results +
-- breach_alerts) is applied by migration 20260404000002; this version is
-- sufficient to save the observation so it is not lost.

CREATE OR REPLACE FUNCTION public.safe_insert_observation(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Bypass all triggers for this transaction only (no table lock, no impact
  -- on concurrent sessions).  Avoids the COALESCE type-mismatch error in
  -- auto_evaluate_compliance() without needing to ALTER TABLE.
  SET LOCAL session_replication_role = 'replica';

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
    -- Explicit compliance defaults (trigger is bypassed)
    nights_stayed_this_month,
    consecutive_nights,
    is_compliant,
    self_contained
  ) VALUES (
    COALESCE(p_data->>'plate_number', 'PROCESSING...'),
    p_data->>'photo',
    p_data->>'photo_url',
    p_data->>'photo_hash',
    COALESCE((p_data->>'recorded_at')::timestamptz, now()),
    (p_data->>'zone_id')::uuid,
    (p_data->>'organization_id')::uuid,
    (p_data->>'gps_latitude')::double precision,
    (p_data->>'gps_longitude')::double precision,
    (p_data->>'gps_accuracy')::double precision,
    (p_data->>'recorded_by')::uuid,
    p_data->>'idempotency_key',
    0,
    0,
    true,
    false
  )
  RETURNING to_jsonb(observations.*) INTO v_result;

  SET LOCAL session_replication_role = 'DEFAULT';

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.safe_insert_observation(jsonb) IS
  'Emergency fallback (2026-03-13): inserts an observation bypassing all '
  'triggers. Updated to pipeline-complete version by 20260404000002.';

GRANT EXECUTE ON FUNCTION public.safe_insert_observation(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_insert_observation(jsonb) TO service_role;

-- ============================================================================
-- PART 3: Force PostgREST schema cache reload
-- ============================================================================

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================================
-- PART 4: Verification
-- ============================================================================

DO $$
DECLARE
  v_trigger_exists boolean;
  v_rpc_exists     boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c  ON t.tgrelid  = c.oid
    JOIN pg_namespace n ON n.oid   = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'observations'
      AND t.tgname  = 'trg_auto_evaluate_compliance'
  ) INTO v_trigger_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'safe_insert_observation'
      AND pronamespace = 'public'::regnamespace
  ) INTO v_rpc_exists;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  20260313000001_emergency_coalesce_fix — COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  trg_auto_evaluate_compliance:   %',
    CASE WHEN v_trigger_exists THEN 'CREATED ✓' ELSE 'MISSING ✗' END;
  RAISE NOTICE '  safe_insert_observation RPC:    %',
    CASE WHEN v_rpc_exists THEN 'CREATED ✓' ELSE 'MISSING ✗' END;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END;
$$;

COMMIT;
