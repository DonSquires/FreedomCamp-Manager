-- =====================================================
-- AUTO-CREATE COMPLIANCE RESULTS ON OBSERVATION INSERT
-- =====================================================
-- Automatically evaluate compliance and create compliance_results
-- record whenever a new observation is inserted.
--
-- This ensures dashboards always show real-time compliance data
-- without requiring manual recalculation.
--
-- Tables affected: compliance_results
-- Functions created: auto_create_compliance_result()
-- Triggers created: trigger_auto_create_compliance_result on vehicle_observations_v2

-- =====================================================
-- FUNCTION: auto_create_compliance_result()
-- =====================================================
-- Evaluates compliance for a new observation and creates compliance_results record
CREATE OR REPLACE FUNCTION auto_create_compliance_result()
RETURNS TRIGGER AS $$
DECLARE
  v_matrix_record RECORD;
  v_is_compliant BOOLEAN;
  v_violation_reasons TEXT[];
  v_matrix_snapshot JSONB;
  v_homeless_status TEXT;
  v_monthly_stay RECORD;
BEGIN
  -- Get active compliance matrix for this zone
  SELECT *
  INTO v_matrix_record
  FROM zone_compliance_matrix
  WHERE zone_id = NEW.zone_id
    AND effective_to IS NULL
  LIMIT 1;

  -- If no matrix exists, default to compliant (no rules to violate)
  IF NOT FOUND THEN
    INSERT INTO compliance_results (
      observation_id,
      zone_id,
      organization_id,
      matrix_id,
      matrix_version,
      is_compliant,
      violation_reasons,
      matrix_snapshot,
      evaluated_at
    ) VALUES (
      NEW.observation_id,
      NEW.zone_id,
      NEW.organization_id,
      NULL,
      NULL,
      true,
      ARRAY[]::TEXT[],
      '{}'::JSONB,
      NOW()
    );
    
    RETURN NEW;
  END IF;

  -- Create matrix snapshot for audit trail
  v_matrix_snapshot := jsonb_build_object(
    'self_contained_required', v_matrix_record.self_contained_required,
    'nights_per_month', v_matrix_record.nights_per_month,
    'max_consecutive_nights', v_matrix_record.max_consecutive_nights,
    'day_visit_only', v_matrix_record.day_visit_only,
    'allowed_days', v_matrix_record.allowed_days,
    'homeless_exemption', v_matrix_record.homeless_exemption
  );

  -- Initialize compliance check
  v_is_compliant := true;
  v_violation_reasons := ARRAY[]::TEXT[];

  -- Check homeless exemption status
  SELECT homeless_status
  INTO v_homeless_status
  FROM canonical_vehicles
  WHERE plate_number = NEW.plate_number;

  -- RULE 1: Self-contained requirement
  IF v_matrix_record.self_contained_required AND NOT COALESCE(NEW.self_contained, false) THEN
    -- Exempt if homeless and exemption enabled
    IF NOT (v_homeless_status = 'confirmed' AND v_matrix_record.homeless_exemption) THEN
      v_is_compliant := false;
      v_violation_reasons := array_append(v_violation_reasons, 'not_self_contained');
    END IF;
  END IF;

  -- RULE 2: Day visit only (no overnight stays allowed)
  IF v_matrix_record.day_visit_only THEN
    -- This rule is checked during observation creation
    -- If observation exists, it wasn't filtered out by day-visit-only logic
    -- So we don't need to re-check here
    NULL;
  END IF;

  -- RULE 3: Monthly stay limits (consecutive and total nights)
  -- Get the current monthly stay record for this plate/zone/month
  SELECT *
  INTO v_monthly_stay
  FROM vehicle_monthly_stays
  WHERE plate_number = NEW.plate_number
    AND zone_id = NEW.zone_id
    AND calendar_month = DATE_TRUNC('month', NEW.recorded_at::DATE)
    AND organization_id = NEW.organization_id
  LIMIT 1;

  IF FOUND THEN
    -- Check consecutive nights limit
    IF v_monthly_stay.consecutive_nights > v_matrix_record.max_consecutive_nights THEN
      -- Exempt if homeless and exemption enabled
      IF NOT (v_homeless_status = 'confirmed' AND v_matrix_record.homeless_exemption) THEN
        v_is_compliant := false;
        v_violation_reasons := array_append(
          v_violation_reasons, 
          format('consecutive_nights_exceeded_%s_of_%s', 
            v_monthly_stay.consecutive_nights, 
            v_matrix_record.max_consecutive_nights
          )
        );
      END IF;
    END IF;

    -- Check total monthly nights limit
    IF v_monthly_stay.nights_stayed > v_matrix_record.nights_per_month THEN
      -- Exempt if homeless and exemption enabled
      IF NOT (v_homeless_status = 'confirmed' AND v_matrix_record.homeless_exemption) THEN
        v_is_compliant := false;
        v_violation_reasons := array_append(
          v_violation_reasons, 
          format('monthly_nights_exceeded_%s_of_%s', 
            v_monthly_stay.nights_stayed, 
            v_matrix_record.nights_per_month
          )
        );
      END IF;
    END IF;
  END IF;

  -- RULE 4: Allowed days (if restricted)
  IF v_matrix_record.allowed_days IS NOT NULL THEN
    DECLARE
      v_day_of_week TEXT;
    BEGIN
      v_day_of_week := TO_CHAR(NEW.recorded_at, 'Day');
      v_day_of_week := TRIM(v_day_of_week);
      
      IF NOT (v_matrix_record.allowed_days @> jsonb_build_array(v_day_of_week)) THEN
        v_is_compliant := false;
        v_violation_reasons := array_append(v_violation_reasons, 'day_not_allowed');
      END IF;
    END;
  END IF;

  -- Insert compliance result
  INSERT INTO compliance_results (
    observation_id,
    zone_id,
    organization_id,
    matrix_id,
    matrix_version,
    is_compliant,
    violation_reasons,
    matrix_snapshot,
    evaluated_at
  ) VALUES (
    NEW.observation_id,
    NEW.zone_id,
    NEW.organization_id,
    v_matrix_record.id,
    v_matrix_record.version,
    v_is_compliant,
    v_violation_reasons,
    v_matrix_snapshot,
    NOW()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- TRIGGER: trigger_auto_create_compliance_result
-- =====================================================
-- Fire AFTER INSERT to ensure all related data is committed first
DROP TRIGGER IF EXISTS trigger_auto_create_compliance_result ON vehicle_observations_v2;

CREATE TRIGGER trigger_auto_create_compliance_result
  AFTER INSERT ON vehicle_observations_v2
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_compliance_result();

-- =====================================================
-- COMMENT
-- =====================================================
COMMENT ON FUNCTION auto_create_compliance_result() IS 
'Automatically creates compliance_results record when a new observation is inserted. 
Evaluates all zone compliance rules (self-contained, monthly limits, consecutive nights, allowed days) 
and stores matrix snapshot for audit trail. Handles homeless exemptions if enabled.';

COMMENT ON TRIGGER trigger_auto_create_compliance_result ON vehicle_observations_v2 IS 
'Automatically creates compliance result record for every new observation, ensuring dashboards show real-time compliance data without manual recalculation.';
