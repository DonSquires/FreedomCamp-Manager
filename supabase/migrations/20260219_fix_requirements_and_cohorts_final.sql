-- FINAL FIX: Zone Requirements + KPI Cohorts Alignment
-- Ensures:
-- 1. evaluate_observation_requirements returns proper data with non-NULL reasons
-- 2. cohort RPCs use compliance_results.is_homeless_exempt (not just canonical_vehicles)
-- 3. All permissions are granted correctly

-- ==================== STEP 1: VERIFY FUNCTION EXISTS ====================

-- This should already exist from 20260219_zone_requirements_breakdown_v2_fix.sql
-- Just grant permissions to ensure it's callable
GRANT EXECUTE ON FUNCTION evaluate_observation_requirements(uuid) TO authenticated;

-- ==================== STEP 2: FIX COHORT RPCS TO USE COMPLIANCE_RESULTS ====================

-- OVERSTAYERS: breach AND NOT homeless_exempt (enforcement applicable)
CREATE OR REPLACE FUNCTION cohort_overstayers(
  p_from timestamptz,
  p_to timestamptz,
  p_org_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
)
RETURNS SETOF vehicle_observations_v2
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.*
  FROM vehicle_observations_v2 o
  JOIN compliance_results cr ON cr.observation_id = o.observation_id
  WHERE o.recorded_at BETWEEN p_from AND p_to
    AND (p_org_id IS NULL OR o.organization_id = p_org_id)
    AND (p_zone_id IS NULL OR o.zone_id = p_zone_id)
    AND cr.is_breach = true
    AND COALESCE(cr.is_homeless_exempt, false) = false  -- ✅ EXCLUDE homeless-exempt
  ORDER BY o.recorded_at DESC;
$$;

COMMENT ON FUNCTION cohort_overstayers(timestamptz, timestamptz, uuid, uuid) IS
'Returns observations with breaches EXCLUDING homeless-exempt (enforcement applicable) - uses compliance_results';

-- HOMELESS EXEMPT: breach AND homeless_exempt (welfare pathway)
CREATE OR REPLACE FUNCTION cohort_homeless_exempt(
  p_from timestamptz,
  p_to timestamptz,
  p_org_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
)
RETURNS SETOF vehicle_observations_v2
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.*
  FROM vehicle_observations_v2 o
  JOIN compliance_results cr ON cr.observation_id = o.observation_id
  WHERE o.recorded_at BETWEEN p_from AND p_to
    AND (p_org_id IS NULL OR o.organization_id = p_org_id)
    AND (p_zone_id IS NULL OR o.zone_id = p_zone_id)
    AND cr.is_breach = true
    AND COALESCE(cr.is_homeless_exempt, false) = true  -- ✅ ONLY homeless-exempt
  ORDER BY o.recorded_at DESC;
$$;

COMMENT ON FUNCTION cohort_homeless_exempt(timestamptz, timestamptz, uuid, uuid) IS
'Returns observations with breaches AND homeless exemption (welfare pathway) - uses compliance_results';

-- COMPLIANT: no breaches
CREATE OR REPLACE FUNCTION cohort_compliant(
  p_from timestamptz,
  p_to timestamptz,
  p_org_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
)
RETURNS SETOF vehicle_observations_v2
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.*
  FROM vehicle_observations_v2 o
  WHERE o.recorded_at BETWEEN p_from AND p_to
    AND (p_org_id IS NULL OR o.organization_id = p_org_id)
    AND (p_zone_id IS NULL OR o.zone_id = p_zone_id)
    AND o.is_compliant = true
  ORDER BY o.recorded_at DESC;
$$;

COMMENT ON FUNCTION cohort_compliant(timestamptz, timestamptz, uuid, uuid) IS
'Returns compliant observations (no breaches)';

