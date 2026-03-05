-- Migration: Populate compliance_results table properly
-- Date: 2025-02-04
-- Purpose: Implement proper compliance_results population for audit trail and drift detection

-- Add migration audit log
INSERT INTO audit_log (
  action,
  entity_type,
  old_values,
  new_values
) VALUES (
  'migration',
  'compliance_results',
  NULL,
  jsonb_build_object(
    'migration_name', '20250204_populate_compliance_results',
    'purpose', 'Enable proper compliance_results population with matrix versioning',
    'affected_systems', ARRAY['compliance_results', 'calculate_vehicle_compliance', 'audit_trail']
  )
);

-- Create improved function that populates compliance_results table
CREATE OR REPLACE FUNCTION calculate_vehicle_compliance_with_results(
  p_plate_number text,
  p_zone_id uuid,
  p_check_date date DEFAULT CURRENT_DATE,
  p_observation_id uuid DEFAULT NULL
) RETURNS TABLE (
  is_compliant boolean,
  violation_type text,
  violation_message text,
  violation_severity text,
  consecutive_nights integer,
  month_nights integer
) AS $$
DECLARE
  v_zone_rules RECORD;
  v_monthly_stays RECORD;
  v_calendar_month date;
  v_result RECORD;
  v_matrix_id uuid;
  v_matrix_version integer;
  v_violation_reasons text[];
  v_metrics jsonb;
  v_matrix_snapshot jsonb;
