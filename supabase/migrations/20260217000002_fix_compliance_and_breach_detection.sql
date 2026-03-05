-- =========================================
-- CRITICAL FIX: Compliance Checking & Breach Detection
-- Date: 2026-02-17
-- Issue: All scans showing 100% compliant - compliance logic broken
-- =========================================

-- STEP 1: Create comprehensive compliance checking function
-- This function properly validates MONTHLY STAYS, CONSECUTIVE STAYS, DAY-VISIT-ONLY, and AT-RISK status
CREATE OR REPLACE FUNCTION calculate_vehicle_compliance_v3(
  p_plate_number TEXT,
  p_zone_id UUID,
  p_check_date DATE DEFAULT CURRENT_DATE,
  p_observation_id UUID DEFAULT NULL,
  p_observation_time TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  is_compliant BOOLEAN,
  at_risk BOOLEAN,
  breach_type TEXT,
  violation_reasons TEXT[],
  nights_stayed INTEGER,
  nights_allowed INTEGER,
  consecutive_nights INTEGER,
  consecutive_allowed INTEGER,
  is_overnight_stay BOOLEAN,
  is_day_visit_only_zone BOOLEAN,
  is_homeless_exempt BOOLEAN,
  matrix_snapshot JSONB
) 
LANGUAGE plpgsql
AS $$
DECLARE
  v_matrix RECORD;
  v_monthly_stay RECORD;
  v_is_homeless BOOLEAN := FALSE;
  v_is_overnight BOOLEAN := FALSE;
  v_violations TEXT[] := ARRAY[]::TEXT[];
  v_compliant BOOLEAN := TRUE;
  v_at_risk BOOLEAN := FALSE;
  v_breach_type TEXT := NULL;
  v_observation_hour INT;
