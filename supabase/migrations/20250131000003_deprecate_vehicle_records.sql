-- =====================================================
-- DEPRECATE vehicle_records TABLE - CONSOLIDATE TO CANONICAL SYSTEM
-- Migration Date: 2025-01-31
-- =====================================================
-- 
-- CRITICAL REFACTORING: Eliminates table duplication by deprecating
-- vehicle_records and consolidating all data into vehicle_observations
--
-- ARCHITECTURE CHANGE:
-- - vehicle_records (legacy patrol-based) → DEPRECATED
-- - vehicle_observations (canonical system) → ENHANCED & ONLY SOURCE OF TRUTH
-- - All vehicle data flows through canonical_vehicles → vehicle_observations
--
-- KEY ENHANCEMENTS TO vehicle_observations:
-- 1. Added direct vehicle details (make, model, color, year) for redundancy
-- 2. Added incident/investigation linking
-- 3. Added behavioral flags and followup tracking
-- 4. Added homeless status tracking
-- 5. Enhanced photo metadata with hashing
-- 6. Comprehensive compliance tracking
-- =====================================================

-- =====================================================
-- STEP 1: ENHANCE vehicle_observations TABLE
-- Add all fields from vehicle_records to eliminate dependency
-- =====================================================

-- Vehicle details (redundant with canonical_vehicles for performance)
ALTER TABLE vehicle_observations 
ADD COLUMN IF NOT EXISTS vehicle_make TEXT,
ADD COLUMN IF NOT EXISTS vehicle_model TEXT,
ADD COLUMN IF NOT EXISTS vehicle_color TEXT,
ADD COLUMN IF NOT EXISTS vehicle_year TEXT;

-- Plate input method (ALPR vs manual vs OCR)
ALTER TABLE vehicle_observations 
ADD COLUMN IF NOT EXISTS plate_input_method TEXT;

-- Homeless status tracking
ALTER TABLE vehicle_observations 
ADD COLUMN IF NOT EXISTS homeless_claimed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS homeless_confirmed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS homeless_confirmed_by UUID REFERENCES user_profiles(id),
ADD COLUMN IF NOT EXISTS homeless_confirmed_at TIMESTAMPTZ;

-- Behavioral flags and followup tracking
ALTER TABLE vehicle_observations 
ADD COLUMN IF NOT EXISTS behavioral_flags JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS requires_followup BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS followup_reason TEXT,
ADD COLUMN IF NOT EXISTS followup_priority TEXT CHECK (followup_priority IN ('low', 'medium', 'high', 'urgent')),
ADD COLUMN IF NOT EXISTS followup_resolved BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS followup_resolved_by UUID REFERENCES user_profiles(id),
ADD COLUMN IF NOT EXISTS followup_resolved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS followup_resolution_notes TEXT;

