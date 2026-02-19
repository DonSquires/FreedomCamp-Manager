-- RPC PUBLIC WRAPPERS - FIX 404 ERRORS
-- Creates functions with exact names UI expects (cohort_overstayers, cohort_homeless_exempt)
-- Delegates to recompute logic for zero-trust compliance

-- ==================== STEP 1: VERIFY EXISTING FUNCTIONS ====================

-- Check what cohort functions currently exist
DO $$
BEGIN
  RAISE NOTICE '📋 Existing cohort functions:';
  PERFORM proname 
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' 
    AND p.proname ILIKE 'cohort%';
END;
$$;

-- ==================== STEP 2: CREATE PUBLIC WRAPPERS ====================

-- OVERSTAYERS: Returns observation IDs (UI fetches full records after)
CREATE OR REPLACE FUNCTION public.cohort_overstayers(
  p_from timestamptz,
  p_to timestamptz,
  p_org_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
)
RETURNS TABLE (observation_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Delegate to recompute version if it exists, otherwise use direct logic
  SELECT observation_id
  FROM cohort_overstayers_recalc(p_from, p_to, p_org_id, p_zone_id);
$$;

COMMENT ON FUNCTION public.cohort_overstayers(timestamptz, timestamptz, uuid, uuid) IS
'PUBLIC WRAPPER for UI - returns observation IDs for breach excluding homeless-exempt';

-- HOMELESS EXEMPT: Returns observation IDs
CREATE OR REPLACE FUNCTION public.cohort_homeless_exempt(
  p_from timestamptz,
  p_to timestamptz,
  p_org_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
)
RETURNS TABLE (observation_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT observation_id
  FROM cohort_homeless_exempt_recalc(p_from, p_to, p_org_id, p_zone_id);
$$;

COMMENT ON FUNCTION public.cohort_homeless_exempt(timestamptz, timestamptz, uuid, uuid) IS
'PUBLIC WRAPPER for UI - returns observation IDs for breach with homeless exemption';

-- COMPLIANT: Returns observation IDs
CREATE OR REPLACE FUNCTION public.cohort_compliant(
  p_from timestamptz,
  p_to timestamptz,
  p_org_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
)
RETURNS TABLE (observation_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT observation_id
  FROM cohort_compliant_recalc(p_from, p_to, p_org_id, p_zone_id);
$$;

COMMENT ON FUNCTION public.cohort_compliant(timestamptz, timestamptz, uuid, uuid) IS
'PUBLIC WRAPPER for UI - returns observation IDs for compliant observations';

-- ALL BREACHES: Returns observation IDs
CREATE OR REPLACE FUNCTION public.cohort_all_breaches(
  p_from timestamptz,
  p_to timestamptz,
  p_org_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
)
RETURNS TABLE (observation_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Union of overstayers + homeless_exempt
  SELECT observation_id FROM cohort_overstayers_recalc(p_from, p_to, p_org_id, p_zone_id)
  UNION
  SELECT observation_id FROM cohort_homeless_exempt_recalc(p_from, p_to, p_org_id, p_zone_id);
$$;

COMMENT ON FUNCTION public.cohort_all_breaches(timestamptz, timestamptz, uuid, uuid) IS
'PUBLIC WRAPPER for UI - returns ALL breach observation IDs (including homeless-exempt)';

-- ==================== STEP 3: ZONE REQUIREMENTS WRAPPER ====================

-- Ensure evaluate_observation_requirements is callable
-- (Already created in earlier migration, just grant permissions)
GRANT EXECUTE ON FUNCTION public.evaluate_observation_requirements(uuid) TO authenticated;

-- If the function doesn't exist, create alias to _recalc version
CREATE OR REPLACE FUNCTION public.evaluate_observation_requirements(p_obs_id uuid)
RETURNS TABLE (
  observation_id uuid,
  requirement_code text,
  requirement_label text,
  status text,
  reason text,
  sort_order int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * 
  FROM evaluate_observation_requirements_recalc(p_obs_id);
$$;

COMMENT ON FUNCTION public.evaluate_observation_requirements(uuid) IS
'PUBLIC WRAPPER for UI - returns zone requirements breakdown for observation';

-- ==================== STEP 4: GRANT PERMISSIONS ====================

GRANT EXECUTE ON FUNCTION public.cohort_overstayers(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cohort_homeless_exempt(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cohort_compliant(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cohort_all_breaches(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_observation_requirements(uuid) TO authenticated;

-- Also grant on anon for public read access
GRANT EXECUTE ON FUNCTION public.cohort_overstayers(timestamptz, timestamptz, uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.cohort_homeless_exempt(timestamptz, timestamptz, uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.cohort_compliant(timestamptz, timestamptz, uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.cohort_all_breaches(timestamptz, timestamptz, uuid, uuid) TO anon;

-- ==================== STEP 5: VERIFICATION QUERIES ====================

-- Test that functions are now visible to PostgREST
DO $$
DECLARE
  v_count int;
BEGIN
  -- Count visible cohort functions
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' 
    AND p.proname IN ('cohort_overstayers', 'cohort_homeless_exempt', 'cohort_compliant', 'cohort_all_breaches')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF v_count = 4 THEN
    RAISE NOTICE '✅ All 4 cohort wrappers are PUBLIC and EXECUTABLE by authenticated';
  ELSE
    RAISE WARNING '⚠️  Only % cohort wrappers found (expected 4)', v_count;
  END IF;

  -- Check requirements function
  IF has_function_privilege('authenticated', 'evaluate_observation_requirements(uuid)', 'EXECUTE') THEN
    RAISE NOTICE '✅ evaluate_observation_requirements is PUBLIC and EXECUTABLE';
  ELSE
    RAISE WARNING '⚠️  evaluate_observation_requirements is NOT executable by authenticated';
  END IF;
END;
$$;

-- ==================== DIAGNOSTIC TEST ====================

-- Test overstayers for 17/02/2026 (should return IDs, not 404)
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM cohort_overstayers(
    '2026-02-17T00:00:00+13',
    '2026-02-17T23:59:59+13',
    NULL, NULL
  );

  RAISE NOTICE '🔍 Overstayers count for 17/02/2026: %', v_count;

  IF v_count = 0 THEN
    RAISE WARNING '⚠️  Overstayers returned 0 - check if recompute views have data';
  END IF;
END;
$$;

-- ==================== USAGE NOTES ====================

COMMENT ON FUNCTION public.cohort_overstayers IS
'BROWSER TEST (paste in DevTools console):

const { data, error } = await supabase.rpc("cohort_overstayers", {
  p_from: "2026-02-17T00:00:00+13:00",
  p_to: "2026-02-17T23:59:59+13:00",
  p_org_id: null,
  p_zone_id: null
});
console.log("Overstayers:", data?.length, data);

// Should return: { data: [{ observation_id: uuid }, ...], error: null }
// NOT: 404 or { data: null, error: {...} }
';

COMMENT ON FUNCTION public.evaluate_observation_requirements IS
'BROWSER TEST:

// Get an observation ID first
const { data: obs } = await supabase.rpc("cohort_overstayers", { 
  p_from: "2026-02-17T00:00:00+13:00",
  p_to: "2026-02-17T23:59:59+13:00"
});
const obsId = obs?.[0]?.observation_id;

// Get requirements
const { data: reqs, error } = await supabase.rpc("evaluate_observation_requirements", {
  p_obs_id: obsId
});
console.log("Requirements:", reqs);

// Should return array with status, reason fields
';
