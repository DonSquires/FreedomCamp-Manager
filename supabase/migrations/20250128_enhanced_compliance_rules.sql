-- =====================================================
-- ENHANCED COMPLIANCE RULES - Time & GPS-Based Violations
-- Migration Date: 2025-01-28
-- =====================================================
-- 
-- This migration enhances the compliance calculation system to include:
-- 1. Time-based violations for day-visit-only zones (after 21:00)
-- 2. GPS-based stay confirmation (vehicle hasn't moved)
-- 3. Self-contained requirement for violators
-- 
-- Key Changes:
-- - Enhanced calculate_vehicle_compliance() function with time/GPS checks
-- - New violation_reasons types: 'possible_stay_violation', 'confirmed_stay_violation', 'not_self_contained'
-- - GPS distance calculation for movement detection (5-meter threshold)
-- =====================================================

-- 1. DROP AND RECREATE calculate_vehicle_compliance() with enhanced logic
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
  v_is_homeless_exempt BOOLEAN := FALSE;
  v_is_self_contained BOOLEAN := FALSE;
  v_violation_type TEXT := NULL;
  v_is_compliant BOOLEAN := TRUE;
  v_fine_amount NUMERIC := 0;
  v_recommended_action TEXT := 'no_action';
  v_after_hours_violation BOOLEAN := FALSE;
  v_stay_confirmed_by_gps BOOLEAN := FALSE;
  v_last_observation RECORD;
  v_previous_observation RECORD;
  v_gps_distance NUMERIC;
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

  -- Calculate consecutive nights (looking back from check_date)
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
  -- ENHANCED VIOLATION DETECTION
  -- =====================================================

  -- Check 1: Time-based violation for day-visit-only zones
  IF v_matrix.day_visit_only = TRUE AND v_last_observation IS NOT NULL THEN
    -- Extract hour from observation timestamp
    IF EXTRACT(HOUR FROM v_last_observation.recorded_at) >= 21 OR EXTRACT(HOUR FROM v_last_observation.recorded_at) < 6 THEN
      v_after_hours_violation := TRUE;
      
      -- Determine if possible or confirmed stay violation
      IF v_nights_this_month >= v_matrix.nights_per_month OR v_consecutive_nights >= v_matrix.max_consecutive_nights THEN
        v_violation_type := 'possible_zone_violation';
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

  -- Check 2: GPS-based stay confirmation (vehicle hasn't moved)
  IF v_after_hours_violation = TRUE AND v_last_observation.gps_latitude IS NOT NULL AND v_last_observation.gps_longitude IS NOT NULL THEN
    -- Get previous observation in same zone
    SELECT *
    INTO v_previous_observation
    FROM vehicle_observations
    WHERE vehicle_observations.vehicle_id = v_vehicle_id
      AND vehicle_observations.zone_id = p_zone_id
      AND vehicle_observations.observation_id != v_last_observation.observation_id
      AND gps_latitude IS NOT NULL
      AND gps_longitude IS NOT NULL
    ORDER BY recorded_at DESC
    LIMIT 1;

    IF v_previous_observation IS NOT NULL THEN
      -- Calculate GPS distance using haversine formula
      SELECT calculate_gps_distance(
        v_last_observation.gps_latitude,
        v_last_observation.gps_longitude,
        v_previous_observation.gps_latitude,
        v_previous_observation.gps_longitude
      ) INTO v_gps_distance;

      -- If vehicle hasn't moved more than 5 meters, confirm stay violation
      IF v_gps_distance <= 5 THEN
        v_stay_confirmed_by_gps := TRUE;
        v_violation_type := 'confirmed_stay_violation';
        v_is_compliant := FALSE;
        v_fine_amount := 200;
        v_recommended_action := 'issue_infringement';
      END IF;
    END IF;
  END IF;

  -- Check 3: Monthly limit exceeded
  IF v_nights_this_month > v_matrix.nights_per_month THEN
    IF v_violation_type IS NULL THEN
      v_violation_type := 'monthly_limit_exceeded';
      v_is_compliant := FALSE;
      v_fine_amount := 200;
      v_recommended_action := 'issue_infringement';
    END IF;
  END IF;

  -- Check 4: Consecutive nights exceeded
  IF v_consecutive_nights > v_matrix.max_consecutive_nights THEN
    IF v_violation_type IS NULL THEN
      v_violation_type := 'consecutive_nights_exceeded';
      v_is_compliant := FALSE;
      v_fine_amount := 200;
      v_recommended_action := 'issue_warning';
    END IF;
  END IF;

  -- Check 5: Self-contained requirement (CRITICAL for violators)
  -- Vehicles that violate or possibly violate day visits MUST be self-contained
  IF v_matrix.self_contained_required = TRUE AND v_is_self_contained = FALSE THEN
    -- If already violating, add to violation type
    IF v_violation_type IS NOT NULL THEN
      v_violation_type := v_violation_type || '_not_self_contained';
      v_fine_amount := v_fine_amount + 200; -- Additional fine
      v_recommended_action := 'issue_infringement'; -- Escalate to infringement
    ELSE
      -- Self-contained violation alone
      v_violation_type := 'not_self_contained';
      v_is_compliant := FALSE;
      v_fine_amount := 200;
      v_recommended_action := 'issue_warning';
    END IF;
  END IF;

  -- Apply homeless exemption (overrides all violations except self-contained in violation scenarios)
  IF v_is_homeless_exempt = TRUE AND v_matrix.homeless_exemption = TRUE THEN
    -- Homeless vehicles are exempt from stay/time violations but still need to be self-contained if violating
    IF v_violation_type NOT LIKE '%not_self_contained%' THEN
      v_is_compliant := TRUE;
      v_violation_type := NULL;
      v_fine_amount := 0;
      v_recommended_action := 'no_action_homeless_exempt';
    ELSE
      -- Still non-compliant if not self-contained while violating
      v_recommended_action := 'issue_warning_homeless';
    END IF;
  END IF;

  -- Return compliance result
  RETURN QUERY SELECT
    p_plate_number,
    p_zone_id,
    p_check_date,
    v_is_compliant,
    v_violation_type,
    v_nights_this_month,
    v_consecutive_nights,
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
      'gps_distance_meters', v_gps_distance,
      'last_observation_time', v_last_observation.recorded_at,
      'previous_observation_time', v_previous_observation.recorded_at,
      'calculation_method', 'enhanced_time_gps_based'
    );
END;
$$;

COMMENT ON FUNCTION calculate_vehicle_compliance IS 'Enhanced compliance calculation with time-based and GPS-based violation detection. Checks if vehicle observed after 21:00 in day-visit-only zones, confirms stay violations via GPS location comparison (<5m = stayed), and enforces self-contained requirements for all violators.';

-- =====================================================
-- 2. UPDATE compliance_results table to support new violation types
-- =====================================================

-- Add new columns if they don't exist
ALTER TABLE compliance_results 
ADD COLUMN IF NOT EXISTS after_hours_violation BOOLEAN DEFAULT FALSE;

ALTER TABLE compliance_results 
ADD COLUMN IF NOT EXISTS stay_confirmed_by_gps BOOLEAN DEFAULT FALSE;

ALTER TABLE compliance_results 
ADD COLUMN IF NOT EXISTS gps_distance_meters NUMERIC(10, 2);

COMMENT ON COLUMN compliance_results.after_hours_violation IS 'Vehicle observed after 21:00 in day-visit-only zone';
COMMENT ON COLUMN compliance_results.stay_confirmed_by_gps IS 'Stay violation confirmed by GPS location comparison (<5m movement)';
COMMENT ON COLUMN compliance_results.gps_distance_meters IS 'Distance in meters between current and previous observation GPS coordinates';

-- =====================================================
-- 3. CREATE helper function to recalculate compliance for observation
-- =====================================================

CREATE OR REPLACE FUNCTION recalculate_observation_compliance(p_observation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_observation RECORD;
  v_compliance RECORD;
  v_matrix RECORD;
BEGIN
  -- Get observation details
  SELECT 
    vo.observation_id,
    vo.vehicle_id,
    vo.zone_id,
    vo.organization_id,
    DATE(vo.recorded_at) as obs_date,
    cv.plate_number
  INTO v_observation
  FROM vehicle_observations vo
  JOIN canonical_vehicles cv ON cv.vehicle_id = vo.vehicle_id
  WHERE vo.observation_id = p_observation_id;

  IF v_observation IS NULL THEN
    RAISE NOTICE 'Observation not found: %', p_observation_id;
    RETURN;
  END IF;

  -- Get active matrix
  SELECT *
  INTO v_matrix
  FROM zone_compliance_matrix
  WHERE zone_id = v_observation.zone_id
    AND effective_to IS NULL
  ORDER BY version DESC
  LIMIT 1;

  IF v_matrix IS NULL THEN
    RAISE NOTICE 'No active matrix for zone: %', v_observation.zone_id;
    RETURN;
  END IF;

  -- Calculate compliance
  SELECT *
  INTO v_compliance
  FROM calculate_vehicle_compliance(
    v_observation.plate_number,
    v_observation.zone_id,
    v_observation.obs_date
  );

  -- Upsert compliance result
  INSERT INTO compliance_results (
    observation_id,
    vehicle_id,
    zone_id,
    organization_id,
    matrix_id,
    matrix_version,
    is_compliant,
    violation_reasons,
    metrics_json,
    matrix_snapshot,
    after_hours_violation,
    stay_confirmed_by_gps,
    gps_distance_meters,
    evaluated_at
  ) VALUES (
    v_observation.observation_id,
    v_observation.vehicle_id,
    v_observation.zone_id,
    v_observation.organization_id,
    v_matrix.id,
    v_matrix.version,
    v_compliance.is_compliant,
    CASE 
      WHEN v_compliance.violation_type IS NOT NULL 
      THEN ARRAY[v_compliance.violation_type]::TEXT[]
      ELSE ARRAY[]::TEXT[]
    END,
    v_compliance.details,
    jsonb_build_object(
      'matrix_id', v_matrix.id,
      'version', v_matrix.version,
      'effective_from', v_matrix.effective_from,
      'self_contained_required', v_matrix.self_contained_required,
      'nights_per_month', v_matrix.nights_per_month,
      'max_consecutive_nights', v_matrix.max_consecutive_nights,
      'day_visit_only', v_matrix.day_visit_only,
      'allowed_days', v_matrix.allowed_days,
      'homeless_exemption', v_matrix.homeless_exemption
    ),
    v_compliance.after_hours_violation,
    v_compliance.stay_confirmed_by_gps,
    (v_compliance.details->>'gps_distance_meters')::NUMERIC,
    NOW()
  )
  ON CONFLICT (observation_id, matrix_id) 
  DO UPDATE SET
    is_compliant = EXCLUDED.is_compliant,
    violation_reasons = EXCLUDED.violation_reasons,
    metrics_json = EXCLUDED.metrics_json,
    after_hours_violation = EXCLUDED.after_hours_violation,
    stay_confirmed_by_gps = EXCLUDED.stay_confirmed_by_gps,
    gps_distance_meters = EXCLUDED.gps_distance_meters,
    evaluated_at = EXCLUDED.evaluated_at;

  RAISE NOTICE 'Recalculated compliance for observation %: %', p_observation_id, v_compliance.is_compliant;
END;
$$;

COMMENT ON FUNCTION recalculate_observation_compliance IS 'Recalculates compliance for a single observation using enhanced time/GPS-based rules';

-- =====================================================
-- 4. CREATE trigger to auto-recalculate on observation insert/update
-- =====================================================

CREATE OR REPLACE FUNCTION trigger_recalculate_compliance_on_observation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Recalculate compliance after insert/update
  PERFORM recalculate_observation_compliance(NEW.observation_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_recalculate_compliance ON vehicle_observations;

CREATE TRIGGER auto_recalculate_compliance
AFTER INSERT OR UPDATE ON vehicle_observations
FOR EACH ROW
EXECUTE FUNCTION trigger_recalculate_compliance_on_observation();

COMMENT ON TRIGGER auto_recalculate_compliance ON vehicle_observations IS 'Automatically recalculates compliance using enhanced rules when observation is created or updated';

-- =====================================================
-- 5. AUDIT LOG
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
  '20250128_enhanced_compliance_rules',
  jsonb_build_object(
    'description', 'Enhanced compliance rules with time-based and GPS-based violation detection',
    'changes', jsonb_build_array(
      'Enhanced calculate_vehicle_compliance() with time checks (after 21:00)',
      'Added GPS-based stay confirmation (<5m movement threshold)',
      'Enforced self-contained requirement for all violators',
      'Added new violation types: possible_stay_violation, confirmed_stay_violation, not_self_contained',
      'Added compliance_results columns: after_hours_violation, stay_confirmed_by_gps, gps_distance_meters',
      'Created recalculate_observation_compliance() helper function',
      'Created auto_recalculate_compliance trigger for observations'
    )
  ),
  NOW()
);

-- =====================================================
-- END OF MIGRATION
-- =====================================================