-- Incident and investigation linking
ALTER TABLE vehicle_observations 
ADD COLUMN IF NOT EXISTS incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS investigation_job_id UUID REFERENCES investigation_jobs(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS health_safety_report_id UUID REFERENCES health_safety_reports(id) ON DELETE SET NULL;

-- Weather and environmental conditions
ALTER TABLE vehicle_observations 
ADD COLUMN IF NOT EXISTS weather_conditions TEXT;

-- Photo metadata with hashing for court evidence
ALTER TABLE vehicle_observations 
ADD COLUMN IF NOT EXISTS photo_hashes TEXT[],
ADD COLUMN IF NOT EXISTS photo_metadata_ids UUID[];

-- Enhanced compliance tracking
ALTER TABLE vehicle_observations 
ADD COLUMN IF NOT EXISTS compliance_checked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS compliance_matrix_version INTEGER;

-- Evidence timestamp for court proceedings
ALTER TABLE vehicle_observations 
ADD COLUMN IF NOT EXISTS evidence_timestamp TIMESTAMPTZ DEFAULT NOW();

-- Comments
COMMENT ON COLUMN vehicle_observations.vehicle_make IS 'Vehicle make - redundant with canonical_vehicles for query performance';
COMMENT ON COLUMN vehicle_observations.vehicle_model IS 'Vehicle model - redundant with canonical_vehicles for query performance';
COMMENT ON COLUMN vehicle_observations.vehicle_color IS 'Vehicle color - redundant with canonical_vehicles for query performance';
COMMENT ON COLUMN vehicle_observations.vehicle_year IS 'Vehicle year from ALPR or manual entry';
COMMENT ON COLUMN vehicle_observations.plate_input_method IS 'How plate was captured: alpr, manual, ocr, scan';
COMMENT ON COLUMN vehicle_observations.homeless_claimed IS 'Vehicle owner claimed homeless status';
COMMENT ON COLUMN vehicle_observations.homeless_confirmed IS 'Admin verified homeless status';
COMMENT ON COLUMN vehicle_observations.behavioral_flags IS 'JSON array of behavioral observations for pattern tracking';
COMMENT ON COLUMN vehicle_observations.requires_followup IS 'Flags observation for admin followup action';
COMMENT ON COLUMN vehicle_observations.incident_id IS 'Links to incident report if created from this observation';
COMMENT ON COLUMN vehicle_observations.investigation_job_id IS 'Links to investigation job if created from this observation';
COMMENT ON COLUMN vehicle_observations.health_safety_report_id IS 'Links to H&S report if created from this observation';
COMMENT ON COLUMN vehicle_observations.weather_conditions IS 'Weather conditions at time of observation';
COMMENT ON COLUMN vehicle_observations.photo_hashes IS 'SHA256 hashes of evidence photos for integrity verification';
COMMENT ON COLUMN vehicle_observations.photo_metadata_ids IS 'Foreign keys to photo_metadata table for detailed tracking';
COMMENT ON COLUMN vehicle_observations.evidence_timestamp IS 'Exact timestamp for court evidence (may differ from recorded_at for GPS/time sync issues)';

-- Add indices for new columns
CREATE INDEX IF NOT EXISTS idx_vehicle_observations_incident ON vehicle_observations(incident_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_observations_investigation ON vehicle_observations(investigation_job_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_observations_hs_report ON vehicle_observations(health_safety_report_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_observations_followup ON vehicle_observations(requires_followup) WHERE requires_followup = TRUE;
CREATE INDEX IF NOT EXISTS idx_vehicle_observations_homeless ON vehicle_observations(homeless_claimed, homeless_confirmed);
CREATE INDEX IF NOT EXISTS idx_vehicle_observations_evidence_timestamp ON vehicle_observations(evidence_timestamp);

-- =====================================================
-- STEP 2: MIGRATE REMAINING DATA FROM vehicle_records
-- Transfer any unmigrated records to vehicle_observations
-- =====================================================

DO $$
DECLARE
  v_records_migrated INTEGER := 0;
  v_record RECORD;
  v_canonical_vehicle_id UUID;
  v_normalized_plate TEXT;
BEGIN
  RAISE NOTICE '🔄 Starting final migration of vehicle_records to vehicle_observations...';
  
  -- Process each unmigrated vehicle_records entry
  FOR v_record IN
    SELECT 
      vr.*,
      z.name as zone_name
    FROM vehicle_records vr
    LEFT JOIN zones z ON z.id = vr.zone_id
    WHERE NOT EXISTS (
      SELECT 1 FROM vehicle_observations vo
      WHERE vo.original_record_id = vr.id
    )
    ORDER BY vr.recorded_at ASC
  LOOP
    -- Normalize plate number
    v_normalized_plate := UPPER(TRIM(REGEXP_REPLACE(v_record.plate_number, '[^A-Z0-9]', '', 'g')));
    
    -- Get or create canonical vehicle
    SELECT vehicle_id INTO v_canonical_vehicle_id
    FROM canonical_vehicles
    WHERE plate_number = v_normalized_plate;
    
    IF v_canonical_vehicle_id IS NULL THEN
      -- Create new canonical vehicle
      INSERT INTO canonical_vehicles (
        plate_number,
        vehicle_make,
        vehicle_model,
        vehicle_color,
        first_seen_at,
        last_seen_at,
        total_observations,
        is_homeless,
        homeless_confirmed,
        homeless_confirmed_by,
        homeless_confirmed_at
      )
      VALUES (
        v_normalized_plate,
        v_record.vehicle_make,
        v_record.vehicle_model,
        v_record.vehicle_color,
        v_record.recorded_at,
        v_record.recorded_at,
        0,
        v_record.homeless_claimed OR COALESCE(v_record.homeless_confirmed, FALSE),
        COALESCE(v_record.homeless_confirmed, FALSE),
        v_record.homeless_confirmed_by,
        v_record.homeless_confirmed_at
      )
      RETURNING vehicle_id INTO v_canonical_vehicle_id;
      
      RAISE NOTICE '✅ Created canonical vehicle % for plate %', v_canonical_vehicle_id, v_normalized_plate;
    ELSE
      -- Update existing canonical vehicle with any new data
      UPDATE canonical_vehicles
      SET
        vehicle_make = COALESCE(canonical_vehicles.vehicle_make, v_record.vehicle_make),
        vehicle_model = COALESCE(canonical_vehicles.vehicle_model, v_record.vehicle_model),
        vehicle_color = COALESCE(canonical_vehicles.vehicle_color, v_record.vehicle_color),
        first_seen_at = LEAST(canonical_vehicles.first_seen_at, v_record.recorded_at),
        last_seen_at = GREATEST(canonical_vehicles.last_seen_at, v_record.recorded_at),
        is_homeless = canonical_vehicles.is_homeless OR v_record.homeless_claimed,
        homeless_confirmed = canonical_vehicles.homeless_confirmed OR COALESCE(v_record.homeless_confirmed, FALSE),
        homeless_confirmed_by = COALESCE(canonical_vehicles.homeless_confirmed_by, v_record.homeless_confirmed_by),
        homeless_confirmed_at = COALESCE(canonical_vehicles.homeless_confirmed_at, v_record.homeless_confirmed_at),
        updated_at = NOW()
      WHERE vehicle_id = v_canonical_vehicle_id;
    END IF;
    
    -- Create comprehensive observation with all enhanced fields
    INSERT INTO vehicle_observations (
      vehicle_id,
      organization_id,
      zone_id,
      recorded_by,
      recorded_at,
      source_type,
      is_self_contained,
      is_compliant,
      gps_latitude,
      gps_longitude,
      gps_accuracy,
      evidence_photos,
      notes,
      original_record_id,
      vehicle_make,
      vehicle_model,
      vehicle_color,
      plate_input_method,
      homeless_claimed,
      homeless_confirmed,
      homeless_confirmed_by,
      homeless_confirmed_at,
      behavioral_flags,
      requires_followup,
      followup_reason,
      followup_priority,
      followup_resolved,
      followup_resolved_by,
      followup_resolved_at,
      followup_resolution_notes,
      weather_conditions,
      evidence_timestamp
    )
    VALUES (
      v_canonical_vehicle_id,
      v_record.organization_id,
      v_record.zone_id,
      v_record.recorded_by,
      v_record.recorded_at,
      'migration',
      v_record.is_self_contained,
      v_record.is_compliant,
      COALESCE(v_record.gps_latitude, v_record.location_lat),
      COALESCE(v_record.gps_longitude, v_record.location_lng),
      v_record.gps_accuracy,
      v_record.evidence_photos,
      CONCAT('🔄 Migrated from vehicle_records. Zone: ', v_record.zone_name, '. ', COALESCE(v_record.notes, ''))::TEXT,
      v_record.id,
      v_record.vehicle_make,
      v_record.vehicle_model,
      v_record.vehicle_color,
      v_record.plate_input_method,
      v_record.homeless_claimed,
      COALESCE(v_record.homeless_confirmed, FALSE),
      v_record.homeless_confirmed_by,
      v_record.homeless_confirmed_at,
      COALESCE(v_record.behavioral_flags, '[]'::jsonb),
      COALESCE(v_record.requires_followup, FALSE),
      v_record.followup_reason,
      v_record.followup_priority,
      COALESCE(v_record.followup_resolved, FALSE),
      v_record.followup_resolved_by,
      v_record.followup_resolved_at,
      v_record.followup_resolution_notes,
      v_record.weather_conditions,
      v_record.recorded_at
    );
    
    v_records_migrated := v_records_migrated + 1;
  END LOOP;
  
  RAISE NOTICE '✅ Migration complete: % records migrated from vehicle_records to vehicle_observations', v_records_migrated;
END $$;

-- =====================================================
-- STEP 3: UPDATE ALL FOREIGN KEYS AND REFERENCES
-- Redirect breach_alerts and enforcement_actions to use observations
-- =====================================================

-- Add observation_id to breach_alerts
ALTER TABLE breach_alerts 
ADD COLUMN IF NOT EXISTS observation_id UUID REFERENCES vehicle_observations(observation_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_breach_alerts_observation ON breach_alerts(observation_id);

COMMENT ON COLUMN breach_alerts.observation_id IS 'Links to specific vehicle observation that triggered this breach';

-- Add observation_id to enforcement_actions
ALTER TABLE enforcement_actions 
ADD COLUMN IF NOT EXISTS observation_id UUID REFERENCES vehicle_observations(observation_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_enforcement_actions_observation ON enforcement_actions(observation_id);

COMMENT ON COLUMN enforcement_actions.observation_id IS 'Links to specific vehicle observation this action is for';

-- Migrate breach_alerts to link to observations
UPDATE breach_alerts ba
SET observation_id = vo.observation_id
FROM vehicle_observations vo
WHERE ba.vehicle_record_id IS NOT NULL
  AND vo.original_record_id = ba.vehicle_record_id
  AND ba.observation_id IS NULL;

-- Migrate enforcement_actions to link to observations
UPDATE enforcement_actions ea
SET observation_id = vo.observation_id
FROM vehicle_observations vo
WHERE ea.vehicle_record_id IS NOT NULL
  AND vo.original_record_id = ea.vehicle_record_id
  AND ea.observation_id IS NULL;

-- =====================================================
-- STEP 4: UPDATE DATABASE FUNCTIONS
-- Replace vehicle_records references with vehicle_observations
-- =====================================================

-- Drop old vehicle_records-dependent functions
DROP FUNCTION IF EXISTS get_vehicle_stay_summary(TEXT, UUID, DATE);

-- =====================================================
-- STEP 5: DEPRECATE vehicle_records TABLE
-- Rename to preserve data but prevent new usage
-- =====================================================

-- Rename table to indicate deprecation
ALTER TABLE IF EXISTS vehicle_records RENAME TO vehicle_records_deprecated_20250131;

-- Remove foreign key constraints to prevent new inserts
ALTER TABLE vehicle_records_deprecated_20250131 
DROP CONSTRAINT IF EXISTS vehicle_records_organization_id_fkey,
DROP CONSTRAINT IF EXISTS vehicle_records_zone_id_fkey,
DROP CONSTRAINT IF EXISTS vehicle_records_recorded_by_fkey,
DROP CONSTRAINT IF EXISTS vehicle_records_homeless_confirmed_by_fkey,
DROP CONSTRAINT IF EXISTS vehicle_records_followup_resolved_by_fkey;

-- Add comment explaining deprecation
COMMENT ON TABLE vehicle_records_deprecated_20250131 IS 
'⚠️ DEPRECATED - This table is no longer used. All vehicle data now flows through canonical_vehicles → vehicle_observations. 
This table is preserved for audit purposes only. 
Migration date: 2025-01-31. 
DO NOT INSERT NEW RECORDS.';

-- =====================================================
-- STEP 6: CREATE VIEW FOR BACKWARD COMPATIBILITY (TEMPORARY)
-- Allows old queries to work while code is updated
-- =====================================================

CREATE OR REPLACE VIEW vehicle_records AS
SELECT 
  vo.observation_id as id,
  vo.organization_id,
  vo.zone_id,
  cv.plate_number,
  vo.is_self_contained,
  vo.is_compliant,
  vo.recorded_at,
  vo.recorded_by,
  vo.gps_latitude as location_lat,
  vo.gps_longitude as location_lng,
  vo.notes,
  vo.plate_input_method,
  vo.homeless_claimed,
  vo.homeless_confirmed,
  vo.homeless_confirmed_by,
  vo.homeless_confirmed_at,
  vo.vehicle_make,
  vo.vehicle_model,
  vo.vehicle_color,
  vo.behavioral_flags,
  vo.requires_followup,
  vo.followup_reason,
  vo.followup_priority,
  vo.followup_resolved,
  vo.followup_resolved_by,
  vo.followup_resolved_at,
  vo.followup_resolution_notes,
  vo.gps_accuracy,
  CASE
    WHEN vo.photo IS NULL OR btrim(vo.photo) = '' THEN '[]'::jsonb
    ELSE jsonb_build_array(vo.photo)
  END AS evidence_photos,
  vo.weather_conditions,
  vo.evidence_timestamp,
  vo.created_at
FROM vehicle_observations vo
JOIN canonical_vehicles cv ON cv.vehicle_id = vo.vehicle_id;

COMMENT ON VIEW vehicle_records IS 
'⚠️ BACKWARD COMPATIBILITY VIEW - Maps vehicle_observations to old vehicle_records structure. 
This view exists only to prevent breaking changes during migration. 
All new code should use vehicle_observations directly.
This view will be dropped in a future migration.';

-- =====================================================
-- STEP 7: UPDATE RLS POLICIES
-- Copy policies from vehicle_records to vehicle_observations
-- =====================================================

-- Enable RLS on vehicle_observations (if not already enabled)
ALTER TABLE vehicle_observations ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist
DROP POLICY IF EXISTS users_view_vehicle_observations ON vehicle_observations;
DROP POLICY IF EXISTS users_create_vehicle_observations ON vehicle_observations;
DROP POLICY IF EXISTS officers_edit_own_recent_observations ON vehicle_observations;
DROP POLICY IF EXISTS admins_edit_org_observations ON vehicle_observations;
DROP POLICY IF EXISTS admins_manage_observations ON vehicle_observations;
DROP POLICY IF EXISTS officers_view_all_plates_for_safety ON vehicle_observations;
DROP POLICY IF EXISTS super_delete_observations ON vehicle_observations;

-- View observations (org-scoped or master)
CREATE POLICY users_view_vehicle_observations ON vehicle_observations
  FOR SELECT
  TO authenticated
  USING (
    get_user_role(auth.uid()) = 'master'
    OR organization_id = get_user_organization_id(auth.uid())
  );

-- Create new observations (authenticated users)
CREATE POLICY users_create_vehicle_observations ON vehicle_observations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
    )
  );

-- Officers can edit their own recent observations (within 24 hours)
CREATE POLICY officers_edit_own_recent_observations ON vehicle_observations
  FOR UPDATE
  TO authenticated
  USING (
    recorded_by = auth.uid()
    AND created_at >= (NOW() - INTERVAL '24 hours')
  );

-- Admins can edit all org observations
CREATE POLICY admins_edit_org_observations ON vehicle_observations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'master')
        AND (
          role = 'master'
          OR organization_id = vehicle_observations.organization_id
        )
    )
  );

-- Admins can manage observations (full CRUD for admins/masters)
CREATE POLICY admins_manage_observations ON vehicle_observations
  FOR ALL
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('admin', 'master')
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- Officers can view all plates for safety (flagged vehicles awareness)
CREATE POLICY officers_view_all_plates_for_safety ON vehicle_observations
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- Super delete permission
CREATE POLICY super_delete_observations ON vehicle_observations
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND email = 'don.squire@firstsecurity.co.nz'
        AND permissions @> '["super_delete"]'::jsonb
    )
  );

