-- KPI Cohort RPCs - Single Source of Truth
-- Ensures dashboard counts and report drill-downs always match
-- Properly excludes homeless-exempt from overstayers/breaches

-- ==================== OVERSTAYERS COHORT ====================
-- Breach but NOT homeless exempt (enforcement applicable)

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
  WHERE o.recorded_at BETWEEN p_from AND p_to
    AND (p_org_id IS NULL OR o.organization_id = p_org_id)
    AND (p_zone_id IS NULL OR o.zone_id = p_zone_id)
    AND o.is_breach = true
    AND NOT EXISTS (
      SELECT 1 FROM canonical_vehicles cv
      WHERE cv.plate_number = o.plate_number
        AND cv.homeless_status = 'confirmed'
    )
  ORDER BY o.recorded_at DESC;
$$;

COMMENT ON FUNCTION cohort_overstayers(timestamptz, timestamptz, uuid, uuid) IS
'Returns observations with breaches EXCLUDING homeless-exempt vehicles (enforcement applicable)';

-- ==================== HOMELESS EXEMPT COHORT ====================
-- Breach AND homeless exempt (welfare pathway, not enforcement)

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
  JOIN canonical_vehicles cv ON cv.plate_number = o.plate_number
  WHERE o.recorded_at BETWEEN p_from AND p_to
    AND (p_org_id IS NULL OR o.organization_id = p_org_id)
    AND (p_zone_id IS NULL OR o.zone_id = p_zone_id)
    AND o.is_breach = true
    AND cv.homeless_status = 'confirmed'
  ORDER BY o.recorded_at DESC;
$$;

COMMENT ON FUNCTION cohort_homeless_exempt(timestamptz, timestamptz, uuid, uuid) IS
'Returns observations with breaches AND confirmed homeless status (welfare pathway)';

-- ==================== COMPLIANT COHORT ====================
-- No breaches detected

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
'Returns observations with no breaches detected';

-- ==================== ALL BREACHES COHORT ====================
-- Any breach (including homeless-exempt) - for total breach count

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

-- ==================== PERFORMANCE INDEX ====================

CREATE INDEX IF NOT EXISTS idx_obs_breach_homeless_date_org
  ON vehicle_observations_v2 (is_breach, is_compliant, organization_id, zone_id, recorded_at DESC)
  WHERE is_breach = true OR is_compliant = true;

-- ==================== GRANTS ====================

GRANT EXECUTE ON FUNCTION cohort_overstayers(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION cohort_homeless_exempt(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION cohort_compliant(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION cohort_all_breaches(timestamptz, timestamptz, uuid, uuid) TO authenticated;
