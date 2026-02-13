-- =====================================================
-- COMPLIANCE MATRIX REBUILD - Complete System
-- Purpose: Rebuild compliance evaluation with 9am overnight cutoff
-- Includes: Matrix setup, evaluation function, triggers, and backfill
-- =====================================================

-- PHASE 1: CLEANUP OLD COMPLIANCE SYSTEM
-- =====================================================

-- Drop old triggers if they exist
DROP TRIGGER IF EXISTS trigger_evaluate_compliance_on_insert ON vehicle_observations_v2;
DROP TRIGGER IF EXISTS trigger_create_breach_alert_from_compliance ON compliance_results;

-- Drop old functions
DROP FUNCTION IF EXISTS evaluate_compliance(UUID, TEXT, UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS create_breach_alert_from_compliance();
DROP FUNCTION IF EXISTS trigger_evaluate_compliance();

-- Clear old compliance data
TRUNCATE TABLE compliance_results CASCADE;
TRUNCATE TABLE breach_alerts CASCADE;

-- PHASE 2: ZONE COMPLIANCE MATRIX SETUP
-- =====================================================

-- Add allowed_hours column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'zone_compliance_matrix' 
    AND column_name = 'allowed_hours'
  ) THEN
    ALTER TABLE zone_compliance_matrix 
    ADD COLUMN allowed_hours JSONB DEFAULT '{"start": 6, "end": 20}'::jsonb;
  END IF;
END $$;

-- Create index on zone matrix for faster lookups
CREATE INDEX IF NOT EXISTS idx_zcm_zone_effective 
ON zone_compliance_matrix(zone_id, effective_from, effective_to)
WHERE effective_to IS NULL;

-- Populate initial matrix versions from current zone settings
INSERT INTO zone_compliance_matrix (
  zone_id,
  organization_id,
  version,
  self_contained_required,
  nights_per_month,
  max_consecutive_nights,
  day_visit_only,
  allowed_days,
  allowed_hours,
  homeless_exemption,
  effective_from,
  effective_to,
  created_by,
  change_reason
)
SELECT 
  z.id,
  z.organization_id,
  1 as version,
  z.self_contained_required,
  z.nights_per_month,
  z.max_consecutive_nights,
  z.day_visit_only,
  z.allowed_days,
  '{"start": 6, "end": 20}'::jsonb as allowed_hours,
  true as homeless_exemption,
  '2025-02-14 00:00:00+00'::timestamptz as effective_from,
  NULL as effective_to,
  NULL as created_by,
  'Initial compliance matrix setup with 9am overnight cutoff'
FROM zones z
WHERE z.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM zone_compliance_matrix zcm 
    WHERE zcm.zone_id = z.id
  )
ON CONFLICT (zone_id, version) DO NOTHING;

-- PHASE 3: COMPLIANCE EVALUATION FUNCTION WITH 9AM CUTOFF
-- =====================================================

CREATE OR REPLACE FUNCTION evaluate_compliance(
  p_observation_id UUID,
  p_plate_number TEXT,
  p_zone_id UUID,
  p_recorded_at TIMESTAMPTZ
)
RETURNS TABLE(
  is_compliant BOOLEAN,
  violation_reasons TEXT[],
  matrix_snapshot JSONB
) AS $$
DECLARE
  v_matrix RECORD;
  v_vehicle RECORD;
  v_compliant BOOLEAN := TRUE;
  v_violations TEXT[] := ARRAY[]::TEXT[];
  v_snapshot JSONB;
  v_nz_date DATE;
  v_nz_hour INTEGER;
  v_monthly_stays RECORD;
  v_previous_obs RECORD;
  v_gps_distance NUMERIC;