BEGIN
  -- Get active compliance matrix for this zone
  SELECT * INTO v_matrix
  FROM zone_compliance_matrix
  WHERE zone_id = p_zone_id
    AND effective_from <= p_observation_time
    AND (effective_to IS NULL OR effective_to > p_observation_time)
  ORDER BY version DESC
  LIMIT 1;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No compliance matrix found for zone %', p_zone_id;
  END IF;
  
  -- Check if vehicle is homeless (FC Act exempt)
  SELECT (homeless_status = 'confirmed') INTO v_is_homeless
  FROM canonical_vehicles
  WHERE plate_number = p_plate_number;
  
  IF NOT FOUND THEN
    v_is_homeless := FALSE;
  END IF;
  
  -- Determine if this is an overnight stay based on NZ time (8pm-8am)
  v_observation_hour := EXTRACT(HOUR FROM p_observation_time AT TIME ZONE 'Pacific/Auckland');
  v_is_overnight := (v_observation_hour >= 20 OR v_observation_hour < 8);
  
  -- =========================================
  -- CRITICAL CHECK 1: DAY-VISIT-ONLY ZONES
  -- =========================================
  IF v_matrix.day_visit_only = TRUE THEN
    IF v_is_overnight THEN
      -- Any nighttime observation (8pm-8am) in day-visit-only zone = IMMEDIATE BREACH
      v_compliant := FALSE;
      v_at_risk := TRUE; -- Also flag as at-risk
      v_breach_type := 'day_visit_only_violation';
      v_violations := array_append(v_violations, 
        'NIGHT VISIT IN DAY-ONLY ZONE: Vehicle observed at ' || 
        TO_CHAR(p_observation_time AT TIME ZONE 'Pacific/Auckland', 'HH24:MI') ||
        ' NZ time. This zone prohibits overnight stays (8pm-8am).'
      );
      
      RAISE NOTICE 'DAY-VISIT-ONLY BREACH: % observed at night (% NZ time) in day-only zone', 
        p_plate_number, v_observation_hour;
    END IF;
    
    -- Skip other checks for day-visit-only zones
    RETURN QUERY SELECT 
      v_compliant,
      v_at_risk,
      v_breach_type,
      v_violations,
      0, -- nights_stayed
      0, -- nights_allowed  
      0, -- consecutive_nights
      0, -- consecutive_allowed
      v_is_overnight,
      TRUE, -- is_day_visit_only_zone
      v_is_homeless,
      jsonb_build_object(
        'zone_id', p_zone_id,
        'day_visit_only', v_matrix.day_visit_only,
        'homeless_exemption', v_matrix.homeless_exemption
      );
    RETURN;
  END IF;
  
  -- =========================================
  -- CRITICAL CHECK 2: MONTHLY STAY LIMITS
  -- =========================================
  SELECT * INTO v_monthly_stay
  FROM vehicle_monthly_stays
  WHERE plate_number = p_plate_number
    AND zone_id = p_zone_id
    AND calendar_month = DATE_TRUNC('month', p_check_date)::DATE;
  
  IF FOUND THEN
    -- Check if EXCEEDS monthly limit
    IF v_monthly_stay.nights_stayed > v_matrix.nights_per_month THEN
      v_compliant := FALSE;
      v_breach_type := 'monthly_limit_exceeded';
      v_violations := array_append(v_violations,
        'MONTHLY LIMIT EXCEEDED: ' || v_monthly_stay.nights_stayed || ' nights stayed this month (limit: ' || v_matrix.nights_per_month || ' nights)'
      );
      
      RAISE NOTICE 'MONTHLY BREACH: % has % nights (max %), 
        p_plate_number, v_monthly_stay.nights_stayed, v_matrix.nights_per_month;
    
    -- Check if AT MONTHLY LIMIT (will breach if stays tonight)
    ELSIF v_monthly_stay.nights_stayed >= v_matrix.nights_per_month THEN
      v_at_risk := TRUE;
      v_violations := array_append(v_violations,
        'AT RISK: Vehicle at monthly limit (' || v_monthly_stay.nights_stayed || '/' || v_matrix.nights_per_month || ' nights). One more overnight stay will trigger breach.'
      );
      
      RAISE NOTICE 'MONTHLY AT RISK: % at %/% nights',
        p_plate_number, v_monthly_stay.nights_stayed, v_matrix.nights_per_month;
    
    -- Check if APPROACHING monthly limit (1-2 nights away)
    ELSIF v_monthly_stay.nights_stayed >= (v_matrix.nights_per_month - 2) THEN
      v_at_risk := TRUE;
      v_violations := array_append(v_violations,
        'APPROACHING MONTHLY LIMIT: ' || v_monthly_stay.nights_stayed || '/' || v_matrix.nights_per_month || ' nights used this month. ' || (v_matrix.nights_per_month - v_monthly_stay.nights_stayed) || ' nights remaining.'
      );
    END IF;
    
    -- =========================================
    -- CRITICAL CHECK 3: CONSECUTIVE STAY LIMITS
    -- =========================================
    IF v_monthly_stay.consecutive_nights > v_matrix.max_consecutive_nights THEN
      v_compliant := FALSE;
      v_breach_type := COALESCE(v_breach_type, 'consecutive_limit_exceeded');
      v_violations := array_append(v_violations,
        'CONSECUTIVE LIMIT EXCEEDED: ' || v_monthly_stay.consecutive_nights || ' consecutive nights (limit: ' || v_matrix.max_consecutive_nights || ' nights)'
      );
      
      RAISE NOTICE 'CONSECUTIVE BREACH: % has % consecutive nights (max %)',
        p_plate_number, v_monthly_stay.consecutive_nights, v_matrix.max_consecutive_nights;
    
    -- Check if AT consecutive limit
    ELSIF v_monthly_stay.consecutive_nights >= v_matrix.max_consecutive_nights THEN
      v_at_risk := TRUE;
      v_violations := array_append(v_violations,
        'AT RISK: Vehicle at consecutive night limit (' || v_monthly_stay.consecutive_nights || '/' || v_matrix.max_consecutive_nights || '). Must leave tonight or face breach.'
      );
      
      RAISE NOTICE 'CONSECUTIVE AT RISK: % at %/% consecutive',
        p_plate_number, v_monthly_stay.consecutive_nights, v_matrix.max_consecutive_nights;
    
    -- Check if APPROACHING consecutive limit
    ELSIF v_monthly_stay.consecutive_nights >= (v_matrix.max_consecutive_nights - 1) THEN
      v_at_risk := TRUE;
      v_violations := array_append(v_violations,
        'APPROACHING CONSECUTIVE LIMIT: ' || v_monthly_stay.consecutive_nights || '/' || v_matrix.max_consecutive_nights || ' consecutive nights. ' || (v_matrix.max_consecutive_nights - v_monthly_stay.consecutive_nights) || ' more allowed.'
      );
    END IF;
  END IF;
  
  -- =========================================
  -- RETURN COMPREHENSIVE RESULTS
  -- =========================================
  RETURN QUERY SELECT
    v_compliant,
    v_at_risk,
    v_breach_type,
    v_violations,
    COALESCE(v_monthly_stay.nights_stayed, 0),
    v_matrix.nights_per_month,
    COALESCE(v_monthly_stay.consecutive_nights, 0),
    v_matrix.max_consecutive_nights,
    v_is_overnight,
    v_matrix.day_visit_only,
    v_is_homeless,
    jsonb_build_object(
      'zone_id', p_zone_id,
      'matrix_id', v_matrix.id,
      'matrix_version', v_matrix.version,
      'self_contained_required', v_matrix.self_contained_required,
      'nights_per_month', v_matrix.nights_per_month,
      'max_consecutive_nights', v_matrix.max_consecutive_nights,
      'day_visit_only', v_matrix.day_visit_only,
      'homeless_exemption', v_matrix.homeless_exemption,
      'allowed_days', v_matrix.allowed_days
    );
