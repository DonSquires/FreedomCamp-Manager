-- ============================================
-- EMERGENCY DATA RECOVERY SCRIPT
-- ============================================
-- PURPOSE: Recover deleted observations from vehicle_monthly_stays table
-- SOURCE: observation_ids array in vehicle_monthly_stays
-- TARGET: vehicle_observations_v2
-- 
-- WHAT THIS RECOVERS:
--   ✅ Observation UUIDs (maintains referential integrity)
--   ✅ Plate numbers
--   ✅ Zone associations
--   ✅ Organization IDs
--   ✅ Approximate timestamps (calendar month)
-- 
-- WHAT IS LOST FOREVER:
--   ❌ Exact GPS coordinates
--   ❌ Photos and evidence
--   ❌ Officer notes
--   ❌ Exact scan timestamps (only month known)
--   ❌ GPS accuracy data
--   ❌ Patrol session references
-- ============================================

-- Step 1: Create temporary table to unnest observation_ids
CREATE TEMP TABLE temp_recovered_observations AS
SELECT 
  unnest(observation_ids) AS observation_id,
  plate_number,
  organization_id,
  zone_id,
  calendar_month,
  last_observation_date,
  nights_stayed,
  consecutive_nights,
  created_at as monthly_stay_created_at
FROM vehicle_monthly_stays
WHERE observation_ids IS NOT NULL 
  AND array_length(observation_ids, 1) > 0;

-- Step 2: Check how many unique observations we can recover
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(DISTINCT observation_id) INTO v_count
  FROM temp_recovered_observations;
  
  RAISE NOTICE '📊 RECOVERY ANALYSIS: Found % unique observation IDs to recover', v_count;
END $$;

-- Step 3: Insert recovered observations into vehicle_observations_v2
-- Use UPSERT (ON CONFLICT DO NOTHING) to avoid duplicates
INSERT INTO vehicle_observations_v2 (
  observation_id,
  plate_number,
  organization_id,
  zone_id,
  recorded_at,
  recorded_by,
  photo,
  photo_hash,
  gps_latitude,
  gps_longitude,
  gps_accuracy,
  officer_notes,
  has_notes,
  has_hs_incident,
  has_incident,
  has_homeless_claim,
  created_at,
  updated_at
)
SELECT DISTINCT ON (tro.observation_id)
  tro.observation_id,
  tro.plate_number,
  tro.organization_id,
  tro.zone_id,
  
  -- Use last_observation_date if available, otherwise calendar_month (first day of month)
  COALESCE(
    tro.last_observation_date::timestamp with time zone,
    (tro.calendar_month || '-01')::timestamp with time zone
  ) AS recorded_at,
  
  NULL AS recorded_by,  -- Lost - officer unknown
  NULL AS photo,        -- Lost - photos deleted
  NULL AS photo_hash,   -- Lost
  NULL AS gps_latitude, -- Lost
  NULL AS gps_longitude,-- Lost
  NULL AS gps_accuracy, -- Lost
  
  -- Add recovery note
  '⚠️ RECOVERED DATA: This observation was reconstructed from vehicle_monthly_stays. GPS, photos, and officer notes were lost.' AS officer_notes,
  true AS has_notes,
  false AS has_hs_incident,
  false AS has_incident,
  false AS has_homeless_claim,
  
  NOW() AS created_at,
  NOW() AS updated_at
FROM temp_recovered_observations tro
ON CONFLICT (observation_id) DO NOTHING;

-- Step 4: Report recovery statistics
DO $$
DECLARE
  v_recovered INTEGER;
  v_total_available INTEGER;
BEGIN
  -- Count how many were successfully inserted
  SELECT COUNT(*) INTO v_recovered
  FROM vehicle_observations_v2
  WHERE officer_notes LIKE '%RECOVERED DATA%';
  
  -- Count total available for recovery
  SELECT COUNT(DISTINCT observation_id) INTO v_total_available
  FROM temp_recovered_observations;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ RECOVERY COMPLETE';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Total observation IDs found:  %', v_total_available;
  RAISE NOTICE 'Successfully recovered:        %', v_recovered;
  RAISE NOTICE 'Duplicates skipped:            %', (v_total_available - v_recovered);
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  WARNING: Recovered observations have:';
  RAISE NOTICE '   ❌ No GPS coordinates';
  RAISE NOTICE '   ❌ No photos or evidence';
  RAISE NOTICE '   ❌ No officer notes';
  RAISE NOTICE '   ❌ Approximate timestamps only';
  RAISE NOTICE '========================================';
END $$;

-- Step 5: Update canonical_vehicles to reflect recovered observations
-- This re-syncs the aggregate counts
DO $$
DECLARE
  v_vehicles_updated INTEGER := 0;
BEGIN
  -- Update total_observations count for affected vehicles
  WITH obs_counts AS (
    SELECT 
      plate_number,
      COUNT(*) as obs_count,
      MIN(recorded_at) as first_obs,
      MAX(recorded_at) as last_obs
    FROM vehicle_observations_v2
    GROUP BY plate_number
  )
  UPDATE canonical_vehicles cv
  SET 
    total_observations = oc.obs_count,
    first_seen_at = oc.first_obs,
    last_seen_at = oc.last_obs,
    updated_at = NOW()
  FROM obs_counts oc
  WHERE cv.plate_number = oc.plate_number;
  
  GET DIAGNOSTICS v_vehicles_updated = ROW_COUNT;
  
  RAISE NOTICE '';
  RAISE NOTICE '📊 Updated % canonical vehicle records with new observation counts', v_vehicles_updated;
END $$;

-- Step 6: Cleanup temporary table
DROP TABLE temp_recovered_observations;

-- Step 7: Final verification
DO $$
DECLARE
  v_obs_count INTEGER;
  v_canonical_count INTEGER;
  v_monthly_stays_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_obs_count FROM vehicle_observations_v2;
  SELECT COUNT(*) INTO v_canonical_count FROM canonical_vehicles;
  SELECT COUNT(*) INTO v_monthly_stays_count FROM vehicle_monthly_stays;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '📊 FINAL DATABASE STATE';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'vehicle_observations_v2:      % records', v_obs_count;
  RAISE NOTICE 'canonical_vehicles:           % records', v_canonical_count;
  RAISE NOTICE 'vehicle_monthly_stays:        % records', v_monthly_stays_count;
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE '✅ RECOVERY SCRIPT COMPLETED SUCCESSFULLY';
  RAISE NOTICE '';
  RAISE NOTICE 'NEXT STEPS:';
  RAISE NOTICE '1. Verify observations appear in Vehicle Records page';
  RAISE NOTICE '2. Run compliance recalculation to rebuild compliance_results';
  RAISE NOTICE '3. Test cleanup-and-recalculate on a specific zone';
  RAISE NOTICE '4. Monitor for any data integrity issues';
  RAISE NOTICE '';
END $$;