BEGIN
  -- Get zone compliance matrix (active version at observation time)
  SELECT * INTO v_matrix
  FROM zone_compliance_matrix
  WHERE zone_id = p_zone_id
    AND effective_from <= p_recorded_at
    AND (effective_to IS NULL OR effective_to > p_recorded_at)
  ORDER BY version DESC
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, ARRAY['No active compliance matrix found for zone'], '{}'::JSONB;
    RETURN;
  END IF;
  
  -- Get vehicle details from canonical_vehicles
  SELECT * INTO v_vehicle
  FROM canonical_vehicles
  WHERE plate_number = p_plate_number;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, ARRAY['Vehicle not found in canonical database'], '{}'::JSONB;
    RETURN;
  END IF;
  
  -- Create matrix snapshot
  v_snapshot := jsonb_build_object(
    'matrix_id', v_matrix.id,
    'version', v_matrix.version,
    'self_contained_required', v_matrix.self_contained_required,
    'nights_per_month', v_matrix.nights_per_month,
    'max_consecutive_nights', v_matrix.max_consecutive_nights,
    'day_visit_only', v_matrix.day_visit_only,
    'allowed_hours', v_matrix.allowed_hours,
    'homeless_exemption', v_matrix.homeless_exemption
  );
  
  -- Convert to NZ timezone for calendar day logic
  v_nz_date := DATE(p_recorded_at AT TIME ZONE 'Pacific/Auckland');
  v_nz_hour := EXTRACT(HOUR FROM p_recorded_at AT TIME ZONE 'Pacific/Auckland');
  
  -- RULE 1: Homeless Exemption (FC Act)
  IF v_matrix.homeless_exemption = TRUE AND v_vehicle.homeless_status = 'confirmed' THEN
    v_violations := v_violations || 'FC Act Exempt (Confirmed Homeless)';
    RETURN QUERY SELECT TRUE, v_violations, v_snapshot;
    RETURN;
  END IF;
  
  -- RULE 2: Self-Contained Requirement
  IF v_matrix.self_contained_required = TRUE THEN
    IF v_vehicle.self_contained = FALSE OR v_vehicle.self_contained IS NULL THEN
      v_compliant := FALSE;
      v_violations := v_violations || 'Not Self-Contained (zone requires SC)';
    ELSIF v_vehicle.self_contained_expiry IS NOT NULL AND v_vehicle.self_contained_expiry < v_nz_date THEN
      v_compliant := FALSE;
      v_violations := v_violations || format('SC Sticker Expired (%s)', v_vehicle.self_contained_expiry);
    END IF;
  END IF;
  
  -- RULE 3: Day-Visit Zone (max_consecutive_nights = 0) - SPECIAL OVERNIGHT LOGIC
  IF v_matrix.max_consecutive_nights = 0 THEN
    -- Night period: 8pm-9am (20:00-09:00)
    IF v_nz_hour >= 20 OR v_nz_hour < 9 THEN
      -- Check if vehicle was seen before midnight on previous calendar day
      SELECT * INTO v_previous_obs
      FROM vehicle_observations_v2 obs
      WHERE obs.plate_number = p_plate_number
        AND obs.zone_id = p_zone_id
        AND obs.recorded_at < p_recorded_at
        AND DATE(obs.recorded_at AT TIME ZONE 'Pacific/Auckland') = v_nz_date - INTERVAL '1 day'
        AND EXTRACT(HOUR FROM obs.recorded_at AT TIME ZONE 'Pacific/Auckland') >= 20
      ORDER BY obs.recorded_at DESC
      LIMIT 1;
      
      IF FOUND THEN
        -- Calculate GPS distance if both observations have coordinates
        IF v_previous_obs.gps_latitude IS NOT NULL AND v_previous_obs.gps_longitude IS NOT NULL THEN
          SELECT 
            6371 * acos(
              cos(radians(v_previous_obs.gps_latitude)) * 
              cos(radians((SELECT gps_latitude FROM vehicle_observations_v2 WHERE observation_id = p_observation_id))) * 
              cos(radians((SELECT gps_longitude FROM vehicle_observations_v2 WHERE observation_id = p_observation_id)) - radians(v_previous_obs.gps_longitude)) + 
              sin(radians(v_previous_obs.gps_latitude)) * 
              sin(radians((SELECT gps_latitude FROM vehicle_observations_v2 WHERE observation_id = p_observation_id)))
            ) * 1000 -- Convert to meters
          INTO v_gps_distance;
          
          -- If within 15 meters, it's the same location = overnight stay = breach
          IF v_gps_distance IS NOT NULL AND v_gps_distance <= 15 THEN
            v_compliant := FALSE;
            v_violations := v_violations || format('Day-visit zone: Overnight stay detected (before midnight → after midnight at same location, %.1fm apart)', v_gps_distance);
          END IF;
        END IF;
      END IF;
    END IF;
  
  -- RULE 4: Standard Zones (1, 2, 3 night limits) - Monthly Stay Tracking
  ELSIF v_matrix.max_consecutive_nights > 0 THEN
    -- Get monthly stay tracking
    SELECT * INTO v_monthly_stays
    FROM vehicle_monthly_stays
    WHERE plate_number = p_plate_number
      AND zone_id = p_zone_id
      AND organization_id = (SELECT organization_id FROM zones WHERE id = p_zone_id)
      AND calendar_month = DATE_TRUNC('month', v_nz_date)::DATE;
    
    IF FOUND THEN
      -- Check consecutive nights limit
      IF v_monthly_stays.consecutive_nights >= v_matrix.max_consecutive_nights THEN
        v_compliant := FALSE;
        v_violations := v_violations || format('Consecutive nights limit exceeded (%s/%s nights)', 
          v_monthly_stays.consecutive_nights, v_matrix.max_consecutive_nights);
      END IF;
      
      -- Check monthly limit
      IF v_monthly_stays.nights_stayed >= v_matrix.nights_per_month THEN
        v_compliant := FALSE;
        v_violations := v_violations || format('Monthly limit exceeded (%s/%s nights)', 
          v_monthly_stays.nights_stayed, v_matrix.nights_per_month);
      END IF;
    END IF;
  END IF;
  
  -- Return final compliance result
  RETURN QUERY SELECT v_compliant, v_violations, v_snapshot;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION evaluate_compliance IS 
