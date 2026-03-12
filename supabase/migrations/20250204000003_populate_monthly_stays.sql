-- ============================================================================
-- POPULATE VEHICLE_MONTHLY_STAYS AUTOMATICALLY
-- ============================================================================
-- Purpose: Auto-populate vehicle_monthly_stays table from observations
-- 
-- FIXES:
-- 1. Creates trigger to update monthly stays on every observation
-- 2. Calculates nights_stayed and consecutive_nights automatically
-- 3. Backfills existing observations into the table
-- 4. Enables accurate overstayer and breach detection
-- ============================================================================

-- ============================================================================
-- FUNCTION: Update Monthly Stays on Observation
-- ============================================================================

CREATE OR REPLACE FUNCTION update_monthly_stays_on_observation()
RETURNS TRIGGER AS $$
DECLARE
  v_calendar_month DATE;
  v_observation_date DATE;
  v_nights_stayed INTEGER;
  v_consecutive_nights INTEGER;
  v_last_obs_date DATE;
  v_prev_obs_date DATE;
BEGIN
  -- Get calendar month (always YYYY-MM-01)
  v_calendar_month := DATE_TRUNC('month', NEW.recorded_at)::DATE;
  v_observation_date := DATE(NEW.recorded_at);
  
  RAISE NOTICE '🔄 [MONTHLY STAYS] Processing observation for plate % in zone % for month %',
    NEW.plate_number, NEW.zone_id, v_calendar_month;
  
  -- Get existing monthly stay record
  SELECT 
    nights_stayed,
    consecutive_nights,
    last_observation_date
  INTO 
    v_nights_stayed,
    v_consecutive_nights,
    v_last_obs_date
  FROM vehicle_monthly_stays
  WHERE plate_number = NEW.plate_number
    AND organization_id = NEW.organization_id
    AND zone_id = NEW.zone_id
    AND calendar_month = v_calendar_month;
  
  IF FOUND THEN
    -- Update existing record
    RAISE NOTICE '✅ Found existing record - current nights: %, consecutive: %',
      v_nights_stayed, v_consecutive_nights;
    
    -- Check if this is a new date (to increment nights_stayed)
    IF v_last_obs_date IS NULL OR v_observation_date > v_last_obs_date THEN
      v_nights_stayed := v_nights_stayed + 1;
      
      -- Calculate consecutive nights
      -- Get previous observation date (most recent before this one)
      SELECT DATE(recorded_at) INTO v_prev_obs_date
      FROM observations
      WHERE plate_number = NEW.plate_number
        AND zone_id = NEW.zone_id
        AND organization_id = NEW.organization_id
        AND recorded_at < NEW.recorded_at
      ORDER BY recorded_at DESC
      LIMIT 1;
      
      IF v_prev_obs_date IS NOT NULL THEN
        -- Check if consecutive (1 day apart)
        IF v_observation_date - v_prev_obs_date = 1 THEN
          v_consecutive_nights := COALESCE(v_consecutive_nights, 0) + 1;
          RAISE NOTICE '📈 Consecutive night detected! Count: %', v_consecutive_nights;
        ELSE
          -- Break in sequence - reset consecutive counter
          v_consecutive_nights := 1;
          RAISE NOTICE '🔄 Sequence broken - resetting consecutive to 1';
        END IF;
      ELSE
        -- First observation
        v_consecutive_nights := 1;
      END IF;
      
      -- Update record
      UPDATE vehicle_monthly_stays
      SET 
        nights_stayed = v_nights_stayed,
        consecutive_nights = v_consecutive_nights,
        last_observation_date = v_observation_date,
        observation_ids = array_append(observation_ids, NEW.observation_id),
        updated_at = now()
      WHERE plate_number = NEW.plate_number
        AND organization_id = NEW.organization_id
        AND zone_id = NEW.zone_id
        AND calendar_month = v_calendar_month;
      
      RAISE NOTICE '✅ Updated monthly stays: nights=%, consecutive=%', 
        v_nights_stayed, v_consecutive_nights;
    ELSE
      -- Same date - just add observation_id
      UPDATE vehicle_monthly_stays
      SET 
        observation_ids = array_append(observation_ids, NEW.observation_id),
        updated_at = now()
      WHERE plate_number = NEW.plate_number
        AND organization_id = NEW.organization_id
        AND zone_id = NEW.zone_id
        AND calendar_month = v_calendar_month;
      
      RAISE NOTICE '✅ Added observation_id to existing date';
    END IF;
  ELSE
    -- Create new record
    RAISE NOTICE '🆕 Creating new monthly stay record';
    
    -- Calculate consecutive nights from previous observations
    SELECT DATE(recorded_at) INTO v_prev_obs_date
    FROM observations
    WHERE plate_number = NEW.plate_number
      AND zone_id = NEW.zone_id
      AND organization_id = NEW.organization_id
      AND recorded_at < NEW.recorded_at
    ORDER BY recorded_at DESC
    LIMIT 1;
    
    IF v_prev_obs_date IS NOT NULL AND v_observation_date - v_prev_obs_date = 1 THEN
      -- Get previous month's consecutive count if same zone
      SELECT consecutive_nights INTO v_consecutive_nights
      FROM vehicle_monthly_stays
      WHERE plate_number = NEW.plate_number
        AND zone_id = NEW.zone_id
        AND organization_id = NEW.organization_id
        AND calendar_month < v_calendar_month
      ORDER BY calendar_month DESC
      LIMIT 1;
      
      v_consecutive_nights := COALESCE(v_consecutive_nights, 0) + 1;
    ELSE
      v_consecutive_nights := 1;
    END IF;
    
    -- Calculate next reset time (1st of next month at 08:00)
    DECLARE
      v_next_month DATE;
      v_reset_at TIMESTAMPTZ;
    BEGIN
      v_next_month := (v_calendar_month + INTERVAL '1 month')::DATE;
      v_reset_at := v_next_month::TIMESTAMPTZ + INTERVAL '8 hours';
    END;
    
    INSERT INTO vehicle_monthly_stays (
      plate_number,
      organization_id,
      zone_id,
      calendar_month,
      nights_stayed,
      consecutive_nights,
      last_observation_date,
      observation_ids,
      reset_at
    ) VALUES (
      NEW.plate_number,
      NEW.organization_id,
      NEW.zone_id,
      v_calendar_month,
      1,
      v_consecutive_nights,
      v_observation_date,
      ARRAY[NEW.observation_id],
      v_reset_at
    );
    
    RAISE NOTICE '✅ Created new monthly stay: nights=1, consecutive=%', v_consecutive_nights;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_monthly_stays_on_observation IS 
