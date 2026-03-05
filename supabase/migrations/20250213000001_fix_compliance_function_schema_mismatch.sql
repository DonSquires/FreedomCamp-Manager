-- =====================================================
-- CRITICAL FIX: Compliance Function Schema Mismatch
-- =====================================================
-- Issue: calculate_vehicle_compliance_with_results() references
--        canonical_vehicles_backup_20250203 which doesn't exist
-- 
-- Fix: Update function to use canonical_vehicles (current table)
--      and change vehicle_id references to plate_number
-- =====================================================

-- Drop old function
DROP FUNCTION IF EXISTS calculate_vehicle_compliance_with_results(text, uuid, date, uuid);

-- Recreate with correct table references
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
  v_organization_id uuid;
BEGIN
  -- Get the first day of the month for the check date
  v_calendar_month := date_trunc('month', p_check_date)::date;

  -- Get organization_id from zone
  SELECT organization_id INTO v_organization_id
  FROM zones
  WHERE id = p_zone_id;

  IF NOT FOUND THEN
    -- Zone not found
    RETURN QUERY SELECT 
      false::boolean,
      'zone_not_found'::text,
      'Zone not found'::text,
      'critical'::text,
      0::integer,
      0::integer;
    RETURN;
  END IF;

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

  -- ✅ CRITICAL FIX: Insert into compliance_results table using plate_number (not vehicle_id)
  IF p_observation_id IS NOT NULL THEN
    -- Drop old foreign key constraint if exists
    ALTER TABLE compliance_results
      DROP CONSTRAINT IF EXISTS compliance_results_vehicle_id_fkey;

    -- Alter vehicle_id column to TEXT to match canonical_vehicles.plate_number
    DO $alter$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'compliance_results'
        AND column_name = 'vehicle_id'
        AND data_type = 'uuid'
      ) THEN
        -- Drop and recreate with TEXT type
        ALTER TABLE compliance_results DROP COLUMN IF EXISTS vehicle_id;
        ALTER TABLE compliance_results ADD COLUMN vehicle_id TEXT;
      END IF;
    END $alter$;

    -- Add new foreign key constraint to canonical_vehicles.plate_number
    ALTER TABLE compliance_results
      ADD CONSTRAINT compliance_results_vehicle_id_fkey
      FOREIGN KEY (vehicle_id) REFERENCES canonical_vehicles(plate_number) ON DELETE CASCADE;

    -- Insert compliance result
    INSERT INTO compliance_results (
      observation_id,
      vehicle_id, -- Now TEXT, references canonical_vehicles.plate_number
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
    VALUES (
      p_observation_id,
      p_plate_number, -- ✅ Use plate_number directly
      p_zone_id,
      v_organization_id,
      v_matrix_id,
      v_matrix_version,
      v_result.is_compliant,
      v_violation_reasons,
      v_metrics,
      v_matrix_snapshot,
      NOW()
    )
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

COMMENT ON FUNCTION calculate_vehicle_compliance_with_results IS 
  '✅ FIXED: Enhanced compliance calculation that uses canonical_vehicles (not backup table). Populates compliance_results with plate_number references.';

-- Migration summary
DO $$
BEGIN
  RAISE NOTICE '✅ CRITICAL FIX APPLIED: Compliance Function Schema Mismatch';
  RAISE NOTICE '   - Updated calculate_vehicle_compliance_with_results() to use canonical_vehicles';
  RAISE NOTICE '   - Changed compliance_results.vehicle_id from UUID to TEXT';
  RAISE NOTICE '   - Updated foreign key to reference canonical_vehicles.plate_number';
  RAISE NOTICE '   - Scanning and compliance calculations should now work correctly';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  IMPORTANT: Test scanning workflow immediately after this migration';
END $$;
