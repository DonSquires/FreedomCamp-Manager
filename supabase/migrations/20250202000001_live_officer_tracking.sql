-- Live Officer Tracking - SQL function to get real-time officer locations and activity

-- Function to get live officer locations with recent activity
CREATE OR REPLACE FUNCTION get_live_officer_locations()
RETURNS TABLE (
  user_id UUID,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  organization_id UUID,
  last_gps_latitude NUMERIC(10,8),
  last_gps_longitude NUMERIC(11,8),
  last_gps_accuracy NUMERIC(10,2),
  last_gps_update TIMESTAMPTZ,
  recent_scans INTEGER,
  last_scan_plate TEXT,
  last_scan_zone TEXT,
  is_active_investigation BOOLEAN,
  welfare_status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    up.id AS user_id,
    up.first_name,
    up.last_name,
    up.phone,
    up.organization_id,
    
    -- Latest GPS location
    (
      SELECT gps_latitude 
      FROM public.officer_activity_log 
      WHERE user_id = up.id 
        AND activity_type = 'gps_update' 
        AND gps_latitude IS NOT NULL
      ORDER BY recorded_at DESC 
      LIMIT 1
    ) AS last_gps_latitude,
    
    (
      SELECT gps_longitude 
      FROM public.officer_activity_log 
      WHERE user_id = up.id 
        AND activity_type = 'gps_update' 
        AND gps_longitude IS NOT NULL
      ORDER BY recorded_at DESC 
      LIMIT 1
    ) AS last_gps_longitude,
    
    (
      SELECT gps_accuracy 
      FROM public.officer_activity_log 
      WHERE user_id = up.id 
        AND activity_type = 'gps_update' 
        AND gps_latitude IS NOT NULL
      ORDER BY recorded_at DESC 
      LIMIT 1
    ) AS last_gps_accuracy,
    
    (
      SELECT recorded_at 
      FROM public.officer_activity_log 
      WHERE user_id = up.id 
        AND activity_type = 'gps_update' 
        AND gps_latitude IS NOT NULL
      ORDER BY recorded_at DESC 
      LIMIT 1
    ) AS last_gps_update,
    
    -- Recent scans (today)
    (
      SELECT COUNT(*) 
      FROM public.officer_activity_log 
      WHERE user_id = up.id 
        AND activity_type = 'vehicle_scan'
        AND recorded_at >= CURRENT_DATE
    )::INTEGER AS recent_scans,
    
    -- Last scan plate number
    (
      SELECT metadata->>'plate_number'
      FROM public.officer_activity_log 
      WHERE user_id = up.id 
        AND activity_type = 'vehicle_scan'
        AND metadata->>'plate_number' IS NOT NULL
      ORDER BY recorded_at DESC 
      LIMIT 1
    ) AS last_scan_plate,
    
    -- Last scan zone
    (
      SELECT z.name
      FROM public.officer_activity_log oal
      LEFT JOIN public.zones z ON (oal.metadata->>'zone_id')::UUID = z.id
      WHERE oal.user_id = up.id 
        AND oal.activity_type = 'vehicle_scan'
        AND oal.metadata->>'zone_id' IS NOT NULL
      ORDER BY oal.recorded_at DESC 
      LIMIT 1
    ) AS last_scan_zone,
    
    -- Active investigation status
    (
      SELECT EXISTS (
        SELECT 1 
        FROM public.investigation_jobs 
        WHERE assigned_to = up.id 
          AND status = 'in_progress'
      )
    ) AS is_active_investigation,
    
    -- Welfare alert status
    (
      SELECT 
        CASE 
          WHEN COUNT(*) > 0 THEN 'alert'
          ELSE 'ok'
        END
      FROM public.officer_welfare_alerts 
      WHERE officer_id = up.id 
        AND status = 'pending'
        AND alert_type = 'welfare_check'
    ) AS welfare_status
    
  FROM public.user_profiles up
  WHERE up.role = 'officer'
    AND up.is_active = true
  ORDER BY up.first_name, up.last_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_live_officer_locations TO authenticated, service_role;

-- Update officer_welfare_alerts to support peer-level escalation (level 0)
COMMENT ON COLUMN public.officer_welfare_alerts.escalation_level IS '0=peer notification, 1=initial admin, 2=high priority, 3=critical';

COMMENT ON FUNCTION get_live_officer_locations IS 'Returns real-time officer locations with activity summary for live tracking dashboard';
