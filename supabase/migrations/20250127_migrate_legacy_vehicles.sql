-- ============================================================================
-- MIGRATION: Legacy Vehicle Records → Canonical Model
-- Purpose: Safely migrate vehicle_records to canonical_vehicles + observations
-- Affected tables: canonical_vehicles, vehicle_observations, vehicle_records
-- Author: System Migration Script
-- Date: 2025-01-27
-- ============================================================================

-- SAFETY: This migration is IDEMPOTENT and can be re-run safely
-- BACKUP: Always backup your database before running this migration!

-- ============================================================================
-- STEP 1: CREATE MIGRATION TRACKING TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.vehicle_migration_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_run_id UUID NOT NULL DEFAULT gen_random_uuid(),
  action TEXT NOT NULL, -- 'vehicle_created', 'vehicle_merged', 'observation_created'
  legacy_record_id UUID, -- vehicle_records.id
  canonical_vehicle_id UUID, -- canonical_vehicles.vehicle_id
  plate_number TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_migration_log_run ON vehicle_migration_log(migration_run_id);
CREATE INDEX IF NOT EXISTS idx_migration_log_plate ON vehicle_migration_log(plate_number);

-- ============================================================================
-- STEP 2: MIGRATION FUNCTION (WITH DRY-RUN MODE)
-- ============================================================================
CREATE OR REPLACE FUNCTION migrate_legacy_vehicles(
  p_dry_run BOOLEAN DEFAULT true,
  p_organization_id UUID DEFAULT NULL,
  p_zone_id UUID DEFAULT NULL
)
RETURNS TABLE (
  action TEXT,
  plate_number TEXT,
  vehicle_id UUID,
  observations_created INTEGER,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_migration_run_id UUID;
  v_record RECORD;
  v_canonical_vehicle_id UUID;
  v_existing_vehicle RECORD;
  v_normalized_plate TEXT;
  v_vehicles_created INTEGER := 0;
  v_vehicles_merged INTEGER := 0;
  v_observations_created INTEGER := 0;
  v_records_processed INTEGER := 0;
BEGIN
  -- Generate migration run ID
  v_migration_run_id := gen_random_uuid();
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration Mode: %', CASE WHEN p_dry_run THEN 'DRY RUN (no changes)' ELSE 'LIVE (applying changes)' END;
  RAISE NOTICE 'Run ID: %', v_migration_run_id;
  RAISE NOTICE '========================================';
  
  -- Process each vehicle_records entry
  FOR v_record IN
    SELECT 
      vr.id,
      vr.organization_id,
      vr.zone_id,
      vr.plate_number,
      vr.vehicle_make,
      vr.vehicle_model,
      vr.vehicle_color,
      vr.recorded_at,
      vr.recorded_by,
      vr.is_self_contained,
      vr.is_compliant,
      vr.gps_latitude,
      vr.gps_longitude,
      vr.gps_accuracy,
      vr.evidence_photos,
      vr.notes,
      vr.homeless_claimed,
      vr.homeless_confirmed
    FROM vehicle_records vr
    WHERE 
      (p_organization_id IS NULL OR vr.organization_id = p_organization_id)
      AND (p_zone_id IS NULL OR vr.zone_id = p_zone_id)
      -- Only process records not already migrated
      AND NOT EXISTS (
        SELECT 1 FROM vehicle_observations vo
        WHERE vo.original_record_id = vr.id
      )
    ORDER BY vr.recorded_at ASC
  LOOP
    v_records_processed := v_records_processed + 1;
    
    -- Normalize plate number
    v_normalized_plate := UPPER(TRIM(REGEXP_REPLACE(v_record.plate_number, '[^A-Z0-9]', '', 'g')));
    
    -- Check if canonical vehicle exists
    SELECT * INTO v_existing_vehicle
    FROM canonical_vehicles
    WHERE plate_number = v_normalized_plate;
    
    IF v_existing_vehicle IS NOT NULL THEN
      -- Vehicle exists - use existing ID
      v_canonical_vehicle_id := v_existing_vehicle.vehicle_id;
      v_vehicles_merged := v_vehicles_merged + 1;
      
      RETURN QUERY SELECT
        'vehicle_merged'::TEXT,
        v_normalized_plate,
        v_canonical_vehicle_id,
        0::INTEGER,
        format('Merged with existing vehicle %s', v_canonical_vehicle_id)::TEXT;
      
      -- Update existing vehicle metadata if missing
      IF NOT p_dry_run THEN
        UPDATE canonical_vehicles
        SET
          vehicle_make = COALESCE(canonical_vehicles.vehicle_make, v_record.vehicle_make),
          vehicle_model = COALESCE(canonical_vehicles.vehicle_model, v_record.vehicle_model),
          vehicle_color = COALESCE(canonical_vehicles.vehicle_color, v_record.vehicle_color),
          first_seen_at = LEAST(canonical_vehicles.first_seen_at, v_record.recorded_at),
          last_seen_at = GREATEST(canonical_vehicles.last_seen_at, v_record.recorded_at),
          updated_at = NOW()
        WHERE vehicle_id = v_canonical_vehicle_id;
      END IF;
      
    ELSE
      -- Create new canonical vehicle
      IF NOT p_dry_run THEN
        INSERT INTO canonical_vehicles (
          plate_number,
          vehicle_make,
          vehicle_model,
          vehicle_color,
          first_seen_at,
          last_seen_at,
          total_observations,
          is_homeless,
          homeless_confirmed
        )
        VALUES (
          v_normalized_plate,
          v_record.vehicle_make,
          v_record.vehicle_model,
          v_record.vehicle_color,
          v_record.recorded_at,
          v_record.recorded_at,
          0, -- Will be updated after observation created
          v_record.homeless_claimed OR v_record.homeless_confirmed,
          v_record.homeless_confirmed
        )
        RETURNING vehicle_id INTO v_canonical_vehicle_id;
      ELSE
        v_canonical_vehicle_id := gen_random_uuid(); -- Fake ID for dry run
      END IF;
      
      v_vehicles_created := v_vehicles_created + 1;
      
      RETURN QUERY SELECT
        'vehicle_created'::TEXT,
        v_normalized_plate,
        v_canonical_vehicle_id,
        0::INTEGER,
        format('Created new canonical vehicle')::TEXT;
    END IF;
    
    -- Create observation from vehicle_record
    IF NOT p_dry_run THEN
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
        original_record_id
      )
      VALUES (
        v_canonical_vehicle_id,
        v_record.organization_id,
        v_record.zone_id,
        v_record.recorded_by,
        v_record.recorded_at,
        'migration', -- Mark as migrated
        v_record.is_self_contained,
        v_record.is_compliant,
        v_record.gps_latitude,
        v_record.gps_longitude,
        v_record.gps_accuracy,
        v_record.evidence_photos,
        CONCAT('Migrated from vehicle_records.id=', v_record.id, '. ', COALESCE(v_record.notes, ''))::TEXT,
        v_record.id
      );
    END IF;
    
    v_observations_created := v_observations_created + 1;
    
    RETURN QUERY SELECT
      'observation_created'::TEXT,
      v_normalized_plate,
      v_canonical_vehicle_id,
      1::INTEGER,
      format('Created observation from legacy record %s', v_record.id)::TEXT;
    
    -- Log migration action
    IF NOT p_dry_run THEN
      INSERT INTO vehicle_migration_log (
        migration_run_id,
        action,
        legacy_record_id,
        canonical_vehicle_id,
        plate_number,
        details
      )
      VALUES (
        v_migration_run_id,
        'observation_created',
        v_record.id,
        v_canonical_vehicle_id,
        v_normalized_plate,
        jsonb_build_object(
          'organization_id', v_record.organization_id,
          'zone_id', v_record.zone_id,
          'recorded_at', v_record.recorded_at
        )
      );
    END IF;
    
  END LOOP;
  
  -- Final summary
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration Summary:';
  RAISE NOTICE 'Records Processed: %', v_records_processed;
  RAISE NOTICE 'Vehicles Created: %', v_vehicles_created;
  RAISE NOTICE 'Vehicles Merged: %', v_vehicles_merged;
  RAISE NOTICE 'Observations Created: %', v_observations_created;
  RAISE NOTICE '========================================';
  
  RETURN QUERY SELECT
    'summary'::TEXT,
    format('%s records processed', v_records_processed)::TEXT,
    NULL::UUID,
    v_observations_created::INTEGER,
    format('Created %s vehicles, merged %s existing', v_vehicles_created, v_vehicles_merged)::TEXT;
    
