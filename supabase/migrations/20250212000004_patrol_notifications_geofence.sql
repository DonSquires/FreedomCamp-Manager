-- =====================================================
-- PATROL NOTIFICATIONS & GEOFENCE AUTO CHECK-IN
-- =====================================================
-- Enable patrol assignment notifications and geofence-based auto check-in/out
-- =====================================================

-- =====================================================
-- STEP 1: Add notification fields to patrols table
-- =====================================================

ALTER TABLE patrols
  ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS officer_accepted BOOLEAN,
  ADD COLUMN IF NOT EXISTS officer_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS officer_declined BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS officer_decline_reason TEXT,
  ADD COLUMN IF NOT EXISTS auto_checkin_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS geofence_radius INTEGER DEFAULT 100;

COMMENT ON COLUMN patrols.notification_sent IS 'Whether push notification was sent to officer';
COMMENT ON COLUMN patrols.notification_sent_at IS 'When notification was sent';
COMMENT ON COLUMN patrols.officer_accepted IS 'Whether officer accepted the patrol (null = pending)';
COMMENT ON COLUMN patrols.officer_accepted_at IS 'When officer accepted';
COMMENT ON COLUMN patrols.officer_declined IS 'Whether officer declined';
COMMENT ON COLUMN patrols.officer_decline_reason IS 'Reason for declining';
COMMENT ON COLUMN patrols.auto_checkin_enabled IS 'Enable automatic check-in via geofence';
COMMENT ON COLUMN patrols.geofence_radius IS 'Geofence radius in meters for auto check-in (default 100m)';

-- Index for finding pending notifications
CREATE INDEX IF NOT EXISTS idx_patrols_notification_pending 
  ON patrols(assigned_to, notification_sent, patrol_date) 
  WHERE notification_sent = FALSE AND assigned_to IS NOT NULL;

-- Index for accepted patrols
CREATE INDEX IF NOT EXISTS idx_patrols_accepted 
  ON patrols(assigned_to, officer_accepted, patrol_date) 
  WHERE officer_accepted = TRUE;

-- =====================================================
-- STEP 2: Patrol notification trigger function
-- =====================================================

CREATE OR REPLACE FUNCTION notify_patrol_assignment()
RETURNS TRIGGER AS $$
DECLARE
  v_zone_name TEXT;
  v_officer_name TEXT;
BEGIN
  -- Only notify when patrol is assigned (not updated)
  IF (TG_OP = 'INSERT' AND NEW.assigned_to IS NOT NULL) OR
     (TG_OP = 'UPDATE' AND OLD.assigned_to IS NULL AND NEW.assigned_to IS NOT NULL) THEN
    
    -- Get zone name
    SELECT name INTO v_zone_name FROM zones WHERE id = NEW.zone_id;
    
    -- Get officer name
    SELECT first_name || ' ' || last_name INTO v_officer_name 
    FROM user_profiles WHERE id = NEW.assigned_to;
    
    -- Send push notification via Edge Function
    PERFORM send_push_via_edge_function(
      NEW.assigned_to,
      jsonb_build_object(
        'type', 'patrol_assigned',
        'title', 'New Patrol Assignment',
        'message', format('You have been assigned to patrol %s on %s (%s shift)', 
          v_zone_name,
          to_char(NEW.patrol_date, 'DD/MM/YYYY'),
          NEW.shift
        ),
        'data', jsonb_build_object(
          'patrol_id', NEW.id,
          'zone_id', NEW.zone_id,
          'zone_name', v_zone_name,
          'patrol_date', NEW.patrol_date,
          'shift', NEW.shift,
          'auto_checkin_enabled', NEW.auto_checkin_enabled
        )
      )
    );
    
    NEW.notification_sent := TRUE;
    NEW.notification_sent_at := nz_now();
    
    RAISE NOTICE 'Patrol notification sent to % for zone % on %', 
      v_officer_name, v_zone_name, NEW.patrol_date;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_notify_patrol_assignment ON patrols;
CREATE TRIGGER trigger_notify_patrol_assignment
  BEFORE INSERT OR UPDATE ON patrols
  FOR EACH ROW
  EXECUTE FUNCTION notify_patrol_assignment();

COMMENT ON TRIGGER trigger_notify_patrol_assignment ON patrols IS 'Send push notification when patrol is assigned to officer';

