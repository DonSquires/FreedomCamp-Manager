-- =====================================================
-- ADJUST GPS MOVEMENT THRESHOLD TO 15 METERS
-- Migration Date: 2025-01-31
-- =====================================================
-- 
-- Changes GPS-verified consecutive stay detection threshold
-- from 5 meters to 15 meters to account for GPS accuracy variance.
--
-- RATIONALE:
-- - GPS accuracy can vary between 3-10m even when stationary
-- - 15m threshold provides better tolerance for GPS drift
-- - Still accurate enough to confirm vehicle hasn't moved location
-- - Reduces false negatives from GPS variance
-- =====================================================

-- =====================================================
-- 1. UPDATE calculate_vehicle_compliance() - Change 5m to 15m threshold
-- =====================================================

DROP FUNCTION IF EXISTS calculate_vehicle_compliance(TEXT, UUID, DATE);

CREATE OR REPLACE FUNCTION calculate_vehicle_compliance(
  p_plate_number TEXT,
  p_zone_id UUID,
  p_check_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  plate_number TEXT,
  zone_id UUID,
  check_date DATE,
  is_compliant BOOLEAN,
  violation_type TEXT,
  nights_stayed INTEGER,
  consecutive_nights INTEGER,
  gps_verified_consecutive_nights INTEGER,
  nights_limit INTEGER,
  consecutive_limit INTEGER,
  is_homeless_exempt BOOLEAN,
  self_contained_required BOOLEAN,
  is_self_contained BOOLEAN,
  day_visit_only BOOLEAN,
  after_hours_violation BOOLEAN,
  stay_confirmed_by_gps BOOLEAN,
  recommended_action TEXT,
  fine_amount NUMERIC,
  details JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_vehicle_id UUID;
  v_matrix RECORD;
  v_nights_this_month INTEGER := 0;
  v_consecutive_nights INTEGER := 0;
  v_gps_verified_consecutive_nights INTEGER := 0;
  v_is_homeless_exempt BOOLEAN := FALSE;
  v_is_self_contained BOOLEAN := FALSE;
  v_violation_type TEXT := NULL;
  v_is_compliant BOOLEAN := TRUE;
  v_fine_amount NUMERIC := 0;
  v_recommended_action TEXT := 'no_action';
  v_after_hours_violation BOOLEAN := FALSE;
  v_stay_confirmed_by_gps BOOLEAN := FALSE;
  v_last_observation RECORD;
  v_gps_evidence JSONB := '[]'::jsonb;
BEGIN
  -- Get canonical vehicle
  SELECT vehicle_id, is_homeless, homeless_confirmed
  INTO v_vehicle_id, v_is_homeless_exempt, v_is_homeless_exempt
  FROM canonical_vehicles
  WHERE canonical_vehicles.plate_number = p_plate_number;

  IF v_vehicle_id IS NULL THEN
    RAISE NOTICE 'Vehicle not found: %', p_plate_number;
    RETURN;
  END IF;

  -- Get active compliance matrix for zone
  SELECT *
  INTO v_matrix
  FROM zone_compliance_matrix
  WHERE zone_compliance_matrix.zone_id = p_zone_id
    AND effective_to IS NULL
  ORDER BY version DESC
  LIMIT 1;

  IF v_matrix IS NULL THEN
    RAISE NOTICE 'No active matrix for zone: %', p_zone_id;
    RETURN;
  END IF;

  -- Count nights this month (unique dates)
  SELECT COUNT(DISTINCT DATE(recorded_at))
  INTO v_nights_this_month
  FROM vehicle_observations
  WHERE vehicle_observations.vehicle_id = v_vehicle_id
    AND vehicle_observations.zone_id = p_zone_id
    AND DATE_TRUNC('month', recorded_at) = DATE_TRUNC('month', p_check_date::TIMESTAMPTZ);

  -- =====================================================
  -- ENHANCED: Calculate GPS-verified consecutive nights with 15-METER threshold
  -- This checks ALL consecutive observations to verify vehicle hasn't moved
  -- =====================================================
  
  WITH ordered_observations AS (
    -- Get all observations with GPS data, ordered by time
    SELECT 
      observation_id,
      recorded_at,
      DATE(recorded_at) as obs_date,
      gps_latitude,
      gps_longitude,
      LAG(gps_latitude) OVER (ORDER BY recorded_at) as prev_lat,
      LAG(gps_longitude) OVER (ORDER BY recorded_at) as prev_lng,
      LAG(recorded_at) OVER (ORDER BY recorded_at) as prev_recorded_at,
      ROW_NUMBER() OVER (ORDER BY recorded_at DESC) as row_num
    FROM vehicle_observations
    WHERE vehicle_id = v_vehicle_id
      AND zone_id = p_zone_id
      AND gps_latitude IS NOT NULL
      AND gps_longitude IS NOT NULL
      AND DATE(recorded_at) <= p_check_date
    ORDER BY recorded_at DESC
  ),
  gps_verified_stays AS (
    -- Check if each observation is within 15m of previous (stayed in place)
    SELECT 
      observation_id,
      obs_date,
      recorded_at,
      gps_latitude,
      gps_longitude,
      CASE 
        WHEN row_num = 1 THEN TRUE -- Most recent observation (always included)
        WHEN prev_lat IS NULL THEN TRUE -- First observation
        WHEN calculate_gps_distance(gps_latitude, gps_longitude, prev_lat, prev_lng) <= 15 
          AND (prev_recorded_at - recorded_at) <= INTERVAL '48 hours'
        THEN TRUE -- Vehicle hasn't moved (<15m) and within 48h window
        ELSE FALSE -- Vehicle moved or gap too large
      END as stayed_in_place,
      calculate_gps_distance(gps_latitude, gps_longitude, prev_lat, prev_lng) as distance_from_prev
    FROM ordered_observations
  ),
  consecutive_stay_groups AS (
    -- Create groups of consecutive same-location stays
    SELECT 
      observation_id,
      obs_date,
      recorded_at,
      gps_latitude,
      gps_longitude,
      stayed_in_place,
      distance_from_prev,
      -- When stayed_in_place = FALSE, start a new group
      SUM(CASE WHEN stayed_in_place = FALSE THEN 1 ELSE 0 END) 
        OVER (ORDER BY recorded_at DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as stay_group
    FROM gps_verified_stays
  ),
  current_consecutive_group AS (
    -- Get all observations in the current consecutive stay group (group 0)
    SELECT 
      obs_date,
      recorded_at,
      gps_latitude,
      gps_longitude,
      distance_from_prev
    FROM consecutive_stay_groups
    WHERE stay_group = 0 -- Current consecutive group (most recent)
      AND stayed_in_place = TRUE
    ORDER BY recorded_at DESC
  )
  -- Count unique dates in current consecutive group AND collect GPS evidence
  SELECT 
    COUNT(DISTINCT obs_date),
    jsonb_agg(
      jsonb_build_object(
        'date', obs_date,
        'recorded_at', recorded_at,
        'latitude', gps_latitude,
        'longitude', gps_longitude,
        'distance_from_previous_meters', ROUND(COALESCE(distance_from_prev, 0), 2)
      ) ORDER BY recorded_at
    )
  INTO v_gps_verified_consecutive_nights, v_gps_evidence
  FROM current_consecutive_group;

  -- Set default if no GPS data
  v_gps_verified_consecutive_nights := COALESCE(v_gps_verified_consecutive_nights, 0);
  v_gps_evidence := COALESCE(v_gps_evidence, '[]'::jsonb);

  -- OLD LOGIC: Calculate consecutive nights by date only (for comparison)
  WITH consecutive_dates AS (
    SELECT DISTINCT DATE(recorded_at) as obs_date
    FROM vehicle_observations
    WHERE vehicle_observations.vehicle_id = v_vehicle_id
      AND vehicle_observations.zone_id = p_zone_id
      AND DATE(recorded_at) <= p_check_date
    ORDER BY obs_date DESC
  ),
  date_gaps AS (
    SELECT 
      obs_date,
      obs_date - LAG(obs_date, 1, obs_date) OVER (ORDER BY obs_date DESC) as gap_days
    FROM consecutive_dates
  )
  SELECT COUNT(*)
  INTO v_consecutive_nights
  FROM date_gaps
  WHERE gap_days >= -1; -- Allow 1-day gaps

  -- Get most recent observation for this vehicle in this zone
  SELECT *
  INTO v_last_observation
  FROM vehicle_observations
  WHERE vehicle_observations.vehicle_id = v_vehicle_id
    AND vehicle_observations.zone_id = p_zone_id
    AND DATE(recorded_at) = p_check_date
  ORDER BY recorded_at DESC
  LIMIT 1;

  -- Get self-contained status from latest observation
  IF v_last_observation IS NOT NULL THEN
    v_is_self_contained := COALESCE(v_last_observation.is_self_contained, FALSE);
  END IF;

  -- =====================================================
  -- ENHANCED VIOLATION DETECTION with GPS-verified consecutive nights
  -- =====================================================

  -- Check 1: Time-based violation for day-visit-only zones
  IF v_matrix.day_visit_only = TRUE AND v_last_observation IS NOT NULL THEN
    IF EXTRACT(HOUR FROM v_last_observation.recorded_at) >= 21 OR EXTRACT(HOUR FROM v_last_observation.recorded_at) < 6 THEN
      v_after_hours_violation := TRUE;
      
      -- Use GPS-verified count for stronger enforcement
      IF v_gps_verified_consecutive_nights > 0 THEN
        v_stay_confirmed_by_gps := TRUE;
        v_violation_type := 'confirmed_stay_violation_gps_verified';
        v_is_compliant := FALSE;
        v_fine_amount := 200;
        v_recommended_action := 'issue_infringement';
      ELSE
        v_violation_type := 'possible_stay_violation';
        v_is_compliant := FALSE;
        v_fine_amount := 200;
        v_recommended_action := 'issue_warning';
      END IF;
    END IF;
  END IF;

  -- Check 2: Monthly limit exceeded
  IF v_nights_this_month > v_matrix.nights_per_month THEN
    IF v_violation_type IS NULL THEN
      v_violation_type := 'monthly_limit_exceeded';
      v_is_compliant := FALSE;
      v_fine_amount := 200;
      v_recommended_action := 'issue_infringement';
    END IF;
  END IF;

  -- Check 3: ENHANCED - GPS-verified consecutive nights exceeded (15m threshold)
  -- This is the CRITICAL improvement - uses GPS evidence, not just dates
  IF v_gps_verified_consecutive_nights > v_matrix.max_consecutive_nights THEN
    v_violation_type := 'consecutive_nights_exceeded_gps_verified';
    v_is_compliant := FALSE;
    v_fine_amount := 200;
    v_recommended_action := 'issue_infringement'; -- Stronger action (GPS proof)
    v_stay_confirmed_by_gps := TRUE;
    
    RAISE NOTICE 'GPS-VERIFIED BREACH: % consecutive nights (limit: %), evidence: %', 
      v_gps_verified_consecutive_nights, 
      v_matrix.max_consecutive_nights,
      v_gps_evidence;
  
  -- Fallback: If GPS data missing, use date-based count (weaker evidence)
  ELSIF v_consecutive_nights > v_matrix.max_consecutive_nights AND v_gps_verified_consecutive_nights = 0 THEN
    IF v_violation_type IS NULL THEN
      v_violation_type := 'consecutive_nights_exceeded_date_only';
      v_is_compliant := FALSE;
      v_fine_amount := 200;
      v_recommended_action := 'issue_warning'; -- Weaker action (no GPS proof)
      
      RAISE NOTICE 'DATE-ONLY BREACH: % consecutive nights (limit: %), NO GPS verification',
        v_consecutive_nights,
        v_matrix.max_consecutive_nights;
    END IF;
  END IF;

  -- Check 4: Self-contained requirement (CRITICAL for violators)
  IF v_matrix.self_contained_required = TRUE AND v_is_self_contained = FALSE THEN
    IF v_violation_type IS NOT NULL THEN
      v_violation_type := v_violation_type || '_not_self_contained';
      v_fine_amount := v_fine_amount + 200; -- Additional fine
      v_recommended_action := 'issue_infringement'; -- Escalate
    ELSE
      v_violation_type := 'not_self_contained';
      v_is_compliant := FALSE;
      v_fine_amount := 200;
      v_recommended_action := 'issue_warning';
    END IF;
  END IF;

  -- Apply homeless exemption
  IF v_is_homeless_exempt = TRUE AND v_matrix.homeless_exemption = TRUE THEN
    IF v_violation_type NOT LIKE '%not_self_contained%' THEN
      v_is_compliant := TRUE;
      v_violation_type := NULL;
      v_fine_amount := 0;
      v_recommended_action := 'no_action_homeless_exempt';
    ELSE
      v_recommended_action := 'issue_warning_homeless';
    END IF;
  END IF;

  -- Return compliance result with GPS evidence
  RETURN QUERY SELECT
    p_plate_number,
    p_zone_id,
    p_check_date,
    v_is_compliant,
    v_violation_type,
    v_nights_this_month,
    v_consecutive_nights, -- Date-based count (old logic)
    v_gps_verified_consecutive_nights, -- GPS-verified count (new logic)
    v_matrix.nights_per_month,
    v_matrix.max_consecutive_nights,
    v_is_homeless_exempt,
    v_matrix.self_contained_required,
    v_is_self_contained,
    v_matrix.day_visit_only,
    v_after_hours_violation,
    v_stay_confirmed_by_gps,
    v_recommended_action,
    v_fine_amount,
    jsonb_build_object(
      'matrix_version', v_matrix.version,
      'matrix_id', v_matrix.id,
      'check_timestamp', NOW(),
      'gps_evidence', v_gps_evidence,
      'gps_verified_count', v_gps_verified_consecutive_nights,
      'date_only_count', v_consecutive_nights,
      'gps_threshold_meters', 15,
      'enforcement_strength', CASE 
        WHEN v_gps_verified_consecutive_nights > 0 THEN 'strong_gps_verified'
        ELSE 'weak_date_only'
      END,
      'court_ready', v_gps_verified_consecutive_nights > 0,
      'calculation_method', 'gps_verified_consecutive_stays_v3_15m_threshold'
    );
END;
$$;

COMMENT ON FUNCTION calculate_vehicle_compliance IS 'ENHANCED compliance calculation with GPS-verified consecutive stay detection (15-meter threshold). Checks if vehicle stayed in same location (<15m movement) across ALL consecutive observations, providing better tolerance for GPS accuracy variance while maintaining enforcement integrity.';

-- =====================================================
-- 2. AUDIT LOG
-- =====================================================

INSERT INTO audit_log (
  action,
  entity_type,
  entity_id,
  new_values,
  created_at
) VALUES (
  'MIGRATION_APPLIED',
  'database',
  '20250131_adjust_gps_threshold_15m',
  jsonb_build_object(
    'description', 'Adjusted GPS movement threshold from 5m to 15m for consecutive stay detection',
    'rationale', jsonb_build_object(
      'reason', 'Account for GPS accuracy variance while maintaining enforcement integrity',
      'gps_accuracy_range', '3-10 meters even when stationary',
      'benefit', 'Reduces false negatives from GPS drift without compromising breach detection'
    ),
    'changes', jsonb_build_array(
      'Updated calculate_vehicle_compliance() to use 15-meter threshold (was 5 meters)',
      'Added gps_threshold_meters to returned details JSON for audit trail',
      'Updated calculation_method version to v3_15m_threshold'
    ),
    'impact', 'MEDIUM - More tolerant of GPS variance, maintains accuracy for breach detection'
  ),
  NOW()
);

-- =====================================================
-- END OF MIGRATION
-- =====================================================