'Compliance evaluation function with 9am overnight cutoff (20:00-09:00 night period). Calendar-day-aware with GPS verification for day-visit zones.';

-- PHASE 4: AUTO-EVALUATION TRIGGER ON NEW OBSERVATIONS
-- =====================================================

CREATE OR REPLACE FUNCTION trigger_evaluate_compliance()
RETURNS TRIGGER AS $$
DECLARE
  v_result RECORD;
BEGIN
  -- Evaluate compliance for new observation
  SELECT * INTO v_result
  FROM evaluate_compliance(
    NEW.observation_id,
    NEW.plate_number,
    NEW.zone_id,
    NEW.recorded_at
  );
  
  -- Insert compliance result
  INSERT INTO compliance_results (
    observation_id,
    zone_id,
    organization_id,
    is_compliant,
    violation_reasons,
    matrix_snapshot,
    evaluated_at
  ) VALUES (
    NEW.observation_id,
    NEW.zone_id,
    NEW.organization_id,
    v_result.is_compliant,
    v_result.violation_reasons,
    v_result.matrix_snapshot,
    NOW()
  )
  ON CONFLICT (observation_id) DO UPDATE
  SET
    is_compliant = EXCLUDED.is_compliant,
    violation_reasons = EXCLUDED.violation_reasons,
    matrix_snapshot = EXCLUDED.matrix_snapshot,
    evaluated_at = EXCLUDED.evaluated_at;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_evaluate_compliance_on_insert
  AFTER INSERT ON vehicle_observations_v2
  FOR EACH ROW
  EXECUTE FUNCTION trigger_evaluate_compliance();

COMMENT ON TRIGGER trigger_evaluate_compliance_on_insert ON vehicle_observations_v2 IS
'Auto-evaluates compliance for every new observation using evaluate_compliance() function';

-- PHASE 5: BREACH ALERT TRIGGER ON COMPLIANCE RESULTS
-- =====================================================

CREATE OR REPLACE FUNCTION create_breach_alert_from_compliance()
RETURNS TRIGGER AS $$
DECLARE
  v_obs RECORD;
  v_vehicle RECORD;
