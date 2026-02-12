-- =====================================================
-- CLEAN ARCHITECTURE: SEPARATE DATA GATHERING FROM REPORTING
-- =====================================================
-- Purpose: Strip vehicle_observations_v2 to pure observation data
-- Remove: Duplicate vehicle details and compliance evaluation fields
-- Result: Clean separation between observation (Section 1) and compliance (Section 2)
--
-- Affected tables:
-- - vehicle_observations_v2 (stripped to essentials)
-- - compliance_results (becomes sole source of compliance data)
-- =====================================================

-- STEP 1: BACKUP EXISTING DATA
-- Create backup of current state before modification
CREATE TABLE IF NOT EXISTS vehicle_observations_v2_backup_20250213 AS 
SELECT * FROM vehicle_observations_v2;

-- STEP 2: REMOVE DUPLICATE VEHICLE DETAILS
-- These belong in canonical_vehicles, not observations
ALTER TABLE vehicle_observations_v2
  DROP COLUMN IF EXISTS vehicle_make,
  DROP COLUMN IF EXISTS vehicle_model,
  DROP COLUMN IF EXISTS vehicle_year,
  DROP COLUMN IF EXISTS vehicle_color,
  DROP COLUMN IF EXISTS self_contained,
  DROP COLUMN IF EXISTS self_contained_expiry;

-- STEP 3: REMOVE COMPLIANCE EVALUATION FIELDS
-- These belong in compliance_results, not observations
ALTER TABLE vehicle_observations_v2
  DROP COLUMN IF EXISTS is_compliant,
  DROP COLUMN IF EXISTS is_breach,
  DROP COLUMN IF EXISTS breach_type,
  DROP COLUMN IF EXISTS breach_details,
  DROP COLUMN IF EXISTS breach_detected_at,
  DROP COLUMN IF EXISTS compliance_snapshot,
  DROP COLUMN IF EXISTS breach_warning,
  DROP COLUMN IF EXISTS breach_warning_reason;

-- STEP 4: VERIFY REMAINING COLUMNS (OBSERVATION ESSENTIALS ONLY)
-- After cleanup, vehicle_observations_v2 should ONLY contain:
-- ✅ observation_id (UUID PRIMARY KEY)
-- ✅ plate_number (TEXT FK → canonical_vehicles.plate_number) - LINK ONLY
-- ✅ organization_id (UUID FK → organizations.id)
-- ✅ zone_id (UUID FK → zones.id)
-- ✅ recorded_by (UUID FK → user_profiles.id)
-- ✅ photo (TEXT) - The photo taken
-- ✅ photo_hash (TEXT) - Duplicate detection
-- ✅ gps_latitude, gps_longitude, gps_accuracy - Location
-- ✅ recorded_at (TIMESTAMPTZ) - When
-- ✅ officer_notes (TEXT) - Extra notes
-- ✅ has_notes, notes_reference_previous - Note flags
-- ✅ has_hs_incident, hs_incident_id - H&S link
-- ✅ has_incident, incident_id - Incident link
-- ✅ has_homeless_claim, homeless_claim_notes - Homeless claim
-- ✅ created_at, updated_at - Audit timestamps

COMMENT ON TABLE vehicle_observations_v2 IS 
'Pure observation data only - no vehicle details (use canonical_vehicles) or compliance results (use compliance_results)';

-- STEP 5: UPDATE EXISTING QUERIES TO USE JOINS
-- Create helper view for backward compatibility during migration
CREATE OR REPLACE VIEW vehicle_observations_with_details AS
SELECT 
  obs.observation_id,
  obs.plate_number,
  obs.organization_id,
  obs.zone_id,
  obs.recorded_by,
  obs.photo,
  obs.photo_hash,
  obs.gps_latitude,
  obs.gps_longitude,
  obs.gps_accuracy,
  obs.recorded_at,
  obs.officer_notes,
  obs.has_notes,
  obs.notes_reference_previous,
  obs.has_hs_incident,
  obs.hs_incident_id,
  obs.has_incident,
  obs.incident_id,
  obs.has_homeless_claim,
  obs.homeless_claim_notes,
  obs.created_at,
  obs.updated_at,
  -- Vehicle details from canonical_vehicles (Section 1 enrichment)
  cv.vehicle_make,
  cv.vehicle_model,
  cv.vehicle_year,
  cv.vehicle_color,
  cv.self_contained,
  cv.self_contained_expiry,
  cv.homeless_status,
  cv.is_flagged,
  cv.profile_photo,
  -- Compliance results from compliance_results (Section 2 evaluation)
  cr.is_compliant,
  cr.violation_reasons,
  cr.metrics_json,
  cr.matrix_id,
  cr.matrix_version,
  cr.evaluated_at,
  -- Zone details
  z.name AS zone_name
