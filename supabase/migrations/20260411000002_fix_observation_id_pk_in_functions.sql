-- ============================================================================
-- Fix observation_id PK usage in stored functions and backfill
-- Date: 2026-04-11
--
-- The `observations` table primary key is `observation_id` (NOT NULL).
-- The column `id` is a nullable secondary UUID added for legacy compatibility.
-- Several functions and a backfill UPDATE were written against `id` which
-- causes them to silently miss rows or fail to find observations.
--
-- This migration:
--   1. Re-creates get_observation_result()   – fixes WHERE id = → WHERE observation_id =
--   2. Re-creates evaluate_observation_requirements() – same fix
--   3. Re-runs the observation_jobs backfill using the correct FK column
-- ============================================================================

-- ── 1. Fix get_observation_result() ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_observation_result(p_observation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_obs          observations%ROWTYPE;
  v_zone         zones%ROWTYPE;
  v_is_homeless  BOOLEAN := false;
  v_status       TEXT;
  v_summary      TEXT;
  v_action_req   BOOLEAN;
  v_rec_action   TEXT;
BEGIN
  -- Load observation using the actual PK column
  SELECT * INTO v_obs FROM observations WHERE observation_id = p_observation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Observation not found');
  END IF;

  -- Load zone
  SELECT * INTO v_zone FROM zones WHERE id = v_obs.zone_id;

  -- Check homeless status
  SELECT (homeless_status IN ('confirmed', 'claimed'))
    INTO v_is_homeless
    FROM canonical_vehicles
   WHERE plate_number = v_obs.plate_number;
  IF NOT FOUND THEN v_is_homeless := false; END IF;

  -- Determine status
  IF v_is_homeless THEN
    v_status     := 'BREACH_EXEMPT';
    v_summary    := 'Vehicle is under the Freedom Camping Act – homeless exemption applies';
    v_action_req := false;
    v_rec_action := 'Refer to welfare services';
  ELSIF COALESCE(v_obs.is_compliant, true) THEN
    v_status     := 'COMPLIANT';
    v_summary    := 'Vehicle is compliant with all zone requirements';
    v_action_req := false;
    v_rec_action := 'No action required';
  ELSE
    v_status     := 'BREACH';
    v_summary    := COALESCE(v_obs.breach_reason, format('Breach: %s', v_obs.breach_type));
    v_action_req := true;
    v_rec_action := 'Issue warning or notice';
  END IF;

  RETURN jsonb_build_object(
    'observation_id',     p_observation_id,
    'plate_number',       v_obs.plate_number,
    'zone_name',          v_zone.name,
    'overall_status',     v_status,
    'action_required',    v_action_req,
    'summary',            v_summary,
    'breach_type',        v_obs.breach_type,
    'breach_reason',      v_obs.breach_reason,
    'nights_stayed',      v_obs.nights_stayed_this_month,
    'consecutive_nights', v_obs.consecutive_nights,
    'recommended_action', v_rec_action
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_observation_result(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_observation_result(uuid) TO service_role;

COMMENT ON FUNCTION public.get_observation_result(uuid) IS
  'Layer-4 RPC: returns compliance result formatted for the Officer App. '
  'Uses observation_id (PK) not the deprecated nullable id column.';

-- ── 2. Fix evaluate_observation_requirements() ──────────────────────────────

-- Signature changes across historical migrations require explicit drop/recreate.
DROP FUNCTION IF EXISTS public.evaluate_observation_requirements(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.evaluate_observation_requirements(p_observation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_obs observations%ROWTYPE;
BEGIN
  SELECT * INTO v_obs FROM observations WHERE observation_id = p_observation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Observation not found');
  END IF;

  RETURN jsonb_build_object(
    'is_compliant',       COALESCE(v_obs.is_compliant, true),
    'breach_type',        v_obs.breach_type,
    'breach_reason',      v_obs.breach_reason,
    'nights_stayed',      v_obs.nights_stayed_this_month,
    'consecutive_nights', v_obs.consecutive_nights,
    'self_contained',     v_obs.self_contained
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.evaluate_observation_requirements(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_observation_requirements(uuid) TO service_role;

COMMENT ON FUNCTION public.evaluate_observation_requirements(uuid) IS
  'Simplified RPC: returns key compliance fields for a single observation. '
  'Uses observation_id (PK) not the deprecated nullable id column.';

-- ── 3. Re-run observation_jobs backfill with correct PK column ───────────────
-- The original backfill in 20260303000002 joined on o.id (nullable secondary)
-- instead of o.observation_id (PK), so rows where o.id was NULL were missed.
-- Re-running with the correct join fills any gaps.
--
-- NOTE: observation_jobs has been created and dropped multiple times across the
-- migration history.  This block is fully defensive: it only executes the
-- UPDATE when the table and the required columns (recorded_by, organization_id)
-- actually exist in the database.

DO $$
DECLARE
  v_table_exists   boolean;
  v_has_recorded_by boolean;
  v_has_org_id      boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'observation_jobs' AND n.nspname = 'public'
  ) INTO v_table_exists;

  IF NOT v_table_exists THEN
    RAISE NOTICE '⚠️  observation_jobs table does not exist - skipping backfill (no action needed)';
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'observation_jobs'
        AND column_name  = 'recorded_by'
    ) INTO v_has_recorded_by;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'observation_jobs'
        AND column_name  = 'organization_id'
    ) INTO v_has_org_id;

    IF v_has_recorded_by AND v_has_org_id THEN
      UPDATE public.observation_jobs oj
      SET
        recorded_by     = o.recorded_by,
        organization_id = o.organization_id
      FROM public.observations o
      WHERE oj.observation_id = o.observation_id
        AND (oj.recorded_by IS NULL OR oj.organization_id IS NULL);

      RAISE NOTICE '✅ observation_jobs backfill re-run with correct observation_id join';
    ELSE
      RAISE NOTICE '⚠️  observation_jobs exists but lacks recorded_by/organization_id columns - skipping backfill';
    END IF;
  END IF;

  RAISE NOTICE '✅ get_observation_result and evaluate_observation_requirements fixed to use observation_id PK';
END;
$$;
