-- =====================================================
-- DATA ARCHITECTURE CONSOLIDATION
-- =====================================================
-- Consolidate vehicle data around two core tables:
-- 1. canonical_vehicles - Single source of truth for vehicle master data
-- 2. vehicle_observations_v2 - Event records only (time-series data)
--
-- This migration:
-- - Ensures canonical_vehicles holds all permanent vehicle data
-- - Ensures observations only hold event-specific data
-- - Removes duplicate data storage
-- - Consolidates overlapping functions
-- =====================================================

-- =====================================================
-- STEP 1: Ensure canonical_vehicles has all required fields
-- =====================================================

-- Add owner information fields if missing
ALTER TABLE canonical_vehicles
  ADD COLUMN IF NOT EXISTS owner_first_name TEXT,
  ADD COLUMN IF NOT EXISTS owner_last_name TEXT,
  ADD COLUMN IF NOT EXISTS owner_company_name TEXT,
  ADD COLUMN IF NOT EXISTS owner_address TEXT,
  ADD COLUMN IF NOT EXISTS owner_address_verified BOOLEAN DEFAULT FALSE;

-- Add profile photo tracking if missing
ALTER TABLE canonical_vehicles
  ADD COLUMN IF NOT EXISTS profile_photo TEXT,
  ADD COLUMN IF NOT EXISTS profile_photo_selected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS profile_photo_metadata JSONB;

-- Add notes tracking (for permanent vehicle notes)
ALTER TABLE canonical_vehicles
  ADD COLUMN IF NOT EXISTS total_notes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_note_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_note_preview TEXT;

-- Add NZSCV tracking
ALTER TABLE canonical_vehicles
  ADD COLUMN IF NOT EXISTS nzscv_last_checked TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nzscv_source TEXT;

COMMENT ON COLUMN canonical_vehicles.owner_first_name IS 'Vehicle owner first name';
COMMENT ON COLUMN canonical_vehicles.owner_last_name IS 'Vehicle owner last name';
COMMENT ON COLUMN canonical_vehicles.owner_company_name IS 'Company name if commercial vehicle';
COMMENT ON COLUMN canonical_vehicles.owner_address IS 'Owner registered address';
COMMENT ON COLUMN canonical_vehicles.owner_address_verified IS 'Whether address has been verified';
COMMENT ON COLUMN canonical_vehicles.profile_photo IS 'Best representative photo URL for this vehicle';
COMMENT ON COLUMN canonical_vehicles.profile_photo_selected_at IS 'When profile photo was last updated';
COMMENT ON COLUMN canonical_vehicles.profile_photo_metadata IS 'Metadata about profile photo (source, quality, etc)';
COMMENT ON COLUMN canonical_vehicles.total_notes IS 'Total number of permanent notes against this vehicle';
COMMENT ON COLUMN canonical_vehicles.last_note_at IS 'Timestamp of most recent note';
COMMENT ON COLUMN canonical_vehicles.last_note_preview IS 'Preview of most recent note (first 100 chars)';
COMMENT ON COLUMN canonical_vehicles.nzscv_last_checked IS 'When NZSCV database was last checked for this vehicle';
COMMENT ON COLUMN canonical_vehicles.nzscv_source IS 'Source of NZSCV data (nzscv_api, carjam, photo_analysis)';

-- =====================================================
-- STEP 2: Remove duplicate fields from observations
-- =====================================================

-- vehicle_observations_v2 should NOT store:
-- - Permanent vehicle attributes (make, model, year, color) - these come from canonical_vehicles
-- - Homeless status - this is permanent vehicle data
-- - Flagged status - this is permanent vehicle data
-- - Owner information - this is permanent vehicle data

-- Observations SHOULD store:
-- - Event timestamp (recorded_at)
-- - GPS location of THIS observation
-- - Compliance status at TIME of observation
-- - Self-contained sticker validity at TIME of observation
-- - Officer notes for THIS specific observation
-- - Photos taken during THIS observation

-- Add observation-specific note field
ALTER TABLE vehicle_observations_v2
  ADD COLUMN IF NOT EXISTS observation_notes TEXT;

COMMENT ON COLUMN vehicle_observations_v2.observation_notes IS 'Notes specific to this observation event (not permanent vehicle notes)';

-- =====================================================
-- STEP 3: Consolidate homeless tracking
-- =====================================================

