-- =====================================================
-- POPULATE BREACH ALERTS TABLE
-- =====================================================
-- Creates breach alert records for all non-compliant observations
-- and ensures future non-compliant observations automatically
-- create breach alerts.
--
-- Tables affected: breach_alerts
-- Functions updated: create_breach_alert_from_compliance()
-- Triggers updated: trigger_auto_create_breach_alert

-- =====================================================
-- FUNCTION: create_breach_alert_from_compliance()
-- =====================================================
-- Creates breach alert from a compliance_results record
-- Only creates alerts for non-compliant observations
CREATE OR REPLACE FUNCTION create_breach_alert_from_compliance()
RETURNS TRIGGER AS $$
DECLARE
  v_observation RECORD;
  v_existing_alert_id UUID;
BEGIN
  -- Only create breach alert if non-compliant
  IF NOT NEW.is_compliant THEN
    
    -- Get observation details
    SELECT *
    INTO v_observation
    FROM observations
    WHERE observation_id = NEW.observation_id;
    
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    -- Check if breach alert already exists for this observation
    SELECT id
    INTO v_existing_alert_id
    FROM breach_alerts
    WHERE observation_id = NEW.observation_id;
    
    -- Only create if doesn't exist
    IF NOT FOUND THEN
      INSERT INTO breach_alerts (
        organization_id,
        zone_id,
        observation_id,
        breach_type,
        breach_details,
        status,
        created_at
      ) VALUES (
        NEW.organization_id,
        NEW.zone_id,
        NEW.observation_id,
        CASE 
          WHEN 'not_self_contained' = ANY(NEW.violation_reasons) THEN 'no_self_contained'
          WHEN NEW.violation_reasons::TEXT LIKE '%consecutive_nights_exceeded%' THEN 'consecutive_days'
          WHEN NEW.violation_reasons::TEXT LIKE '%monthly_nights_exceeded%' THEN 'nights_exceeded'
          WHEN 'day_not_allowed' = ANY(NEW.violation_reasons) THEN 'unauthorized_zone'
          ELSE 'overstay'
        END,
        jsonb_build_object(
          'violation_reasons', NEW.violation_reasons,
          'matrix_version', NEW.matrix_version,
          'evaluated_at', NEW.evaluated_at,
          'observation_date', v_observation.recorded_at,
          'vehicle_make', v_observation.vehicle_make,
          'vehicle_model', v_observation.vehicle_model,
          'vehicle_color', v_observation.vehicle_color,
          'self_contained', v_observation.self_contained
        ),
        'pending',
        NOW()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- TRIGGER: trigger_auto_create_breach_alert
-- =====================================================
-- Fire AFTER INSERT on compliance_results to create breach alerts
DROP TRIGGER IF EXISTS trigger_auto_create_breach_alert ON compliance_results;

CREATE TRIGGER trigger_auto_create_breach_alert
  AFTER INSERT ON compliance_results
  FOR EACH ROW
  EXECUTE FUNCTION create_breach_alert_from_compliance();

-- =====================================================
-- BACKFILL EXISTING NON-COMPLIANT OBSERVATIONS
-- =====================================================
-- Populate breach_alerts for all existing non-compliant compliance_results

DO $$
DECLARE
  v_batch_size INT := 500;
  v_processed INT := 0;
  v_total INT;
  v_created INT := 0;
BEGIN
  -- Count total non-compliant records to process
  SELECT COUNT(*)
  INTO v_total
  FROM compliance_results cr
  WHERE cr.is_compliant = false
    AND NOT EXISTS (
      SELECT 1 
      FROM breach_alerts ba 
      WHERE ba.observation_id = cr.observation_id
    );

  RAISE NOTICE 'Starting breach alert backfill for % non-compliant observations', v_total;

  -- Process in batches
  WHILE v_processed < v_total LOOP
    
    -- Insert batch of breach alerts
    WITH batch AS (
      SELECT 
        cr.observation_id,
        cr.organization_id,
        cr.zone_id,
        cr.violation_reasons,
        cr.matrix_version,
        cr.evaluated_at,
        o.plate_number,
        o.recorded_at,
        o.vehicle_make,
        o.vehicle_model,
        o.vehicle_color,
        o.self_contained
      FROM compliance_results cr
      JOIN observations o ON o.observation_id = cr.observation_id
      WHERE cr.is_compliant = false
        AND NOT EXISTS (
          SELECT 1 
          FROM breach_alerts ba 
          WHERE ba.observation_id = cr.observation_id
        )
      ORDER BY cr.evaluated_at DESC
      LIMIT v_batch_size
      OFFSET v_processed
    )
    INSERT INTO breach_alerts (
      organization_id,
      zone_id,
      observation_id,
      breach_type,
      breach_details,
      status,
      created_at
    )
    SELECT
      organization_id,
      zone_id,
      observation_id,
      CASE 
        WHEN 'not_self_contained' = ANY(violation_reasons) THEN 'no_self_contained'
        WHEN violation_reasons::TEXT LIKE '%consecutive_nights_exceeded%' THEN 'consecutive_days'
        WHEN violation_reasons::TEXT LIKE '%monthly_nights_exceeded%' THEN 'nights_exceeded'
        WHEN 'day_not_allowed' = ANY(violation_reasons) THEN 'unauthorized_zone'
        ELSE 'overstay'
      END,
      jsonb_build_object(
        'violation_reasons', violation_reasons,
        'matrix_version', matrix_version,
        'evaluated_at', evaluated_at,
        'observation_date', recorded_at,
        'vehicle_make', vehicle_make,
        'vehicle_model', vehicle_model,
        'vehicle_color', vehicle_color,
        'self_contained', self_contained,
        'backfilled', true,
        'backfilled_at', NOW()
      ),
      'pending',
      NOW()
    FROM batch;
    
    GET DIAGNOSTICS v_created = ROW_COUNT;
    v_processed := v_processed + v_created;
    
    RAISE NOTICE 'Processed % of % breach alerts (% in this batch)', v_processed, v_total, v_created;
    
    -- Exit if no more records
    IF v_created = 0 THEN
      EXIT;
    END IF;
    
  END LOOP;

  RAISE NOTICE 'Breach alert backfill complete: % records created', v_processed;
END $$;

-- =====================================================
-- VERIFICATION QUERY
-- =====================================================
-- Check backfill results
DO $$
DECLARE
  v_breach_count INT;
  v_non_compliant_count INT;
BEGIN
  SELECT COUNT(*) INTO v_breach_count FROM breach_alerts;
  SELECT COUNT(*) INTO v_non_compliant_count FROM compliance_results WHERE is_compliant = false;
  
  RAISE NOTICE 'Breach Alerts: %, Non-Compliant Observations: %', v_breach_count, v_non_compliant_count;
  
  IF v_breach_count < v_non_compliant_count THEN
    RAISE WARNING 'Breach alert count (%) is less than non-compliant count (%). Some observations may not have breach alerts.', v_breach_count, v_non_compliant_count;
  END IF;
END $$;

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON FUNCTION create_breach_alert_from_compliance() IS 
'Automatically creates breach_alerts record when a non-compliant compliance_results record is inserted. 
Extracts breach type from violation_reasons array and stores observation metadata for enforcement workflow.';

COMMENT ON TRIGGER trigger_auto_create_breach_alert ON compliance_results IS 
'Automatically creates breach alert for every non-compliant observation, populating the enforcement workflow queue in real-time.';
