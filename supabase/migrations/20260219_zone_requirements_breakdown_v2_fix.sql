-- Zone Requirements Breakdown FIX
-- Fixes NULL reason bug - properly extracts data from joined records

-- ==================== FIXED EVALUATION FUNCTION ====================

CREATE OR REPLACE FUNCTION evaluate_observation_requirements(p_obs_id uuid)
RETURNS TABLE (
  observation_id uuid,
  requirement_code text,
  requirement_label text,
  status text,
  reason text,
  sort_order int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plate_number text;
  v_zone_id uuid;
  v_recorded_at timestamptz;
  v_homeless_status text;
  v_is_homeless boolean := false;
  v_consecutive_nights int := 0;
  v_monthly_stays int := 0;
  v_requires_csc boolean := true;
  v_vehicle_has_csc boolean := false;
  v_csc_warrant text;
  v_csc_expiry date;
  v_max_consecutive int := 3;
  v_max_monthly int := 28;
BEGIN
  -- Pull observation data
  SELECT 
    o.plate_number,
    o.zone_id,
    o.recorded_at
  INTO 
    v_plate_number,
    v_zone_id,
    v_recorded_at
  FROM vehicle_observations_v2 o
  WHERE o.observation_id = p_obs_id;

  IF NOT FOUND THEN
    RAISE NOTICE 'Observation % not found', p_obs_id;
    RETURN;
  END IF;

  -- Get zone compliance rules
  SELECT 
    COALESCE(requires_csc, true),
    COALESCE(max_consecutive_nights, 3),
    COALESCE(nights_per_month, 28)
  INTO 
    v_requires_csc,
    v_max_consecutive,
    v_max_monthly
  FROM zone_compliance_matrix
  WHERE zone_id = v_zone_id 
    AND effective_to IS NULL
  LIMIT 1;

  -- Get vehicle data
  SELECT 
    COALESCE(homeless_status, 'none'),
    nzscv_warrant_type,
    nzscv_warrant_expires_on
  INTO 
    v_homeless_status,
    v_csc_warrant,
    v_csc_expiry
  FROM canonical_vehicles
  WHERE plate_number = v_plate_number;

  -- Derive flags
  v_is_homeless := (v_homeless_status = 'confirmed');
  v_vehicle_has_csc := (v_csc_warrant IS NOT NULL) AND (v_csc_expiry IS NULL OR v_csc_expiry >= current_date);

  -- Get monthly stays for this vehicle in this zone
  SELECT 
    COALESCE(SUM(nights_stayed), 0),
    COALESCE(MAX(consecutive_nights), 0)
  INTO 
    v_monthly_stays,
    v_consecutive_nights
  FROM vehicle_monthly_stays
  WHERE plate_number = v_plate_number
    AND zone_id = v_zone_id
    AND calendar_month = date_trunc('month', v_recorded_at::date)::date;

  RAISE NOTICE 'Debug: plate=%, homeless=%, consecutive=%/%, monthly=%/%, csc=%', 
    v_plate_number, v_is_homeless, v_consecutive_nights, v_max_consecutive, v_monthly_stays, v_max_monthly, v_vehicle_has_csc;

  -- ==================== REQUIREMENT 1: SELF-CONTAINED VEHICLE ====================
  RETURN QUERY
  SELECT 
    p_obs_id,
    'csc_required'::text,
    'Self-contained vehicle required'::text,
    CASE
      WHEN NOT v_requires_csc THEN 'yes'::text
      WHEN v_requires_csc AND v_vehicle_has_csc THEN 'yes'::text
      WHEN v_requires_csc AND NOT v_vehicle_has_csc AND v_is_homeless THEN 'breach_exempt'::text
      ELSE 'breach'::text
    END,
    CASE
      WHEN NOT v_requires_csc THEN 'Zone allows non-CSC vehicles'::text
      WHEN v_requires_csc AND v_vehicle_has_csc THEN 
        format('CSC %s (expires %s)', 
          COALESCE(v_csc_warrant, 'Unknown'), 
          COALESCE(v_csc_expiry::text, 'No expiry'))
      WHEN v_requires_csc AND NOT v_vehicle_has_csc AND v_is_homeless THEN 
        'CSC required but not held; homeless exemption applies (welfare pathway)'::text
      ELSE 'CSC required by zone bylaw; no current certification found'::text
    END,
    10;

  -- ==================== REQUIREMENT 2: MAX CONSECUTIVE NIGHTS ====================
  RETURN QUERY
  SELECT 
    p_obs_id,
    'max_nights'::text,
    'Maximum consecutive nights'::text,
    CASE
      WHEN v_consecutive_nights <= v_max_consecutive THEN 'yes'::text
      WHEN v_consecutive_nights > v_max_consecutive AND v_is_homeless THEN 'breach_exempt'::text
      ELSE 'breach'::text
    END,
    CASE
      WHEN v_consecutive_nights <= v_max_consecutive THEN 
        format('%s/%s consecutive nights (compliant)', v_consecutive_nights, v_max_consecutive)
      WHEN v_consecutive_nights > v_max_consecutive AND v_is_homeless THEN 
        format('%s/%s consecutive nights; breach in principle but homeless exemption applies', 
          v_consecutive_nights, v_max_consecutive)
      ELSE 
        format('%s/%s consecutive nights (limit exceeded - infringement applicable)', 
          v_consecutive_nights, v_max_consecutive)
    END,
    20;

  -- ==================== REQUIREMENT 3: MONTHLY STAYS LIMIT ====================
  RETURN QUERY
  SELECT 
    p_obs_id,
    'monthly_limit'::text,
    'Monthly stays limit'::text,
    CASE
      WHEN v_monthly_stays <= v_max_monthly THEN 'yes'::text
      WHEN v_monthly_stays > v_max_monthly AND v_is_homeless THEN 'breach_exempt'::text
      ELSE 'breach'::text
    END,
    CASE
      WHEN v_monthly_stays <= v_max_monthly THEN 
        format('%s/%s nights this month (compliant)', v_monthly_stays, v_max_monthly)
      WHEN v_monthly_stays > v_max_monthly AND v_is_homeless THEN 
        format('%s/%s nights this month; breach in principle but homeless exemption applies', 
          v_monthly_stays, v_max_monthly)
      ELSE 
        format('%s/%s nights this month (limit exceeded - infringement applicable)', 
          v_monthly_stays, v_max_monthly)
    END,
    30;

END;
$$;

COMMENT ON FUNCTION evaluate_observation_requirements(uuid) IS 
'Returns requirement-by-requirement breakdown with detailed reasons (FIXED: proper variable extraction)';

-- ==================== REFRESH VIEW ====================

-- Drop and recreate to pick up new function
DROP VIEW IF EXISTS observation_requirements CASCADE;

CREATE VIEW observation_requirements AS
SELECT 
  (r).observation_id,
  (r).requirement_code,
  (r).requirement_label,
  (r).status,
  (r).reason,
  (r).sort_order
FROM (
  SELECT evaluate_observation_requirements(o.observation_id) as r
  FROM vehicle_observations_v2 o
) t;

COMMENT ON VIEW observation_requirements IS 
'Fast read model for zone requirements checklist (FIXED: NULL reasons resolved)';

-- Recreate RLS policy
DROP POLICY IF EXISTS users_view_observation_requirements ON observation_requirements;

CREATE POLICY users_view_observation_requirements
  ON observation_requirements
  FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master') OR
    (EXISTS (
      SELECT 1 FROM vehicle_observations_v2 o
      WHERE o.observation_id = observation_requirements.observation_id
        AND o.organization_id = ANY(get_user_organization_ids())
    ))
  );

-- Grant permissions
GRANT EXECUTE ON FUNCTION evaluate_observation_requirements(uuid) TO authenticated;
GRANT SELECT ON observation_requirements TO authenticated;