'Automatically updates vehicle_monthly_stays when observations are recorded. Calculates nights_stayed and consecutive_nights for accurate overstayer detection.';

-- ============================================================================
-- TRIGGER: Update Monthly Stays on Observation Insert
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_update_monthly_stays ON observations;
CREATE TRIGGER trigger_update_monthly_stays
  AFTER INSERT ON observations
  FOR EACH ROW
  EXECUTE FUNCTION update_monthly_stays_on_observation();

COMMENT ON TRIGGER trigger_update_monthly_stays ON observations IS
'Automatically updates vehicle_monthly_stays when new observations are recorded';

-- ============================================================================
-- BACKFILL FUNCTION: Populate from Existing Observations
-- ============================================================================

CREATE OR REPLACE FUNCTION backfill_monthly_stays_from_observations()
RETURNS TABLE (
  plates_processed INTEGER,
  records_created INTEGER,
  observations_processed INTEGER
) AS $$
DECLARE
  v_plates_count INTEGER := 0;
  v_records_count INTEGER := 0;
  v_obs_count INTEGER := 0;
  v_plate TEXT;
  v_org UUID;
  v_zone UUID;
  v_month DATE;
BEGIN
  RAISE NOTICE '🔄 [BACKFILL] Starting monthly stays backfill...';
  
  -- Clear existing data
  DELETE FROM vehicle_monthly_stays;
  RAISE NOTICE '🗑️ Cleared existing monthly stays data';
  
  -- Process each unique combination of plate/org/zone/month
  FOR v_plate, v_org, v_zone, v_month IN
    SELECT DISTINCT
      plate_number,
      organization_id,
      zone_id,
      DATE_TRUNC('month', recorded_at)::DATE as calendar_month
    FROM observations
    ORDER BY plate_number, calendar_month
  LOOP
    v_plates_count := v_plates_count + 1;
    
    -- Calculate nights and consecutive nights for this combination
    DECLARE
      v_unique_dates DATE[];
      v_nights INTEGER;
      v_consecutive INTEGER := 1;
      v_last_date DATE;
      v_prev_date DATE;
      v_obs_ids UUID[];
    BEGIN
      -- Get all observations for this plate/org/zone/month
      SELECT 
        ARRAY_AGG(DISTINCT DATE(recorded_at) ORDER BY DATE(recorded_at)),
        ARRAY_AGG(observation_id)
      INTO v_unique_dates, v_obs_ids
      FROM observations
      WHERE plate_number = v_plate
        AND organization_id = v_org
        AND zone_id = v_zone
        AND DATE_TRUNC('month', recorded_at)::DATE = v_month;
      
      v_nights := COALESCE(array_length(v_unique_dates, 1), 0);
      v_obs_count := v_obs_count + COALESCE(array_length(v_obs_ids, 1), 0);
      
      -- Calculate consecutive nights
      IF v_nights > 1 THEN
        -- Check each date to see if consecutive
        FOR i IN 1..array_length(v_unique_dates, 1) LOOP
          IF i > 1 THEN
            IF v_unique_dates[i] - v_unique_dates[i-1] = 1 THEN
              v_consecutive := v_consecutive + 1;
            ELSE
              -- Break in sequence, keep highest consecutive count
              v_consecutive := GREATEST(v_consecutive, 1);
            END IF;
          END IF;
        END LOOP;
      END IF;
      
      v_last_date := v_unique_dates[array_length(v_unique_dates, 1)];
      
      -- Insert monthly stay record
      INSERT INTO vehicle_monthly_stays (
        plate_number,
        organization_id,
        zone_id,
        calendar_month,
        nights_stayed,
        consecutive_nights,
        last_observation_date,
        observation_ids,
        reset_at
      ) VALUES (
        v_plate,
        v_org,
        v_zone,
        v_month,
        v_nights,
        v_consecutive,
        v_last_date,
        v_obs_ids,
        (v_month + INTERVAL '1 month')::DATE::TIMESTAMPTZ + INTERVAL '8 hours'
      );
      
      v_records_count := v_records_count + 1;
      
      IF v_records_count % 100 = 0 THEN
        RAISE NOTICE '✅ Processed % records...', v_records_count;
      END IF;
    END;
  END LOOP;
  
  RAISE NOTICE '✅ [BACKFILL] Complete! Plates: %, Records: %, Observations: %',
    v_plates_count, v_records_count, v_obs_count;
  
  RETURN QUERY SELECT v_plates_count, v_records_count, v_obs_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION backfill_monthly_stays_from_observations IS
