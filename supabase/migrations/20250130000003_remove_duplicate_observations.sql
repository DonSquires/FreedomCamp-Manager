-- =====================================================
-- REMOVE DUPLICATE OBSERVATIONS
-- Migration Date: 2025-01-30
-- =====================================================
-- 
-- This migration removes duplicate vehicle observations based on:
-- - Same vehicle (vehicle_id)
-- - Same zone (zone_id)
-- - Same shift period:
--   * Day shift: 06:00-18:00
--   * Night shift: 18:00-06:00
-- 
-- Strategy:
-- 1. Create helper function to determine shift period
-- 2. Identify duplicates (keeping earliest observation)
-- 3. Delete duplicate observations
-- 4. Add partial unique constraint to prevent future duplicates
-- =====================================================

-- 1. CREATE function to determine shift period (day/night)
CREATE OR REPLACE FUNCTION get_shift_period(observation_time TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_hour INTEGER;
BEGIN
  -- Extract hour in NZ timezone
  v_hour := EXTRACT(HOUR FROM observation_time AT TIME ZONE 'Pacific/Auckland');
  
  -- Day shift: 06:00-17:59 (hours 6-17)
  -- Night shift: 18:00-05:59 (hours 18-23, 0-5)
  IF v_hour >= 6 AND v_hour < 18 THEN
    RETURN 'day';
  ELSE
    RETURN 'night';
  END IF;
END;
$$;

COMMENT ON FUNCTION get_shift_period IS 'Determines shift period (day/night) based on observation time in NZ timezone. Day: 06:00-18:00, Night: 18:00-06:00';

-- 2. IDENTIFY AND REPORT duplicates (before deletion)
DO $$
DECLARE
  v_duplicate_count INTEGER;
  v_total_duplicates INTEGER;
BEGIN
  -- Count duplicate observations
  WITH duplicate_groups AS (
    SELECT 
      vehicle_id,
      zone_id,
      DATE(recorded_at AT TIME ZONE 'Pacific/Auckland') as obs_date,
      get_shift_period(recorded_at) as shift_period,
      COUNT(*) as occurrence_count,
      ARRAY_AGG(observation_id ORDER BY recorded_at ASC) as observation_ids
    FROM vehicle_observations
    WHERE recorded_at IS NOT NULL
      AND vehicle_id IS NOT NULL
      AND zone_id IS NOT NULL
    GROUP BY 
      vehicle_id,
      zone_id,
      DATE(recorded_at AT TIME ZONE 'Pacific/Auckland'),
      get_shift_period(recorded_at)
    HAVING COUNT(*) > 1
  )
  SELECT 
    COUNT(*) as duplicate_groups,
    SUM(occurrence_count - 1) as total_duplicate_records
  INTO v_duplicate_count, v_total_duplicates
  FROM duplicate_groups;

  RAISE NOTICE '🔍 DUPLICATE ANALYSIS:';
  RAISE NOTICE '   - Duplicate groups found: %', COALESCE(v_duplicate_count, 0);
  RAISE NOTICE '   - Total duplicate records to delete: %', COALESCE(v_total_duplicates, 0);
  
  -- Log duplicate details to audit_log
  IF v_duplicate_count > 0 THEN
    INSERT INTO audit_log (
      action,
      entity_type,
      entity_id,
      old_values,
      created_at
    )
    SELECT
      'DUPLICATE_DETECTED',
      'vehicle_observations',
      dg.observation_ids[1]::TEXT,
      jsonb_build_object(
        'vehicle_id', dg.vehicle_id,
        'zone_id', dg.zone_id,
        'date', dg.obs_date,
        'shift_period', dg.shift_period,
        'duplicate_count', dg.occurrence_count,
        'observation_ids', dg.observation_ids,
        'kept_observation', dg.observation_ids[1],
        'deleted_observations', dg.observation_ids[2:]
      ),
      NOW()
    FROM (
      SELECT 
        vehicle_id,
        zone_id,
        DATE(recorded_at AT TIME ZONE 'Pacific/Auckland') as obs_date,
        get_shift_period(recorded_at) as shift_period,
        COUNT(*) as occurrence_count,
        ARRAY_AGG(observation_id ORDER BY recorded_at ASC) as observation_ids
      FROM vehicle_observations
      WHERE recorded_at IS NOT NULL
        AND vehicle_id IS NOT NULL
        AND zone_id IS NOT NULL
      GROUP BY 
        vehicle_id,
        zone_id,
        DATE(recorded_at AT TIME ZONE 'Pacific/Auckland'),
        get_shift_period(recorded_at)
      HAVING COUNT(*) > 1
    ) dg;
  END IF;
END $$;

-- 3. DELETE duplicate observations (keeping earliest in each group)
WITH duplicate_groups AS (
  SELECT 
    vehicle_id,
    zone_id,
    DATE(recorded_at AT TIME ZONE 'Pacific/Auckland') as obs_date,
    get_shift_period(recorded_at) as shift_period,
    ARRAY_AGG(observation_id ORDER BY recorded_at ASC) as observation_ids,
    COUNT(*) as occurrence_count
  FROM vehicle_observations
  WHERE recorded_at IS NOT NULL
    AND vehicle_id IS NOT NULL
    AND zone_id IS NOT NULL
  GROUP BY 
    vehicle_id,
    zone_id,
    DATE(recorded_at AT TIME ZONE 'Pacific/Auckland'),
    get_shift_period(recorded_at)
  HAVING COUNT(*) > 1
),
observations_to_delete AS (
  -- Get all observation IDs except the first (earliest) one
  SELECT 
    UNNEST(observation_ids[2:]) as observation_id
  FROM duplicate_groups
)
DELETE FROM vehicle_observations
WHERE observation_id IN (SELECT observation_id FROM observations_to_delete);

-- Report deletion results
DO $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RAISE NOTICE '✅ DEDUPLICATION COMPLETE:';
  RAISE NOTICE '   - Duplicate observations deleted: %', v_deleted_count;
  RAISE NOTICE '   - Kept earliest observation in each duplicate group';
END $$;

-- 4. CREATE partial unique index to prevent future duplicates
-- This index enforces uniqueness within the same vehicle, zone, date, and shift period
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_observation_per_shift
ON vehicle_observations (
  vehicle_id,
  zone_id,
  (DATE(recorded_at AT TIME ZONE 'Pacific/Auckland')),
  get_shift_period(recorded_at)
)
WHERE recorded_at IS NOT NULL 
  AND vehicle_id IS NOT NULL 
  AND zone_id IS NOT NULL;

COMMENT ON INDEX idx_unique_observation_per_shift IS 'Prevents duplicate observations for same vehicle in same zone during same shift period (day 06:00-18:00, night 18:00-06:00)';

-- 5. CREATE helper function to check for duplicates before insert
CREATE OR REPLACE FUNCTION check_duplicate_observation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_count INTEGER;
  v_shift_period TEXT;
  v_obs_date DATE;
BEGIN
  -- Only check if we have required fields
  IF NEW.recorded_at IS NULL OR NEW.vehicle_id IS NULL OR NEW.zone_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Determine shift period and date
  v_shift_period := get_shift_period(NEW.recorded_at);
  v_obs_date := DATE(NEW.recorded_at AT TIME ZONE 'Pacific/Auckland');

  -- Check for existing observation in same shift period
  SELECT COUNT(*)
  INTO v_existing_count
  FROM vehicle_observations
  WHERE vehicle_id = NEW.vehicle_id
    AND zone_id = NEW.zone_id
    AND DATE(recorded_at AT TIME ZONE 'Pacific/Auckland') = v_obs_date
    AND get_shift_period(recorded_at) = v_shift_period
    AND observation_id != COALESCE(NEW.observation_id, '00000000-0000-0000-0000-000000000000'::UUID);

  IF v_existing_count > 0 THEN
    RAISE WARNING 'Duplicate observation detected: Vehicle % in Zone % already observed during % shift on %',
      NEW.vehicle_id, NEW.zone_id, v_shift_period, v_obs_date;
    
    -- Log warning but allow insert (index will prevent it if truly duplicate)
    INSERT INTO audit_log (
      action,
      entity_type,
      entity_id,
      new_values,
      created_at
    ) VALUES (
      'DUPLICATE_OBSERVATION_ATTEMPT',
      'vehicle_observations',
      NEW.observation_id::TEXT,
      jsonb_build_object(
        'vehicle_id', NEW.vehicle_id,
        'zone_id', NEW.zone_id,
        'recorded_at', NEW.recorded_at,
        'shift_period', v_shift_period,
        'date', v_obs_date
      ),
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger to check for duplicates (warning only, index enforces)
DROP TRIGGER IF EXISTS trigger_check_duplicate_observation ON vehicle_observations;
CREATE TRIGGER trigger_check_duplicate_observation
BEFORE INSERT OR UPDATE ON vehicle_observations
FOR EACH ROW
EXECUTE FUNCTION check_duplicate_observation();

COMMENT ON TRIGGER trigger_check_duplicate_observation ON vehicle_observations IS 'Warns about potential duplicate observations before insert/update';

-- 6. AUDIT LOG
INSERT INTO audit_log (
  action,
  entity_type,
  entity_id,
  new_values,
  created_at
) VALUES (
  'MIGRATION_APPLIED',
  'database',
  '20250130_remove_duplicate_observations',
  jsonb_build_object(
    'description', 'Removed duplicate observations and added deduplication constraints',
    'changes', jsonb_build_array(
      'Created get_shift_period() function to determine day/night shifts',
      'Identified and deleted duplicate observations (kept earliest in each group)',
      'Created unique index idx_unique_observation_per_shift',
      'Added check_duplicate_observation() trigger for future prevention',
      'Logged all duplicates to audit_log before deletion'
    ),
    'shift_periods', jsonb_build_object(
      'day', '06:00-18:00',
      'night', '18:00-06:00',
      'timezone', 'Pacific/Auckland'
    )
  ),
  NOW()
);

-- =====================================================
-- VERIFICATION QUERY (Run manually to verify no duplicates remain)
-- =====================================================
-- 
-- SELECT 
--   vehicle_id,
--   zone_id,
--   DATE(recorded_at AT TIME ZONE 'Pacific/Auckland') as obs_date,
--   get_shift_period(recorded_at) as shift_period,
--   COUNT(*) as occurrence_count,
--   ARRAY_AGG(observation_id ORDER BY recorded_at ASC) as observation_ids
-- FROM vehicle_observations
-- WHERE recorded_at IS NOT NULL
--   AND vehicle_id IS NOT NULL
--   AND zone_id IS NOT NULL
-- GROUP BY 
--   vehicle_id,
--   zone_id,
--   DATE(recorded_at AT TIME ZONE 'Pacific/Auckland'),
--   get_shift_period(recorded_at)
-- HAVING COUNT(*) > 1;
-- 
-- (Should return 0 rows if deduplication successful)
-- =====================================================

-- =====================================================
-- END OF MIGRATION
-- =====================================================