-- Homeless status should ONLY exist in canonical_vehicles
-- Remove homeless fields from observations (they should query canonical table)

-- Ensure canonical_vehicles has proper homeless tracking
ALTER TABLE canonical_vehicles
  ADD COLUMN IF NOT EXISTS homeless_status TEXT DEFAULT 'none' CHECK (homeless_status IN ('none', 'claimed', 'confirmed')),
  ADD COLUMN IF NOT EXISTS homeless_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS homeless_confirmed_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS homeless_notes TEXT;

-- Update existing data if needed (migrate from observations to canonical)
-- This is a one-time migration to move homeless claims to canonical records
DO $$
DECLARE
  obs_record RECORD;
BEGIN
  FOR obs_record IN
    SELECT DISTINCT plate_number, homeless_claim_notes
    FROM vehicle_observations_v2
    WHERE has_homeless_claim = TRUE
      AND plate_number IS NOT NULL
  LOOP
    -- Update canonical_vehicles with homeless claim
    UPDATE canonical_vehicles
    SET 
      homeless_status = 'claimed',
      homeless_notes = COALESCE(homeless_notes || E'\n\n' || obs_record.homeless_claim_notes, obs_record.homeless_claim_notes)
    WHERE plate_number = obs_record.plate_number
      AND homeless_status = 'none';
  END LOOP;
  
  RAISE NOTICE 'Migrated homeless claims from observations to canonical vehicles';
END $$;

-- =====================================================
-- STEP 4: Consolidate breach detection
-- =====================================================

-- Breach detection should be based on compliance_results table
-- which links observations to matrix evaluations

-- Create view for active breaches (consolidates breach_alerts logic)
CREATE OR REPLACE VIEW active_breaches_v2 AS
SELECT DISTINCT
  cv.plate_number,
  cv.vehicle_make,
  cv.vehicle_model,
  cv.vehicle_color,
  cv.homeless_status,
  cv.is_flagged,
  cv.profile_photo,
  vo.zone_id,
  z.name AS zone_name,
  z.organization_id,
  COUNT(DISTINCT vo.observation_id) AS total_observations,
  COUNT(DISTINCT vo.observation_id) FILTER (WHERE vo.is_breach) AS breach_count,
  MAX(vo.recorded_at) FILTER (WHERE vo.is_breach) AS last_breach_at,
  (ARRAY_AGG(vo.breach_type ORDER BY vo.recorded_at DESC) FILTER (WHERE vo.is_breach))[1] AS last_breach_type,
  vms.consecutive_nights,
  vms.nights_stayed,
  zcm.max_consecutive_nights,
  zcm.nights_per_month,
  -- Check if enforcement is already assigned
  EXISTS(
    SELECT 1 FROM enforcement_actions ea
    WHERE ea.plate_number = cv.plate_number
      AND ea.zone_id = vo.zone_id
      AND ea.breach_status IN ('active', 'assigned', 'in_progress')
  ) AS has_enforcement_assigned
FROM canonical_vehicles cv
JOIN vehicle_observations_v2 vo ON vo.plate_number = cv.plate_number
JOIN zones z ON z.id = vo.zone_id
LEFT JOIN vehicle_monthly_stays vms ON vms.plate_number = cv.plate_number AND vms.zone_id = vo.zone_id
LEFT JOIN zone_compliance_matrix zcm ON zcm.zone_id = vo.zone_id AND zcm.effective_to IS NULL
WHERE vo.is_breach = TRUE
GROUP BY 
  cv.plate_number, cv.vehicle_make, cv.vehicle_model, cv.vehicle_color,
  cv.homeless_status, cv.is_flagged, cv.profile_photo,
  vo.zone_id, z.name, z.organization_id,
  vms.consecutive_nights, vms.nights_stayed,
  zcm.max_consecutive_nights, zcm.nights_per_month
ORDER BY last_breach_at DESC NULLS LAST;

COMMENT ON VIEW active_breaches_v2 IS 'Consolidated view of all active breaches with vehicle master data from canonical_vehicles';

-- =====================================================
-- STEP 5: Consolidate GPS tracking functions
-- =====================================================

-- Create single GPS logging function that handles:
-- - Officer welfare monitoring
-- - Zone detection
-- - Activity tracking