END;
$$;

-- ============================================================================
-- STEP 3: VALIDATION FUNCTIONS
-- ============================================================================

-- Check for duplicate plate numbers in canonical_vehicles
CREATE OR REPLACE FUNCTION check_duplicate_plates()
RETURNS TABLE (
  plate_number TEXT,
  count BIGINT,
  vehicle_ids UUID[]
)
LANGUAGE sql
AS $$
  SELECT 
    plate_number,
    COUNT(*) as count,
    ARRAY_AGG(vehicle_id) as vehicle_ids
  FROM canonical_vehicles
  GROUP BY plate_number
  HAVING COUNT(*) > 1;
$$;

-- Check for unmigrated vehicle_records
CREATE OR REPLACE FUNCTION check_unmigrated_records()
RETURNS TABLE (
  unmigrated_count BIGINT,
  oldest_record TIMESTAMPTZ,
  newest_record TIMESTAMPTZ,
  unique_plates BIGINT
)
LANGUAGE sql
AS $$
  SELECT 
    COUNT(*) as unmigrated_count,
    MIN(recorded_at) as oldest_record,
    MAX(recorded_at) as newest_record,
    COUNT(DISTINCT plate_number) as unique_plates
  FROM vehicle_records vr
  WHERE NOT EXISTS (
    SELECT 1 FROM vehicle_observations vo
    WHERE vo.original_record_id = vr.id
  );