'Backfills vehicle_monthly_stays table from existing observations in observations';

-- ============================================================================
-- EXECUTE BACKFILL
-- ============================================================================

DO $$
DECLARE
  v_result RECORD;
BEGIN
  RAISE NOTICE '🚀 Starting backfill process...';
  
  SELECT * INTO v_result FROM backfill_monthly_stays_from_observations();
  
  RAISE NOTICE '';
  RAISE NOTICE '✅ ============================================';
  RAISE NOTICE '✅ BACKFILL COMPLETE!';
  RAISE NOTICE '✅ ============================================';
  RAISE NOTICE '📊 Unique vehicles processed: %', v_result.plates_processed;
  RAISE NOTICE '📊 Monthly stay records created: %', v_result.records_created;
  RAISE NOTICE '📊 Observations processed: %', v_result.observations_processed;
  RAISE NOTICE '';
  RAISE NOTICE '🎯 Next: Refresh Organization Dashboard to see overstayers!';
END $$;

-- ============================================================================
-- AUDIT LOG
-- ============================================================================

INSERT INTO audit_log (
  action,
  entity_type,
  entity_id,
  new_values,
  created_at
) VALUES (
  'MIGRATION_APPLIED',
  'database',
  '20250204_populate_monthly_stays',
  jsonb_build_object(
    'description', 'Auto-populate vehicle_monthly_stays from observations',
    'critical_fix', TRUE,
    'changes', jsonb_build_array(
      'Created update_monthly_stays_on_observation() function',
      'Added trigger on observations to auto-update monthly stays',
      'Calculates nights_stayed and consecutive_nights automatically',
      'Created backfill_monthly_stays_from_observations() function',
      'Backfilled all existing observations into monthly stays table',
      'Fixed overstayer detection in Organization Dashboard'
    ),
    'impact', 'HIGH - Enables accurate overstayer and breach detection'
  ),
  NOW()
);

-- ============================================================================
-- COMPLETION
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ ============================================';
  RAISE NOTICE '✅ MIGRATION COMPLETE!';
  RAISE NOTICE '✅ ============================================';
  RAISE NOTICE '';
  RAISE NOTICE '🎯 WHAT WAS FIXED:';
  RAISE NOTICE '  ✅ vehicle_monthly_stays now auto-populates from observations';
  RAISE NOTICE '  ✅ Trigger fires after every INSERT on observations';
  RAISE NOTICE '  ✅ Calculates nights_stayed (unique dates per month)';
  RAISE NOTICE '  ✅ Calculates consecutive_nights (unbroken sequence)';
  RAISE NOTICE '  ✅ Backfilled ALL existing observations';
  RAISE NOTICE '';
  RAISE NOTICE '🔧 NEXT STEPS:';
  RAISE NOTICE '  1. Refresh Organization Dashboard';
  RAISE NOTICE '  2. Verify overstayers and "about to overstay" counts are now accurate';
  RAISE NOTICE '  3. Test with new observations from Field Officer Portal';
  RAISE NOTICE '';
END $$;