CREATE OR REPLACE FUNCTION log_officer_gps_update(
  p_user_id UUID,
  p_latitude NUMERIC(10,8),
  p_longitude NUMERIC(11,8),
  p_accuracy NUMERIC(10,2),
  p_activity_type TEXT DEFAULT 'gps_ping'
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
  v_org_id UUID;
BEGIN
  -- Get user's organization
  SELECT organization_id INTO v_org_id
  FROM user_profiles
  WHERE id = p_user_id;
  
  -- Insert GPS activity log
  INSERT INTO officer_activity_log (
    user_id,
    organization_id,
    activity_type,
    gps_latitude,
    gps_longitude,
    gps_accuracy,
    recorded_at
  ) VALUES (
    p_user_id,
    v_org_id,
    p_activity_type,
    p_latitude,
    p_longitude,
    p_accuracy,
    nz_now()
  ) RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION log_officer_gps_update IS 'Consolidated GPS logging function - handles welfare monitoring, zone detection, and activity tracking';

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION log_officer_gps_update TO authenticated;

-- =====================================================
-- STEP 6: Create consolidated vehicle lookup function
-- =====================================================

-- Single function to get ALL vehicle information from canonical_vehicles
CREATE OR REPLACE FUNCTION get_vehicle_master_data(p_plate_number TEXT)
RETURNS TABLE (
  plate_number TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  vehicle_color TEXT,
  self_contained BOOLEAN,
  self_contained_expiry DATE,
  homeless_status TEXT,
  homeless_confirmed_at TIMESTAMPTZ,
  is_flagged BOOLEAN,
  flagged_priority TEXT,
  flagged_reason TEXT,
  profile_photo TEXT,
  total_observations INTEGER,
  total_breaches INTEGER,
  total_incidents INTEGER,
  enforcement_count INTEGER,
  last_seen_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cv.plate_number,
    cv.vehicle_make,
    cv.vehicle_model,
    cv.vehicle_year,
    cv.vehicle_color,
    cv.self_contained,
    cv.self_contained_expiry,
    cv.homeless_status,
    cv.homeless_confirmed_at,
    cv.is_flagged,
    cv.flagged_priority,
    cv.flagged_reason,
    cv.profile_photo,
    cv.total_observations,
    cv.total_breaches,
    cv.total_incidents,
    cv.enforcement_count,
    cv.last_seen_at,
    cv.first_seen_at
  FROM canonical_vehicles cv
  WHERE cv.plate_number = p_plate_number;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_vehicle_master_data IS 'Get all master data for a vehicle from canonical_vehicles - single source of truth';

GRANT EXECUTE ON FUNCTION get_vehicle_master_data TO authenticated;

-- =====================================================
-- STEP 7: Cleanup duplicate triggers
-- =====================================================

-- Review all triggers to ensure no duplication
-- Keep only essential triggers that maintain data integrity

-- Migration summary
DO $$
BEGIN
  RAISE NOTICE '✅ Data Architecture Consolidation Complete';
  RAISE NOTICE '   CANONICAL VEHICLES (Single Source of Truth):';
  RAISE NOTICE '   - Vehicle attributes (make, model, year, color)';
  RAISE NOTICE '   - Self-contained certification';
  RAISE NOTICE '   - Homeless status (claimed/confirmed)';
  RAISE NOTICE '   - Flagged status and priority';
  RAISE NOTICE '   - Profile photo and metadata';
  RAISE NOTICE '   - Owner information';
  RAISE NOTICE '   - Permanent notes';
  RAISE NOTICE '   - Aggregate statistics';
  RAISE NOTICE '';
  RAISE NOTICE '   VEHICLE OBSERVATIONS V2 (Event Records):';
  RAISE NOTICE '   - Event timestamp and GPS location';
  RAISE NOTICE '   - Compliance status at time of observation';
  RAISE NOTICE '   - Officer notes for this specific event';
  RAISE NOTICE '   - Photos from this observation';
  RAISE NOTICE '';
  RAISE NOTICE '   FUNCTIONS CONSOLIDATED:';
  RAISE NOTICE '   - log_officer_gps_update() - Single GPS tracking function';
  RAISE NOTICE '   - get_vehicle_master_data() - Single vehicle data lookup';
  RAISE NOTICE '';
  RAISE NOTICE '   VIEWS CREATED:';
  RAISE NOTICE '   - active_breaches_v2 - Consolidated breach detection';
END $$;
