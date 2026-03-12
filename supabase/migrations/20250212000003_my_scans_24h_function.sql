-- Function to get user's own scans from last 24 hours
-- Similar to get_org_scans_24h but for individual officer's scans

CREATE OR REPLACE FUNCTION get_my_scans_24h(
  p_user_id UUID
)
RETURNS TABLE (
  observation_id UUID,
  plate_number TEXT,
  zone_name TEXT,
  zone_id UUID,
  recorded_at TIMESTAMPTZ,
  is_breach BOOLEAN,
  is_compliant BOOLEAN,
  is_homeless BOOLEAN,
  is_flagged BOOLEAN,
  is_at_risk BOOLEAN,
  can_edit BOOLEAN,
  can_delete BOOLEAN,
  hours_remaining NUMERIC,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  photo TEXT,
  vehicle_id UUID,
  organization_id UUID,
  is_self_contained BOOLEAN,
  has_hs_issue BOOLEAN,
  prior_observations_count INTEGER,
  gps_accuracy NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_24h_ago TIMESTAMPTZ := NOW() - INTERVAL '24 hours';
BEGIN
  RETURN QUERY
  SELECT
    obs.observation_id,
    obs.plate_number,
    z.name AS zone_name,
    obs.zone_id,
    obs.recorded_at,
    COALESCE(obs.is_breach, FALSE) AS is_breach,
    COALESCE(obs.is_compliant, TRUE) AS is_compliant,
    COALESCE(cv.homeless_status != 'none', FALSE) AS is_homeless,
    COALESCE(cv.is_flagged, FALSE) AS is_flagged,
    (COALESCE(obs.is_breach, FALSE) OR COALESCE(cv.is_flagged, FALSE)) AS is_at_risk,
    -- Can edit if within 24 hours
    (obs.recorded_at >= v_24h_ago) AS can_edit,
    -- Can delete if within 24 hours
    (obs.recorded_at >= v_24h_ago) AS can_delete,
    -- Hours remaining in 24-hour window
    GREATEST(0, EXTRACT(EPOCH FROM (obs.recorded_at + INTERVAL '24 hours' - NOW())) / 3600)::NUMERIC AS hours_remaining,
    obs.vehicle_make,
    obs.vehicle_model,
    obs.vehicle_color,
    obs.photo,
    cv.plate_number AS vehicle_id, -- Use plate_number as vehicle_id for canonical lookup
    obs.organization_id,
    COALESCE(obs.self_contained, FALSE) AS is_self_contained,
    COALESCE(obs.has_hs_incident, FALSE) AS has_hs_issue,
    COALESCE(cv.total_observations, 0) - 1 AS prior_observations_count, -- Subtract current observation
    obs.gps_accuracy
  FROM observations obs
  LEFT JOIN zones z ON z.id = obs.zone_id
  LEFT JOIN canonical_vehicles cv ON cv.plate_number = obs.plate_number
  WHERE obs.recorded_by = p_user_id
    AND obs.recorded_at >= v_24h_ago
  ORDER BY obs.recorded_at DESC;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_my_scans_24h(UUID) TO authenticated;

COMMENT ON FUNCTION get_my_scans_24h IS 'Returns officer''s own vehicle scans from last 24 hours with edit/delete permissions';