BEGIN
  -- Only create breach alert if non-compliant
  IF NEW.is_compliant = FALSE AND array_length(NEW.violation_reasons, 1) > 0 THEN
    -- Get observation details
    SELECT * INTO v_obs
    FROM vehicle_observations_v2
    WHERE observation_id = NEW.observation_id;
    
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
    
    -- Get vehicle details
    SELECT * INTO v_vehicle
    FROM canonical_vehicles
    WHERE plate_number = v_obs.plate_number;
    
    -- Skip if homeless (FC Act exempt)
    IF v_vehicle.homeless_status = 'confirmed' THEN
      RETURN NEW;
    END IF;
    
    -- Create breach alert
    INSERT INTO breach_alerts (
      observation_id,
      plate_number,
      organization_id,
      zone_id,
      breach_type,
      breach_details,
      status,
      created_at
    ) VALUES (
      NEW.observation_id,
      v_obs.plate_number,
      NEW.organization_id,
      NEW.zone_id,
      NEW.violation_reasons[1], -- Primary violation
      jsonb_build_object(
        'violation_reasons', NEW.violation_reasons,
        'matrix_snapshot', NEW.matrix_snapshot,
        'recorded_at', v_obs.recorded_at
      ),
      'pending',
      NOW()
    )
    ON CONFLICT (observation_id) DO UPDATE
    SET
      breach_type = EXCLUDED.breach_type,
      breach_details = EXCLUDED.breach_details,
      updated_at = NOW();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_breach_alert_from_compliance
  AFTER INSERT OR UPDATE ON compliance_results
  FOR EACH ROW
  EXECUTE FUNCTION create_breach_alert_from_compliance();

COMMENT ON TRIGGER trigger_create_breach_alert_from_compliance ON compliance_results IS
'Creates breach alerts for non-compliant observations (excludes FC Act exempt)';

-- PHASE 6: BACKFILL EXISTING OBSERVATIONS
-- =====================================================

DO $$
DECLARE
  v_obs RECORD;
  v_result RECORD;
  v_total INTEGER;
  v_processed INTEGER := 0;
  v_compliant INTEGER := 0;
  v_non_compliant INTEGER := 0;
  v_fc_exempt INTEGER := 0;
  v_day_visit_breaches INTEGER := 0;
  v_start_time TIMESTAMPTZ;
BEGIN
  v_start_time := clock_timestamp();
  
  -- Get total count
  SELECT COUNT(*) INTO v_total FROM vehicle_observations_v2;
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'COMPLIANCE BACKFILL STARTING';
  RAISE NOTICE 'Total observations: %', v_total;
  RAISE NOTICE 'Overnight window: 20:00-09:00 (8pm-9am)';
  RAISE NOTICE '========================================';
  
  -- Check if there are observations to process
  IF v_total = 0 THEN
    RAISE NOTICE 'No observations found to backfill';
    RETURN;
  END IF;
  
  -- Process all observations in chronological order
  FOR v_obs IN 
    SELECT * FROM vehicle_observations_v2 
    ORDER BY recorded_at ASC
  LOOP
    v_processed := v_processed + 1;
    
    -- Progress updates every 500 records
    IF v_processed % 500 = 0 THEN
      RAISE NOTICE 'Progress: %/% (%.1f%%) - Compliant: %, Non-compliant: %', 
        v_processed, v_total, 
        CASE WHEN v_total > 0 THEN (v_processed::FLOAT / v_total * 100) ELSE 0 END,
        v_compliant, v_non_compliant;
    END IF;
    
    -- Evaluate compliance with new matrix
    SELECT * INTO v_result
    FROM evaluate_compliance(
      v_obs.observation_id,
      v_obs.plate_number,
      v_obs.zone_id,
      v_obs.recorded_at
    );
    
    -- Insert compliance result (trigger will create breach alert if needed)
    INSERT INTO compliance_results (
      observation_id,
      zone_id,
      organization_id,
      is_compliant,
      violation_reasons,
      matrix_snapshot,
      evaluated_at
    ) VALUES (
      v_obs.observation_id,
      v_obs.zone_id,
      v_obs.organization_id,
      v_result.is_compliant,
      v_result.violation_reasons,
      v_result.matrix_snapshot,
      NOW()
    )
    ON CONFLICT (observation_id) DO UPDATE
    SET
      is_compliant = EXCLUDED.is_compliant,
      violation_reasons = EXCLUDED.violation_reasons,
      matrix_snapshot = EXCLUDED.matrix_snapshot,
      evaluated_at = EXCLUDED.evaluated_at;
    
    -- Track statistics
    IF v_result.is_compliant THEN
      v_compliant := v_compliant + 1;
      
      -- Check if FC Act exempt
      IF v_result.violation_reasons @> ARRAY['FC Act Exempt (Confirmed Homeless)'] THEN
        v_fc_exempt := v_fc_exempt + 1;
      END IF;
    ELSE
      v_non_compliant := v_non_compliant + 1;
      
      -- Check if day-visit breach
      IF EXISTS (
        SELECT 1 FROM unnest(v_result.violation_reasons) AS vr
        WHERE vr LIKE 'Day-visit zone:%'
      ) THEN
        v_day_visit_breaches := v_day_visit_breaches + 1;
      END IF;
    END IF;
  END LOOP;
  
  -- Final summary
  RAISE NOTICE '========================================';
  RAISE NOTICE 'BACKFILL COMPLETE';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Duration: % seconds', EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time));
  RAISE NOTICE 'Total observations: %', v_total;
  
  IF v_total > 0 THEN
    RAISE NOTICE 'Compliant: % (%.1f%%)', v_compliant, (v_compliant::FLOAT / v_total * 100);
    RAISE NOTICE '  - FC Act Exempt: % (%.1f%%)', v_fc_exempt, (v_fc_exempt::FLOAT / v_total * 100);
    RAISE NOTICE 'Non-compliant: % (%.1f%%)', v_non_compliant, (v_non_compliant::FLOAT / v_total * 100);
    RAISE NOTICE '  - Day-visit breaches: % (%.1f%%)', v_day_visit_breaches, (v_day_visit_breaches::FLOAT / v_total * 100);
  END IF;
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'NEW OVERNIGHT LOGIC APPLIED:';
  RAISE NOTICE '- Overnight window: 20:00-09:00 (8pm-9am)';
  RAISE NOTICE '- Before midnight (20:00-23:59) + After midnight (00:00-09:00) = Overnight';
  RAISE NOTICE '- First sighting after midnight = NOT overnight';
  RAISE NOTICE '- GPS verification: <=15m = same location';
  RAISE NOTICE '========================================';