FROM vehicle_observations_v2 obs
LEFT JOIN canonical_vehicles cv ON obs.plate_number = cv.plate_number
LEFT JOIN compliance_results cr ON obs.observation_id = cr.observation_id
LEFT JOIN zones z ON obs.zone_id = z.id;

COMMENT ON VIEW vehicle_observations_with_details IS 
'Backward compatibility view: joins observation + canonical_vehicles + compliance_results for complete picture';

-- STEP 6: UPDATE TRIGGER TO REMOVE BREACH ALERT CREATION
-- Breach alerts should be created by compliance evaluation, not observation creation
DROP TRIGGER IF EXISTS trigger_create_breach_alert ON vehicle_observations_v2;

-- STEP 7: CREATE NEW COMPLIANCE-DRIVEN BREACH ALERT TRIGGER
-- Breach alerts triggered by compliance_results insertion, not observation
CREATE OR REPLACE FUNCTION create_breach_alert_from_compliance()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create breach alert if compliance result shows non-compliant
  IF NOT NEW.is_compliant AND array_length(NEW.violation_reasons, 1) > 0 THEN
    -- Check if vehicle is homeless (exempt from breach alerts)
    DECLARE
      v_homeless_status TEXT;
    BEGIN
      SELECT homeless_status INTO v_homeless_status
      FROM canonical_vehicles cv
      JOIN vehicle_observations_v2 obs ON obs.plate_number = cv.plate_number
      WHERE obs.observation_id = NEW.observation_id;

      -- Skip breach alert if confirmed homeless (FC Act exempt)
      IF v_homeless_status = 'confirmed' THEN
        RETURN NEW;
      END IF;

      -- Create breach alert
      INSERT INTO breach_alerts (
        observation_id,
        organization_id,
        zone_id,
        breach_type,
        breach_details,
        status
      )
      SELECT
        NEW.observation_id,
        obs.organization_id,
        obs.zone_id,
        NEW.violation_reasons[1], -- Primary violation
        jsonb_build_object(
          'violation_reasons', NEW.violation_reasons,
          'metrics', NEW.metrics_json,
          'matrix_version', NEW.matrix_version
        ),
        'pending'
      FROM vehicle_observations_v2 obs
      WHERE obs.observation_id = NEW.observation_id
      ON CONFLICT (observation_id) DO NOTHING;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_breach_alert_from_compliance
  AFTER INSERT ON compliance_results
  FOR EACH ROW
  EXECUTE FUNCTION create_breach_alert_from_compliance();

COMMENT ON FUNCTION create_breach_alert_from_compliance() IS 
'Section 2 trigger: Creates breach alerts AFTER compliance evaluation, not during observation creation';

-- STEP 8: VERIFY DATA INTEGRITY
-- Ensure all observations have corresponding canonical_vehicles records
DO $$
DECLARE
  v_orphaned_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_orphaned_count
  FROM vehicle_observations_v2 obs
  LEFT JOIN canonical_vehicles cv ON obs.plate_number = cv.plate_number
  WHERE cv.plate_number IS NULL;

  IF v_orphaned_count > 0 THEN
    RAISE WARNING 'Found % observations without canonical_vehicles records', v_orphaned_count;
  ELSE
    RAISE NOTICE 'All observations have corresponding canonical_vehicles records ✓';
  END IF;
END;
$$;

-- STEP 9: UPDATE RLS POLICIES (NO CHANGES NEEDED)
-- Existing RLS policies on vehicle_observations_v2 remain valid

-- STEP 10: REFRESH REPORTING VIEWS
-- Any materialized views depending on observation table need refresh
-- (Add specific view refreshes here if needed)

-- Final verification and summary
DO $$
BEGIN
  RAISE NOTICE '✅ Architecture cleanup complete:';
  RAISE NOTICE '   - vehicle_observations_v2 stripped to pure observation data';
  RAISE NOTICE '   - Vehicle details: use canonical_vehicles';
  RAISE NOTICE '   - Compliance results: use compliance_results';
  RAISE NOTICE '   - Backward compatibility view: vehicle_observations_with_details';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  NEXT STEPS:';
  RAISE NOTICE '   1. Update process-field-scan Edge Function to use new architecture';
  RAISE NOTICE '   2. Update frontend queries to join tables instead of reading flat columns';
  RAISE NOTICE '   3. Test compliance evaluation flow (Section 1 → Section 2 separation)';
END;
$$;