$$;

-- Check vehicle observation counts
CREATE OR REPLACE FUNCTION validate_vehicle_stats()
RETURNS TABLE (
  vehicle_id UUID,
  plate_number TEXT,
  stored_count INTEGER,
  actual_count BIGINT,
  mismatch BOOLEAN
)
LANGUAGE sql
AS $$
  SELECT 
    cv.vehicle_id,
    cv.plate_number,
    cv.total_observations as stored_count,
    COUNT(vo.observation_id) as actual_count,
    (cv.total_observations != COUNT(vo.observation_id)) as mismatch
  FROM canonical_vehicles cv
  LEFT JOIN vehicle_observations vo ON vo.vehicle_id = cv.vehicle_id
  GROUP BY cv.vehicle_id, cv.plate_number, cv.total_observations
  HAVING cv.total_observations != COUNT(vo.observation_id);
$$;

-- ============================================================================
-- STEP 4: ROLLBACK FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION rollback_migration(p_migration_run_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_observations INTEGER;
  v_deleted_vehicles INTEGER;
BEGIN
  -- Delete observations created during this migration
  DELETE FROM vehicle_observations
  WHERE observation_id IN (
    SELECT vo.observation_id
    FROM vehicle_observations vo
    JOIN vehicle_migration_log vml ON vml.legacy_record_id = vo.original_record_id
    WHERE vml.migration_run_id = p_migration_run_id
  );
  
  GET DIAGNOSTICS v_deleted_observations = ROW_COUNT;
  
  -- Delete vehicles created during this migration (only if they have no other observations)
  DELETE FROM canonical_vehicles
  WHERE vehicle_id IN (
    SELECT vml.canonical_vehicle_id
    FROM vehicle_migration_log vml
    WHERE vml.migration_run_id = p_migration_run_id
    AND vml.action = 'vehicle_created'
    AND NOT EXISTS (
      SELECT 1 FROM vehicle_observations vo
      WHERE vo.vehicle_id = vml.canonical_vehicle_id
    )
  );
  
  GET DIAGNOSTICS v_deleted_vehicles = ROW_COUNT;
  
  -- Delete migration log entries
  DELETE FROM vehicle_migration_log
  WHERE migration_run_id = p_migration_run_id;
  
  RETURN format('Rollback complete: %s observations deleted, %s vehicles deleted', 
                v_deleted_observations, v_deleted_vehicles);
END;
$$;

-- ============================================================================
-- STEP 5: USAGE INSTRUCTIONS
-- ============================================================================

-- DRY RUN (preview changes without applying):
-- SELECT * FROM migrate_legacy_vehicles(p_dry_run := true);

-- LIVE RUN (apply changes):
-- SELECT * FROM migrate_legacy_vehicles(p_dry_run := false);

-- MIGRATE SPECIFIC ORGANIZATION:
-- SELECT * FROM migrate_legacy_vehicles(p_dry_run := false, p_organization_id := 'your-org-uuid');

-- VALIDATION CHECKS:
-- SELECT * FROM check_duplicate_plates();
-- SELECT * FROM check_unmigrated_records();
-- SELECT * FROM validate_vehicle_stats();

-- ROLLBACK (if needed):
-- SELECT rollback_migration('migration-run-id');

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON FUNCTION migrate_legacy_vehicles IS 'Migrates vehicle_records to canonical_vehicles + observations with dry-run mode';
COMMENT ON FUNCTION check_duplicate_plates IS 'Checks for duplicate plate numbers in canonical_vehicles';
COMMENT ON FUNCTION check_unmigrated_records IS 'Counts vehicle_records not yet migrated';
COMMENT ON FUNCTION validate_vehicle_stats IS 'Validates total_observations counts match actual observations';
COMMENT ON FUNCTION rollback_migration IS 'Rolls back a specific migration run by ID';