END $$;

-- PHASE 7: VERIFICATION QUERIES
-- =====================================================

-- Verify overall compliance results
SELECT 
  'Overall Backfill Results' as summary,
  COUNT(*) as total_observations,
  COUNT(*) FILTER (WHERE is_compliant = TRUE) as compliant_count,
  COUNT(*) FILTER (WHERE is_compliant = FALSE) as non_compliant_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE is_compliant = TRUE) / NULLIF(COUNT(*), 0), 1) as compliance_pct
FROM compliance_results;

-- Verify by zone type
SELECT 
  'Compliance by Zone Type' as summary,
  CASE 
    WHEN z.max_consecutive_nights = 0 THEN 'Day-Visit (0 nights)'
    WHEN z.max_consecutive_nights = 1 THEN 'Limited (1 night)'
    WHEN z.max_consecutive_nights = 2 THEN 'Limited (2 nights)'
    WHEN z.max_consecutive_nights = 3 THEN 'Standard (3 nights)'
    ELSE 'Other'
  END as zone_type,
  COUNT(cr.id) as total_observations,
  COUNT(*) FILTER (WHERE cr.is_compliant = TRUE) as compliant_count,
  COUNT(*) FILTER (WHERE cr.is_compliant = FALSE) as non_compliant_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE cr.is_compliant = TRUE) / NULLIF(COUNT(cr.id), 0), 1) as compliance_pct
FROM compliance_results cr
JOIN zones z ON z.id = cr.zone_id
GROUP BY z.max_consecutive_nights
ORDER BY z.max_consecutive_nights;

-- Final success message
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅✅✅ COMPLIANCE MATRIX REBUILD COMPLETE ✅✅✅';
  RAISE NOTICE '';
  RAISE NOTICE 'System is now operational with:';
  RAISE NOTICE '  - 9am overnight cutoff (20:00-09:00 night period)';
  RAISE NOTICE '  - Calendar-day-aware overnight detection';
  RAISE NOTICE '  - GPS verification for day-visit zones';
  RAISE NOTICE '  - FC Act exemption for confirmed homeless';
  RAISE NOTICE '  - Auto-evaluation on new observations';
  RAISE NOTICE '  - Breach alerts for non-compliant vehicles';
  RAISE NOTICE '';
END $$;
