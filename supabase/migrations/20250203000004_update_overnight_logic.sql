-- ============================================================================
-- UPDATE OVERNIGHT STAY LOGIC - CALENDAR DAY BASED
-- ============================================================================
-- Purpose: Change overnight detection to use calendar day instead of midnight
--
-- NEW LOGIC:
-- - Vehicle recorded at 00:01 on Feb 2nd AND 16:30 on Feb 2nd = SAME DAY (not overnight)
-- - Vehicle recorded at 23:00 on Feb 2nd AND 00:30 on Feb 3rd = DIFFERENT DAYS (overnight)
-- - Still record all observations, just don't increment overnight counter for same-day scans
--
-- This prevents double-counting when officers scan the same vehicle multiple times
-- on the same calendar day.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Function: Check if observation is same calendar day
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_same_calendar_day(
  p_plate_number TEXT,
  p_zone_id UUID,
  p_recorded_at TIMESTAMPTZ
)
RETURNS BOOLEAN AS $$
DECLARE
  v_last_observation_date DATE;
  v_current_observation_date DATE;
BEGIN
  -- Get the date (calendar day) of the current observation
  v_current_observation_date := p_recorded_at::DATE;
  
  -- Get the date of the most recent observation for this vehicle in this zone
  SELECT recorded_at::DATE INTO v_last_observation_date
  FROM observations
  WHERE plate_number = p_plate_number
    AND zone_id = p_zone_id
    AND recorded_at < p_recorded_at
  ORDER BY recorded_at DESC
  LIMIT 1;
  
  -- If no previous observation exists, it's a new day
  IF v_last_observation_date IS NULL THEN
    RETURN false;
  END IF;
  
  -- Compare calendar days
  RETURN v_current_observation_date = v_last_observation_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- Function: Update monthly stays with calendar day logic
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_monthly_stays_calendar_day()
RETURNS TRIGGER AS $$
DECLARE
  v_calendar_month DATE;
  v_is_same_day BOOLEAN;
  v_max_consecutive INTEGER;
  v_current_nights INTEGER;
BEGIN
  -- Get the calendar month (YYYY-MM-01)
  v_calendar_month := DATE_TRUNC('month', NEW.recorded_at::DATE);
  
  -- Check if this is the same calendar day as the last observation
  v_is_same_day := is_same_calendar_day(
    NEW.plate_number,
    NEW.zone_id,
    NEW.recorded_at
  );
  
  -- If it's the same calendar day, don't increment overnight counter
  IF v_is_same_day THEN
    -- Still add observation ID to the array for audit trail
    UPDATE vehicle_monthly_stays
    SET 
      observation_ids = array_append(observation_ids, NEW.observation_id),
      updated_at = now()
    WHERE plate_number = NEW.plate_number
      AND zone_id = NEW.zone_id
      AND calendar_month = v_calendar_month;
    
    -- Log for debugging
    RAISE NOTICE 'Same calendar day observation for % in zone % - not incrementing overnight count',
      NEW.plate_number, NEW.zone_id;
    
    RETURN NEW;
  END IF;
  
  -- Different calendar day - increment overnight counter
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
  )
  VALUES (
    NEW.plate_number,
    NEW.organization_id,
    NEW.zone_id,
    v_calendar_month,
    1, -- First night
    1, -- First consecutive night
    NEW.recorded_at::DATE,
    ARRAY[NEW.observation_id],
    (v_calendar_month + INTERVAL '1 month' + INTERVAL '8 hours')::TIMESTAMPTZ
  )
  ON CONFLICT (plate_number, organization_id, zone_id, calendar_month)
  DO UPDATE SET
    nights_stayed = vehicle_monthly_stays.nights_stayed + 1,
    consecutive_nights = CASE
      -- If last observation was yesterday, increment consecutive
      WHEN (NEW.recorded_at::DATE - vehicle_monthly_stays.last_observation_date) = 1 THEN
        vehicle_monthly_stays.consecutive_nights + 1
      -- Otherwise reset consecutive counter
      ELSE
        1
    END,
    last_observation_date = NEW.recorded_at::DATE,
    observation_ids = array_append(vehicle_monthly_stays.observation_ids, NEW.observation_id),
    updated_at = now();
  
  -- Check for breach based on nights_stayed
  SELECT max_consecutive_nights INTO v_max_consecutive
  FROM zone_compliance_matrix
  WHERE zone_id = NEW.zone_id
    AND effective_to IS NULL -- Active matrix
  LIMIT 1;
  
  -- Get current nights for this vehicle
  SELECT nights_stayed INTO v_current_nights
  FROM vehicle_monthly_stays
  WHERE plate_number = NEW.plate_number
    AND zone_id = NEW.zone_id
    AND calendar_month = v_calendar_month;
  
  -- Update observation breach flags
  IF v_current_nights > COALESCE(v_max_consecutive, 3) THEN
    UPDATE observations
    SET 
      is_breach = true,
      breach_type = 'too_many_nights',
      breach_detected_at = now(),
      breach_details = jsonb_build_object(
        'nights_stayed', v_current_nights,
        'max_allowed', COALESCE(v_max_consecutive, 3),
        'calendar_month', v_calendar_month
      )
    WHERE observation_id = NEW.observation_id;
  ELSIF v_current_nights = COALESCE(v_max_consecutive, 3) THEN
    -- About to breach - set warning
    UPDATE observations
    SET 
      breach_warning = true,
      breach_warning_reason = 'Will breach if vehicle stays tonight'
    WHERE observation_id = NEW.observation_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Replace trigger with new calendar day logic
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_update_monthly_stays ON observations;
CREATE TRIGGER trigger_update_monthly_stays
  AFTER INSERT ON observations
  FOR EACH ROW
  EXECUTE FUNCTION update_monthly_stays_calendar_day();

