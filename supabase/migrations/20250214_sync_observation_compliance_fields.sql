-- =====================================================
-- SYNC OBSERVATION COMPLIANCE FIELDS
-- =====================================================
-- Automatically updates observation compliance fields
-- when compliance_results are created or updated.
--
-- This ensures observation records always reflect the
-- authoritative compliance evaluation from compliance_results.
--
-- Tables affected: vehicle_observations_v2
-- Functions created: sync_observation_compliance_fields()
-- Triggers created: trigger_sync_observation_compliance on compliance_results

-- =====================================================
-- FUNCTION: sync_observation_compliance_fields()
-- =====================================================
-- Updates observation record with compliance data from compliance_results
CREATE OR REPLACE FUNCTION sync_observation_compliance_fields()
RETURNS TRIGGER AS $$
DECLARE
  v_breach_type TEXT;
BEGIN
  -- Determine breach type from violation reasons
  IF NOT NEW.is_compliant THEN
    v_breach_type := CASE 
      WHEN 'not_self_contained' = ANY(NEW.violation_reasons) THEN 'no_self_contained'
      WHEN NEW.violation_reasons::TEXT LIKE '%consecutive_nights_exceeded%' THEN 'consecutive_days'
      WHEN NEW.violation_reasons::TEXT LIKE '%monthly_nights_exceeded%' THEN 'nights_exceeded'
      WHEN 'day_not_allowed' = ANY(NEW.violation_reasons) THEN 'unauthorized_zone'
      ELSE 'overstay'
    END;
  ELSE
    v_breach_type := NULL;
  END IF;

  -- Update the observation record
  UPDATE vehicle_observations_v2
  SET 
    is_compliant = NEW.is_compliant,
    is_breach = NOT NEW.is_compliant,
    breach_type = v_breach_type,
    breach_details = CASE 
      WHEN NOT NEW.is_compliant THEN jsonb_build_object(
        'violation_reasons', NEW.violation_reasons,
        'matrix_version', NEW.matrix_version,
        'evaluated_at', NEW.evaluated_at
      )
      ELSE NULL
    END,
    updated_at = NOW()
  WHERE observation_id = NEW.observation_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- TRIGGER: trigger_sync_observation_compliance
-- =====================================================
-- Fire AFTER INSERT OR UPDATE on compliance_results
DROP TRIGGER IF EXISTS trigger_sync_observation_compliance ON compliance_results;

CREATE TRIGGER trigger_sync_observation_compliance
  AFTER INSERT OR UPDATE ON compliance_results
  FOR EACH ROW
  EXECUTE FUNCTION sync_observation_compliance_fields();

-- =====================================================
-- BACKFILL: Sync existing observations
-- =====================================================
-- Update all observations to match their compliance_results

DO $$
DECLARE
  v_updated INT := 0;
BEGIN
  RAISE NOTICE 'Starting observation compliance field sync...';

  -- Update observations from compliance_results
  WITH updates AS (
    UPDATE vehicle_observations_v2 o
    SET 
      is_compliant = cr.is_compliant,
      is_breach = NOT cr.is_compliant,
      breach_type = CASE 
        WHEN NOT cr.is_compliant THEN
          CASE 
            WHEN 'not_self_contained' = ANY(cr.violation_reasons) THEN 'no_self_contained'
            WHEN cr.violation_reasons::TEXT LIKE '%consecutive_nights_exceeded%' THEN 'consecutive_days'
            WHEN cr.violation_reasons::TEXT LIKE '%monthly_nights_exceeded%' THEN 'nights_exceeded'
            WHEN 'day_not_allowed' = ANY(cr.violation_reasons) THEN 'unauthorized_zone'
            ELSE 'overstay'
          END
        ELSE NULL
      END,
      breach_details = CASE 
        WHEN NOT cr.is_compliant THEN jsonb_build_object(
          'violation_reasons', cr.violation_reasons,
          'matrix_version', cr.matrix_version,
          'evaluated_at', cr.evaluated_at
        )
        ELSE NULL
      END,
      updated_at = NOW()
    FROM compliance_results cr
    WHERE cr.observation_id = o.observation_id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_updated FROM updates;

  RAISE NOTICE 'Observation compliance sync complete: % records updated', v_updated;
END $$;

-- =====================================================
-- VERIFICATION
-- =====================================================
DO $$
DECLARE
  v_mismatch_count INT;
BEGIN
  -- Check for any remaining mismatches
  SELECT COUNT(*)
  INTO v_mismatch_count
  FROM vehicle_observations_v2 o
  JOIN compliance_results cr ON cr.observation_id = o.observation_id
  WHERE o.is_compliant != cr.is_compliant;

  IF v_mismatch_count > 0 THEN
    RAISE WARNING 'Found % observations with mismatched compliance status', v_mismatch_count;
  ELSE
    RAISE NOTICE 'All observations in sync with compliance_results ✓';
  END IF;
END $$;

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON FUNCTION sync_observation_compliance_fields() IS 
'Automatically updates observation compliance fields (is_compliant, is_breach, breach_type, breach_details) 
to match the authoritative compliance_results record. Ensures data consistency across tables.';

COMMENT ON TRIGGER trigger_sync_observation_compliance ON compliance_results IS 
'Keeps observation compliance fields in sync with compliance_results table automatically.';