-- =====================================================
-- STEP 8: AUDIT LOG
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
  '20250131_deprecate_vehicle_records',
  jsonb_build_object(
    'description', 'Deprecated vehicle_records table - consolidated to canonical vehicle_observations system',
    'critical_refactoring', TRUE,
    'breaking_change', FALSE, -- Backward compatibility view preserves old queries
    'changes', jsonb_build_array(
      'Enhanced vehicle_observations with all fields from vehicle_records',
      'Added incident/investigation linking to observations',
      'Added behavioral flags and followup tracking',
      'Added homeless status tracking per observation',
      'Added photo metadata with hashing for court evidence',
      'Added weather conditions and evidence timestamps',
      'Migrated all remaining vehicle_records to vehicle_observations',
      'Updated breach_alerts and enforcement_actions to link to observations',
      'Renamed vehicle_records to vehicle_records_deprecated_20250131',
      'Created backward compatibility view (vehicle_records)',
      'Updated RLS policies for enhanced security',
      'Dropped legacy get_vehicle_stay_summary function'
    ),
    'data_preservation', 'All data migrated and preserved in deprecated table',
    'backward_compatibility', 'View created to prevent breaking changes',
    'next_steps', jsonb_build_array(
      'Update frontend code to use vehicle_observations',
      'Update Edge Functions to use vehicle_observations',
      'Test all critical workflows',
      'Drop vehicle_records view after code migration',
      'Drop vehicle_records_deprecated_20250131 table after 90 days'
    ),
    'impact', 'HIGH - Eliminates table duplication, consolidates to single source of truth'
  ),
  NOW()
);