BEGIN
  -- Get the first day of the month for the check date
  v_calendar_month := date_trunc('month', p_check_date)::date;

  -- Get active zone compliance matrix (effective_to IS NULL means active)
  SELECT 
    id,
    version,
    max_consecutive_nights,
    nights_per_month,
    self_contained_required,
    day_visit_only,
    homeless_exemption,
    allowed_days
  INTO v_zone_rules
  FROM zone_compliance_matrix
  WHERE zone_id = p_zone_id
    AND effective_to IS NULL
  ORDER BY version DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- No compliance rules found - default to compliant
    RETURN QUERY SELECT 
      true::boolean,
      NULL::text,
      'No compliance rules configured'::text,
      'info'::text,
      0::integer,
      0::integer;
    RETURN;
  END IF;

  v_matrix_id := v_zone_rules.id;
  v_matrix_version := v_zone_rules.version;

  -- Get monthly stay stats
  SELECT 
    nights_stayed,
    consecutive_nights
  INTO v_monthly_stays
  FROM vehicle_monthly_stays
  WHERE plate_number = p_plate_number
    AND zone_id = p_zone_id
    AND calendar_month = v_calendar_month;

  IF NOT FOUND THEN
    -- No stay data yet - compliant
    v_monthly_stays.nights_stayed := 0;
    v_monthly_stays.consecutive_nights := 0;
  END IF;

  -- Initialize result variables
  v_violation_reasons := ARRAY[]::text[];
  v_metrics := jsonb_build_object(
    'consecutive_nights', v_monthly_stays.consecutive_nights,
    'month_nights', v_monthly_stays.nights_stayed,
    'max_consecutive_allowed', v_zone_rules.max_consecutive_nights,
    'max_monthly_allowed', v_zone_rules.nights_per_month,
    'check_date', p_check_date,
    'calendar_month', v_calendar_month
  );

  -- Create matrix snapshot for audit trail
  v_matrix_snapshot := jsonb_build_object(
    'version', v_zone_rules.version,
    'max_consecutive_nights', v_zone_rules.max_consecutive_nights,
    'nights_per_month', v_zone_rules.nights_per_month,
    'self_contained_required', v_zone_rules.self_contained_required,
    'day_visit_only', v_zone_rules.day_visit_only,
    'homeless_exemption', v_zone_rules.homeless_exemption,
    'allowed_days', v_zone_rules.allowed_days
  );

  -- Check BOTH criteria (consecutive AND monthly)
  IF v_monthly_stays.consecutive_nights > v_zone_rules.max_consecutive_nights THEN
    v_violation_reasons := array_append(v_violation_reasons, 
      format('Exceeded consecutive nights limit: %s/%s nights', 
        v_monthly_stays.consecutive_nights, 
        v_zone_rules.max_consecutive_nights
      )
    );
    
    v_result.is_compliant := false;
    v_result.violation_type := 'consecutive_overstay';
    v_result.violation_message := format('Vehicle stayed %s consecutive nights (max: %s)', 
      v_monthly_stays.consecutive_nights, 
      v_zone_rules.max_consecutive_nights
    );
    v_result.violation_severity := 'critical';

  ELSIF v_monthly_stays.nights_stayed > v_zone_rules.nights_per_month THEN
    v_violation_reasons := array_append(v_violation_reasons, 
      format('Exceeded monthly nights limit: %s/%s nights', 
        v_monthly_stays.nights_stayed, 
        v_zone_rules.nights_per_month
      )
    );
    
    v_result.is_compliant := false;
    v_result.violation_type := 'monthly_overstay';
    v_result.violation_message := format('Vehicle stayed %s nights this month (max: %s)', 
      v_monthly_stays.nights_stayed, 
      v_zone_rules.nights_per_month
    );
    v_result.violation_severity := 'critical';

  ELSIF v_monthly_stays.consecutive_nights = v_zone_rules.max_consecutive_nights THEN
    v_violation_reasons := array_append(v_violation_reasons, 
      format('At consecutive nights limit: %s/%s nights', 
        v_monthly_stays.consecutive_nights, 
        v_zone_rules.max_consecutive_nights
      )
    );
    
    v_result.is_compliant := false;
    v_result.violation_type := 'consecutive_limit_reached';
    v_result.violation_message := format('Vehicle at consecutive nights limit (%s nights) - will breach if stays tonight', 
      v_zone_rules.max_consecutive_nights
    );
    v_result.violation_severity := 'moderate';

  ELSIF v_monthly_stays.nights_stayed = v_zone_rules.nights_per_month THEN
    v_violation_reasons := array_append(v_violation_reasons, 
      format('At monthly nights limit: %s/%s nights', 
        v_monthly_stays.nights_stayed, 
        v_zone_rules.nights_per_month
      )
    );
    
    v_result.is_compliant := false;
    v_result.violation_type := 'monthly_limit_reached';
    v_result.violation_message := format('Vehicle at monthly nights limit (%s nights) - will breach if stays tonight', 
      v_zone_rules.nights_per_month
    );
    v_result.violation_severity := 'moderate';

  ELSE
    -- Compliant
    v_result.is_compliant := true;
    v_result.violation_type := NULL;
    v_result.violation_message := 'Compliant with zone requirements';
    v_result.violation_severity := NULL;
  END IF;

  v_result.consecutive_nights := v_monthly_stays.consecutive_nights;
  v_result.month_nights := v_monthly_stays.nights_stayed;

  -- ✅ CRITICAL: Insert into compliance_results table for audit trail
  IF p_observation_id IS NOT NULL THEN
    INSERT INTO compliance_results (
      observation_id,
      vehicle_id, -- Links to canonical_vehicles_backup_20250203.vehicle_id
      zone_id,
      organization_id,
      matrix_id,
      matrix_version,
      is_compliant,
      violation_reasons,
      metrics_json,
      matrix_snapshot,
      evaluated_at
    )
    SELECT
      p_observation_id,
      cv.vehicle_id, -- Get UUID from backup table
      p_zone_id,
      z.organization_id,
      v_matrix_id,
      v_matrix_version,
      v_result.is_compliant,
      v_violation_reasons,
      v_metrics,
      v_matrix_snapshot,
      NOW()
    FROM canonical_vehicles_backup_20250203 cv
    CROSS JOIN zones z
    WHERE cv.plate_number = p_plate_number
      AND z.id = p_zone_id
    ON CONFLICT (observation_id, matrix_id) DO UPDATE SET
      is_compliant = EXCLUDED.is_compliant,
      violation_reasons = EXCLUDED.violation_reasons,
      metrics_json = EXCLUDED.metrics_json,
      evaluated_at = NOW();

    RAISE NOTICE '✅ Compliance result recorded for observation %', p_observation_id;
  END IF;

  -- Return the compliance result
  RETURN QUERY SELECT 
    v_result.is_compliant,
    v_result.violation_type,
    v_result.violation_message,
    v_result.violation_severity,
    v_result.consecutive_nights,
    v_result.month_nights;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_vehicle_compliance_with_results(text, uuid, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION calculate_vehicle_compliance_with_results(text, uuid, date, uuid) TO authenticated;

-- Create index on compliance_results for faster queries
CREATE INDEX IF NOT EXISTS idx_compliance_results_evaluated_at 
  ON compliance_results(evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_results_compliant_evaluated 
  ON compliance_results(is_compliant, evaluated_at DESC);

COMMENT ON FUNCTION calculate_vehicle_compliance_with_results IS 
  'Enhanced compliance calculation that populates compliance_results table for audit trail and drift detection. Includes matrix versioning and snapshot storage.';