-- =====================================================
-- STEP 3: Helper function to get active patrols for officer
-- =====================================================

CREATE OR REPLACE FUNCTION get_officer_active_patrols(p_officer_id UUID)
RETURNS TABLE (
  patrol_id UUID,
  zone_id UUID,
  zone_name TEXT,
  patrol_date DATE,
  shift TEXT,
  auto_checkin_enabled BOOLEAN,
  geofence_radius INTEGER,
  checked_in_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT,
  zone_geometry JSONB,
  zone_center_lat NUMERIC,
  zone_center_lng NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS patrol_id,
    p.zone_id,
    z.name AS zone_name,
    p.patrol_date,
    p.shift,
    p.auto_checkin_enabled,
    p.geofence_radius,
    p.checked_in_at,
    p.completed_at,
    p.status,
    z.geometry AS zone_geometry,
    z.location_lat AS zone_center_lat,
    z.location_lng AS zone_center_lng
  FROM patrols p
  JOIN zones z ON z.id = p.zone_id
  WHERE p.assigned_to = p_officer_id
    AND p.officer_accepted = TRUE
    AND p.patrol_date = CURRENT_DATE
    AND p.status IN ('scheduled', 'in_progress')
  ORDER BY p.patrol_date, p.shift;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_officer_active_patrols IS 'Get active patrols for officer with geofence data';

GRANT EXECUTE ON FUNCTION get_officer_active_patrols TO authenticated;

-- =====================================================
-- STEP 4: Auto check-in/out functions
-- =====================================================

CREATE OR REPLACE FUNCTION patrol_auto_checkin(
  p_patrol_id UUID,
  p_gps_lat NUMERIC,
  p_gps_lng NUMERIC
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  UPDATE patrols
  SET
    checked_in_at = nz_now(),
    check_in_location_lat = p_gps_lat,
    check_in_location_lng = p_gps_lng,
    status = 'in_progress'
  WHERE id = p_patrol_id
    AND checked_in_at IS NULL
    AND auto_checkin_enabled = TRUE
  RETURNING jsonb_build_object(
    'success', TRUE,
    'patrol_id', id,
    'checked_in_at', checked_in_at,
    'message', 'Auto-signed on via geofence'
  ) INTO v_result;
  
  IF v_result IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Already checked in or auto check-in disabled');
  END IF;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION patrol_auto_checkin IS 'Auto check-in officer when entering geofence';

GRANT EXECUTE ON FUNCTION patrol_auto_checkin TO authenticated;

CREATE OR REPLACE FUNCTION patrol_auto_checkout(p_patrol_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  UPDATE patrols
  SET
    completed_at = nz_now(),
    status = 'completed'
  WHERE id = p_patrol_id
    AND checked_in_at IS NOT NULL
    AND completed_at IS NULL
  RETURNING jsonb_build_object(
    'success', TRUE,
    'patrol_id', id,
    'completed_at', completed_at,
    'message', 'Auto-signed off via geofence'
  ) INTO v_result;
  
  IF v_result IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Not checked in or already completed');
  END IF;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION patrol_auto_checkout IS 'Auto check-out officer when leaving geofence';

GRANT EXECUTE ON FUNCTION patrol_auto_checkout TO authenticated;

-- Migration summary
DO $$
BEGIN
  RAISE NOTICE '✅ Patrol Notifications & Geofence Migration Complete';
  RAISE NOTICE '   - Added notification tracking fields';
  RAISE NOTICE '   - Added officer acceptance/decline workflow fields';
  RAISE NOTICE '   - Added geofence auto check-in fields (radius: 100m default)';
  RAISE NOTICE '   - Created notify_patrol_assignment() trigger';
  RAISE NOTICE '   - Created get_officer_active_patrols() function';
  RAISE NOTICE '   - Created patrol_auto_checkin() function';
  RAISE NOTICE '   - Created patrol_auto_checkout() function';
  RAISE NOTICE '';
  RAISE NOTICE '   📱 Officer Features:';
  RAISE NOTICE '      - Push notifications on patrol assignment';
  RAISE NOTICE '      - Accept/decline workflow';
  RAISE NOTICE '      - Auto check-in when entering zone (geofence)';
  RAISE NOTICE '      - Auto check-out when leaving zone';
END $$;