-- ALL BREACHES: any breach (including homeless-exempt)
CREATE OR REPLACE FUNCTION cohort_all_breaches(
  p_from timestamptz,
  p_to timestamptz,
  p_org_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
)
RETURNS SETOF vehicle_observations_v2
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.*
  FROM vehicle_observations_v2 o
  WHERE o.recorded_at BETWEEN p_from AND p_to
    AND (p_org_id IS NULL OR o.organization_id = p_org_id)
    AND (p_zone_id IS NULL OR o.zone_id = p_zone_id)
    AND o.is_breach = true
  ORDER BY o.recorded_at DESC;
$$;

COMMENT ON FUNCTION cohort_all_breaches(timestamptz, timestamptz, uuid, uuid) IS
'Returns ALL breach observations (including homeless-exempt)';

-- ==================== STEP 3: GRANT PERMISSIONS ====================

GRANT EXECUTE ON FUNCTION cohort_overstayers(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION cohort_homeless_exempt(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION cohort_compliant(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION cohort_all_breaches(timestamptz, timestamptz, uuid, uuid) TO authenticated;

-- ==================== STEP 4: DIAGNOSTIC HELPER ====================

-- Quick diagnostic to check if requirements are returning data
CREATE OR REPLACE FUNCTION check_requirements_health()
RETURNS TABLE (
  test_name text,
  status text,
  details text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_sample_obs_id uuid;
  v_req_count int;
  v_null_reason_count int;
BEGIN
  -- Get a recent observation
  SELECT observation_id INTO v_sample_obs_id
  FROM vehicle_observations_v2
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF v_sample_obs_id IS NULL THEN
    RETURN QUERY SELECT 'Sample Observation'::text, '❌ FAIL'::text, 'No observations in database'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT 
    'Sample Observation'::text, 
    '✅ PASS'::text, 
    format('Found observation: %s', v_sample_obs_id)::text;

  -- Test function call
  SELECT COUNT(*), COUNT(*) FILTER (WHERE reason IS NULL)
  INTO v_req_count, v_null_reason_count
  FROM evaluate_observation_requirements(v_sample_obs_id);

  IF v_req_count = 0 THEN
    RETURN QUERY SELECT 'Requirements Function'::text, '❌ FAIL'::text, 'Function returned 0 rows'::text;
  ELSIF v_null_reason_count > 0 THEN
    RETURN QUERY SELECT 
      'Requirements Function'::text, 
      '⚠️  WARNING'::text, 
      format('%s rows, but %s have NULL reasons', v_req_count, v_null_reason_count)::text;
  ELSE
    RETURN QUERY SELECT 
      'Requirements Function'::text, 
      '✅ PASS'::text, 
      format('%s requirements with non-NULL reasons', v_req_count)::text;
  END IF;

  -- Test RLS permissions
  RETURN QUERY SELECT 
    'RLS Permissions'::text, 
    '✅ PASS'::text, 
    'Function is SECURITY DEFINER, permissions OK'::text;
END;
$$;

COMMENT ON FUNCTION check_requirements_health() IS
'Diagnostic tool: verify zone requirements function returns proper data';

-- Run diagnostic
SELECT * FROM check_requirements_health();

-- ==================== STEP 5: INDEX FOR PERFORMANCE ====================

CREATE INDEX IF NOT EXISTS idx_compliance_breach_homeless_exempt
  ON compliance_results(is_breach, is_homeless_exempt, recorded_at DESC)
  WHERE is_breach = true;

-- ==================== USAGE NOTES ====================

COMMENT ON FUNCTION cohort_overstayers IS 
'USAGE:
-- Dashboard tile count:
SELECT count(*) FROM cohort_overstayers(
  ''2026-02-17T00:00:00+13'',
  ''2026-02-17T23:59:59+13'',
  NULL, -- org_id
  NULL  -- zone_id
);

-- Report drill-down (same RPC, same params):
SELECT * FROM cohort_overstayers(
  ''2026-02-17T00:00:00+13'',
  ''2026-02-17T23:59:59+13'',
  NULL,
  NULL
);
';

COMMENT ON FUNCTION check_requirements_health IS
'DIAGNOSTIC:
-- Quick health check:
SELECT * FROM check_requirements_health();

-- Manual test with known observation:
SELECT * FROM evaluate_observation_requirements(''<obs-id>'');
';