-- ----------------------------------------------------------------------------
-- Function: Get overnight stays for a vehicle (for officer notification)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_vehicle_overnight_status(
  p_plate_number TEXT,
  p_zone_id UUID
)
RETURNS TABLE (
  already_scanned_today BOOLEAN,
  nights_stayed_this_month INTEGER,
  max_consecutive_nights INTEGER,
  is_about_to_breach BOOLEAN,
  is_breach BOOLEAN
) AS $$
DECLARE
  v_calendar_month DATE;
  v_today DATE;
  v_last_observation_date DATE;
BEGIN
  v_calendar_month := DATE_TRUNC('month', CURRENT_DATE);
  v_today := CURRENT_DATE;
  
  RETURN QUERY
  SELECT 
    -- Check if already scanned today
    EXISTS (
      SELECT 1 FROM observations
      WHERE plate_number = p_plate_number
        AND zone_id = p_zone_id
        AND recorded_at::DATE = v_today
    ) as already_scanned_today,
    
    -- Get nights stayed this month
    COALESCE(ms.nights_stayed, 0) as nights_stayed_this_month,
    
    -- Get max allowed nights
    COALESCE(zcm.max_consecutive_nights, 3) as max_consecutive_nights,
    
    -- Check if about to breach
    COALESCE(ms.nights_stayed, 0) = COALESCE(zcm.max_consecutive_nights, 3) as is_about_to_breach,
    
    -- Check if already in breach
    COALESCE(ms.nights_stayed, 0) > COALESCE(zcm.max_consecutive_nights, 3) as is_breach
  FROM vehicle_monthly_stays ms
  LEFT JOIN zone_compliance_matrix zcm ON zcm.zone_id = p_zone_id AND zcm.effective_to IS NULL
  WHERE ms.plate_number = p_plate_number
    AND ms.zone_id = p_zone_id
    AND ms.calendar_month = v_calendar_month;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- Grant permissions
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION is_same_calendar_day(TEXT, UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION get_vehicle_overnight_status(TEXT, UUID) TO authenticated;

-- ============================================================================
-- COMPLETION SUMMARY
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Overnight Stay Logic Updated!';
  RAISE NOTICE '';
  RAISE NOTICE '📋 CHANGES MADE:';
  RAISE NOTICE '  1. Calendar day logic: Same-day scans no longer count as overnight';
  RAISE NOTICE '  2. is_same_calendar_day() function checks if observation is same calendar day';
  RAISE NOTICE '  3. update_monthly_stays_calendar_day() only increments overnight counter for new days';
  RAISE NOTICE '  4. get_vehicle_overnight_status() helps officers know if vehicle already scanned today';
  RAISE NOTICE '';
  RAISE NOTICE '🎯 EXAMPLE SCENARIOS:';
  RAISE NOTICE '  ❌ OLD: Vehicle at 00:01 Feb 2 + 16:30 Feb 2 = 2 nights (WRONG)';
  RAISE NOTICE '  ✅ NEW: Vehicle at 00:01 Feb 2 + 16:30 Feb 2 = SAME DAY (not overnight)';
  RAISE NOTICE '';
  RAISE NOTICE '  ✅ Vehicle at 23:00 Feb 2 + 00:30 Feb 3 = DIFFERENT DAYS (overnight)';
  RAISE NOTICE '';
  RAISE NOTICE '🔧 NEXT STEPS:';
  RAISE NOTICE '  1. Update mobile app to call get_vehicle_overnight_status() before submitting';
  RAISE NOTICE '  2. Show "Already scanned today" warning if already_scanned_today = true';
  RAISE NOTICE '  3. Test with same-day multiple scans to verify no overnight increment';
END $$;