END;
$$;

-- STEP 2: Create function to populate compliance_results AND create breach alerts
CREATE OR REPLACE FUNCTION auto_evaluate_compliance_and_create_breach(
  p_observation_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_obs RECORD;
  v_compliance RECORD;
  v_org RECORD;
  v_breach_exists BOOLEAN;
BEGIN
  -- Get observation details
  SELECT * INTO v_obs
  FROM vehicle_observations_v2
  WHERE observation_id = p_observation_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Observation not found: %', p_observation_id;
  END IF;
  
  -- Get organization details (for enforcement workflow)
  SELECT * INTO v_org
  FROM organizations
  WHERE id = v_obs.organization_id;
  
  -- Run compliance check
  SELECT * INTO v_compliance
  FROM calculate_vehicle_compliance_v3(
    v_obs.plate_number,
    v_obs.zone_id,
    v_obs.recorded_at::DATE,
    p_observation_id,
    v_obs.recorded_at
  );
  
  -- Insert/update compliance_results
  INSERT INTO compliance_results (
    observation_id,
    vehicle_id, -- Will need to join canonical_vehicles
    zone_id,
    organization_id,
    matrix_id,
    matrix_version,
    is_compliant,
    violation_reasons,
    metrics_json,
    matrix_snapshot,
    evaluated_at,
    after_hours_violation
  )
  SELECT
    p_observation_id,
    (SELECT vehicle_id FROM canonical_vehicles WHERE plate_number = v_obs.plate_number), -- Compatibility with old schema
    v_obs.zone_id,
    v_obs.organization_id,
    (v_compliance.matrix_snapshot->>'matrix_id')::UUID,
    (v_compliance.matrix_snapshot->>'matrix_version')::INT,
    v_compliance.is_compliant,
    v_compliance.violation_reasons,
    jsonb_build_object(
      'nights_stayed', v_compliance.nights_stayed,
      'nights_allowed', v_compliance.nights_allowed,
      'consecutive_nights', v_compliance.consecutive_nights,
      'consecutive_allowed', v_compliance.consecutive_allowed,
      'at_risk', v_compliance.at_risk,
      'breach_type', v_compliance.breach_type,
      'is_overnight_stay', v_compliance.is_overnight_stay,
      'is_homeless_exempt', v_compliance.is_homeless_exempt
    ),
    v_compliance.matrix_snapshot,
    NOW(),
    v_compliance.is_overnight_stay AND v_compliance.is_day_visit_only_zone
  ON CONFLICT (observation_id, matrix_id) DO UPDATE SET
    is_compliant = EXCLUDED.is_compliant,
    violation_reasons = EXCLUDED.violation_reasons,
    metrics_json = EXCLUDED.metrics_json,
    evaluated_at = EXCLUDED.evaluated_at;
  
  -- If NOT compliant and NOT homeless exempt, create breach alert
  IF NOT v_compliance.is_compliant AND NOT v_compliance.is_homeless_exempt THEN
    -- Check if breach alert already exists for this vehicle/zone
    SELECT EXISTS (
      SELECT 1 FROM breach_alerts
      WHERE plate_number = v_obs.plate_number
        AND zone_id = v_obs.zone_id
        AND organization_id = v_obs.organization_id
        AND status = 'active'
    ) INTO v_breach_exists;
    
    -- Only create new alert if none exists
    IF NOT v_breach_exists THEN
      INSERT INTO breach_alerts (
        organization_id,
        zone_id,
        vehicle_record_id, -- Legacy compatibility
        plate_number,
        breach_type,
        breach_details,
        due_date,
        observation_id,
        status
      )
      VALUES (
        v_obs.organization_id,
        v_obs.zone_id,
        NULL, -- No vehicle_records anymore
        v_obs.plate_number,
        v_compliance.breach_type,
        jsonb_build_object(
          'violation_reasons', v_compliance.violation_reasons,
          'nights_stayed', v_compliance.nights_stayed,
          'nights_allowed', v_compliance.nights_allowed,
          'consecutive_nights', v_compliance.consecutive_nights,
          'consecutive_allowed', v_compliance.consecutive_allowed,
          'detected_at', NOW(),
          'enforcement_workflow', v_org.enforcement_workflow
        ),
        CURRENT_DATE + INTERVAL '7 days', -- 7 days to resolve
        p_observation_id,
        'active'
      );
      
      RAISE NOTICE 'BREACH ALERT CREATED: % in zone % (workflow: %)',
        v_obs.plate_number, v_obs.zone_id, v_org.enforcement_workflow;
    END IF;
  END IF;
  
  -- If AT RISK, update observation
  IF v_compliance.at_risk THEN
    UPDATE vehicle_observations_v2
    SET 
      breach_warning = TRUE,
      breach_warning_reason = array_to_string(v_compliance.violation_reasons, '; ')
    WHERE observation_id = p_observation_id;
    
    RAISE NOTICE 'AT RISK FLAG SET: % - %',
      v_obs.plate_number, v_compliance.violation_reasons;
  END IF;
END;
$$;

-- STEP 3: Create trigger to auto-run compliance check on new observations
DROP TRIGGER IF EXISTS trigger_auto_compliance_check ON vehicle_observations_v2;

CREATE TRIGGER trigger_auto_compliance_check
  AFTER INSERT ON vehicle_observations_v2
  FOR EACH ROW
  EXECUTE FUNCTION auto_evaluate_compliance_and_create_breach(NEW.observation_id);

-- STEP 4: Update canonical_vehicles to track enforcement
ALTER TABLE canonical_vehicles
ADD COLUMN IF NOT EXISTS enforcement_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_enforcement_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_enforcement_type TEXT;

-- STEP 5: Create index for faster breach alert queries
CREATE INDEX IF NOT EXISTS idx_breach_alerts_active_org 
  ON breach_alerts(organization_id, status) 
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_breach_alerts_plate_zone 
  ON breach_alerts(plate_number, zone_id, status) 
  WHERE status = 'active';

-- STEP 6: Add comments
COMMENT ON FUNCTION calculate_vehicle_compliance_v3 IS 
  'Comprehensive compliance checking: validates monthly limits, consecutive limits, day-visit-only rules, and at-risk status. Returns detailed breach information for enforcement workflow routing.';

COMMENT ON FUNCTION auto_evaluate_compliance_and_create_breach IS 
  'Triggered on new observations - evaluates compliance, populates compliance_results table, creates breach_alerts for non-compliant vehicles (respecting homeless FC Act exemption), and routes to admin vs officer based on organization enforcement_workflow setting.';

COMMENT ON TRIGGER trigger_auto_compliance_check ON vehicle_observations_v2 IS
  'Auto-evaluates compliance and creates breach alerts when new observation is recorded';