-- =====================================================
-- VERIFICATION QUERIES (Run these to validate migration)
-- =====================================================

-- Check unmigrated records
DO $$
DECLARE
  v_unmigrated_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_unmigrated_count
  FROM vehicle_records_deprecated_20250131 vr
  WHERE NOT EXISTS (
    SELECT 1 FROM vehicle_observations vo
    WHERE vo.original_record_id = vr.id
  );
  
  IF v_unmigrated_count > 0 THEN
    RAISE WARNING '⚠️ Found % unmigrated records in vehicle_records_deprecated_20250131', v_unmigrated_count;
  ELSE
    RAISE NOTICE '✅ All vehicle_records successfully migrated to vehicle_observations';
  END IF;
END $$;

-- Check observation counts match canonical_vehicles
DO $$
DECLARE
  v_mismatch_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_mismatch_count
  FROM canonical_vehicles cv
  WHERE cv.total_observations != (
    SELECT COUNT(*) FROM vehicle_observations vo
    WHERE vo.vehicle_id = cv.vehicle_id
  );
  
  IF v_mismatch_count > 0 THEN
    RAISE WARNING '⚠️ Found % vehicles with mismatched observation counts', v_mismatch_count;
  ELSE
    RAISE NOTICE '✅ All canonical_vehicles observation counts are accurate';
  END IF;
END $$;

-- =====================================================
-- END OF MIGRATION
-- =====================================================
