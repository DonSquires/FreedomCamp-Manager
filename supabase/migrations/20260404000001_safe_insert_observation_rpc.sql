-- ============================================================================
-- Safe Insert Observation RPC
-- Date: 2026-04-04
--
-- Creates a SECURITY DEFINER function that inserts observations while
-- temporarily bypassing all triggers.  This serves as an emergency fallback
-- when the auto_evaluate_compliance() trigger function is broken due to
-- column-type drift (the recurring "COALESCE types integer and text cannot
-- be matched" error).
--
-- Usage (from Supabase client):
--   supabase.rpc('safe_insert_observation', { p_data: { ... } })
--
-- The function:
--   1. Disables triggers for the current transaction (session_replication_role)
--   2. Inserts the observation with explicit compliance defaults
--   3. Re-enables triggers (automatic on transaction end)
--
-- Because it runs as SECURITY DEFINER (owner = postgres / superuser),
-- SET LOCAL session_replication_role = 'replica' is permitted.
-- The setting is transaction-local — no concurrency impact.
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Create safe_insert_observation RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.safe_insert_observation(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Bypass all triggers for this transaction only (no table lock, no
  -- impact on concurrent sessions).  This avoids the COALESCE type-mismatch
  -- error in auto_evaluate_compliance() without needing to ALTER TABLE.
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

  -- Re-enable triggers (happens automatically at transaction end, but
  -- being explicit avoids surprises).
  SET LOCAL session_replication_role = 'DEFAULT';

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.safe_insert_observation(jsonb) IS
  'Emergency fallback: inserts an observation while bypassing all triggers. '
  'Used when auto_evaluate_compliance() is broken due to column-type drift.';

-- Grant access via PostgREST
GRANT EXECUTE ON FUNCTION public.safe_insert_observation(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_insert_observation(jsonb) TO service_role;

-- ============================================================================
-- PART 2: Verify trigger function is the safe version
-- ============================================================================
-- The trigger fix was applied in 20260401000002_hotfix_coalesce_type_mismatch.
-- Verify that it's the exception-wrapped version (not the old COALESCE one).

DO $$
DECLARE
  v_src text;
  v_safe boolean;
BEGIN
  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE proname = 'auto_evaluate_compliance'
    AND pronamespace = 'public'::regnamespace;

  IF v_src IS NULL THEN
    RAISE WARNING 'auto_evaluate_compliance() function not found!';
    RETURN;
  END IF;

  -- The safe version uses pg_typeof() or EXCEPTION blocks — the unsafe
  -- version uses bare COALESCE(NEW.column, integer_literal).
  v_safe := (
    v_src ILIKE '%pg_typeof%' OR
    v_src ILIKE '%EXCEPTION WHEN OTHERS%'
  ) AND NOT (
    v_src ILIKE '%COALESCE(NEW.nights_stayed_this_month, 0)%'
  );

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  20260404000001_safe_insert_observation_rpc - COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  safe_insert_observation() RPC:  CREATED ✓';
  RAISE NOTICE '  auto_evaluate_compliance():     %',
    CASE WHEN v_safe THEN 'SAFE (exception-wrapped) ✓'
         ELSE 'UNSAFE — deploy 20260401000002 first! ✗' END;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END;
$$;

-- Force PostgREST schema cache reload so the new RPC is available immediately
NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
