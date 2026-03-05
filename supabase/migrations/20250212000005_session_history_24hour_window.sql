-- =====================================================
-- SESSION HISTORY 24-HOUR EDIT/DELETE WINDOW
-- =====================================================
-- Allow officers to edit/delete their own scans for 24 hours
-- Enable organization-wide view of recent scans
-- =====================================================

-- =====================================================
-- RLS POLICIES FOR 24-HOUR EDIT/DELETE
-- =====================================================

-- Officers can DELETE their own recent scans (within 24 hours)
CREATE POLICY officers_delete_recent_scans
  ON vehicle_observations_v2 FOR DELETE
  USING (
    recorded_by = auth.uid() 
    AND recorded_at >= (nz_now() - INTERVAL '24 hours')
  );

-- Officers can UPDATE their own recent scans (within 24 hours)
CREATE POLICY officers_update_recent_scans
  ON vehicle_observations_v2 FOR UPDATE
  USING (
    recorded_by = auth.uid() 
    AND recorded_at >= (nz_now() - INTERVAL '24 hours')
  )
  WITH CHECK (
    recorded_by = auth.uid() 
    AND recorded_at >= (nz_now() - INTERVAL '24 hours')
  );

COMMENT ON POLICY officers_delete_recent_scans ON vehicle_observations_v2 IS 'Officers can delete their own scans within 24 hours';
COMMENT ON POLICY officers_update_recent_scans ON vehicle_observations_v2 IS 'Officers can edit their own scans within 24 hours';

-- =====================================================
-- HELPER FUNCTION: Calculate Edit Window Remaining
-- =====================================================

CREATE OR REPLACE FUNCTION get_observation_edit_status(
  p_observation_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  can_edit BOOLEAN,
  can_delete BOOLEAN,
  hours_remaining NUMERIC,
  is_own_scan BOOLEAN
) AS $$
DECLARE
  v_observation RECORD;
  v_hours_elapsed NUMERIC;
BEGIN
  -- Get observation details
  SELECT 
    observation_id,
    recorded_by,
    recorded_at
  INTO v_observation
  FROM vehicle_observations_v2
  WHERE observation_id = p_observation_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, FALSE, 0::NUMERIC, FALSE;
    RETURN;
  END IF;
  
  -- Calculate hours elapsed
  v_hours_elapsed := EXTRACT(EPOCH FROM (nz_now() - v_observation.recorded_at)) / 3600;
  
  -- Determine permissions
  RETURN QUERY
  SELECT
    (v_observation.recorded_by = p_user_id AND v_hours_elapsed < 24) AS can_edit,
    (v_observation.recorded_by = p_user_id AND v_hours_elapsed < 24) AS can_delete,
    GREATEST(0, 24 - v_hours_elapsed) AS hours_remaining,
    (v_observation.recorded_by = p_user_id) AS is_own_scan;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_observation_edit_status IS 'Returns edit/delete permissions and time remaining for an observation';

GRANT EXECUTE ON FUNCTION get_observation_edit_status TO authenticated;

-- =====================================================
-- HELPER FUNCTION: Get Organization Scans (24h)
-- =====================================================

CREATE OR REPLACE FUNCTION get_org_scans_24h(
  p_user_id UUID,
  p_filter_breaches BOOLEAN DEFAULT FALSE,
  p_filter_homeless BOOLEAN DEFAULT FALSE,
  p_filter_at_risk BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  observation_id UUID,
  plate_number TEXT,
  zone_id UUID,
  zone_name TEXT,
  recorded_at TIMESTAMPTZ,
  recorded_by UUID,
  officer_name TEXT,
  is_breach BOOLEAN,
  is_compliant BOOLEAN,
  is_homeless BOOLEAN,
  is_flagged BOOLEAN,
  is_at_risk BOOLEAN,
  is_own_scan BOOLEAN,
  can_edit BOOLEAN,
  can_delete BOOLEAN,
  hours_remaining NUMERIC,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  photo TEXT,
  gps_latitude NUMERIC,
  gps_longitude NUMERIC
) AS $$
DECLARE
  v_org_id UUID;
  v_hours_elapsed NUMERIC;
BEGIN
  -- Get user's organization
  SELECT organization_id INTO v_org_id
  FROM user_profiles
  WHERE id = p_user_id;
  
  RETURN QUERY
  SELECT
    vo.observation_id,
    vo.plate_number,
    vo.zone_id,
    z.name AS zone_name,
    vo.recorded_at,
    vo.recorded_by,
    up.first_name || ' ' || up.last_name AS officer_name,
    vo.is_breach,
    vo.is_compliant,
    (cv.homeless_status = 'confirmed') AS is_homeless,
    cv.is_flagged,
    (cv.is_flagged OR vo.is_breach) AS is_at_risk,
    (vo.recorded_by = p_user_id) AS is_own_scan,
    (vo.recorded_by = p_user_id AND EXTRACT(EPOCH FROM (nz_now() - vo.recorded_at)) / 3600 < 24) AS can_edit,
    (vo.recorded_by = p_user_id AND EXTRACT(EPOCH FROM (nz_now() - vo.recorded_at)) / 3600 < 24) AS can_delete,
    GREATEST(0, 24 - EXTRACT(EPOCH FROM (nz_now() - vo.recorded_at)) / 3600) AS hours_remaining,
    cv.vehicle_make,
    cv.vehicle_model,
    cv.vehicle_color,
    vo.photo,
    vo.gps_latitude,
    vo.gps_longitude
  FROM vehicle_observations_v2 vo
  JOIN zones z ON z.id = vo.zone_id
  LEFT JOIN user_profiles up ON up.id = vo.recorded_by
  LEFT JOIN canonical_vehicles cv ON cv.plate_number = vo.plate_number
  WHERE vo.organization_id = v_org_id
    AND vo.recorded_at >= (nz_now() - INTERVAL '24 hours')
    -- Apply filters
    AND (NOT p_filter_breaches OR vo.is_breach = TRUE)
    AND (NOT p_filter_homeless OR cv.homeless_status = 'confirmed')
    AND (NOT p_filter_at_risk OR cv.is_flagged = TRUE OR vo.is_breach = TRUE)
  ORDER BY vo.recorded_at DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_org_scans_24h IS 'Returns all organization scans from last 24 hours with edit permissions and filters';

GRANT EXECUTE ON FUNCTION get_org_scans_24h TO authenticated;

-- =====================================================
-- AUDIT LOG FOR DELETIONS
-- =====================================================

-- Track when observations are deleted (for audit trail)
CREATE TABLE IF NOT EXISTS observation_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id UUID NOT NULL,
  plate_number TEXT NOT NULL,
  zone_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  recorded_by UUID NOT NULL,
  deleted_by UUID NOT NULL REFERENCES user_profiles(id),
  deleted_at TIMESTAMPTZ DEFAULT nz_now(),
  deletion_reason TEXT,
  observation_snapshot JSONB NOT NULL
);

CREATE INDEX idx_observation_deletions_deleted_by ON observation_deletions(deleted_by, deleted_at DESC);
CREATE INDEX idx_observation_deletions_plate ON observation_deletions(plate_number);
CREATE INDEX idx_observation_deletions_org ON observation_deletions(organization_id);

COMMENT ON TABLE observation_deletions IS 'Audit trail of deleted observations (24-hour window deletions)';

-- Trigger to log deletions
CREATE OR REPLACE FUNCTION log_observation_deletion()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO observation_deletions (
    observation_id,
    plate_number,
    zone_id,
    organization_id,
    recorded_at,
    recorded_by,
    deleted_by,
    observation_snapshot
  ) VALUES (
    OLD.observation_id,
    OLD.plate_number,
    OLD.zone_id,
    OLD.organization_id,
    OLD.recorded_at,
    OLD.recorded_by,
    auth.uid(),
    to_jsonb(OLD)
  );
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_log_observation_deletion ON vehicle_observations_v2;
CREATE TRIGGER trigger_log_observation_deletion
  BEFORE DELETE ON vehicle_observations_v2
  FOR EACH ROW
  EXECUTE FUNCTION log_observation_deletion();

COMMENT ON TRIGGER trigger_log_observation_deletion ON vehicle_observations_v2 IS 'Audit trail for observation deletions';

-- RLS for observation_deletions
ALTER TABLE observation_deletions ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_view_own_deletions
  ON observation_deletions FOR SELECT
  USING (deleted_by = auth.uid());

CREATE POLICY admins_view_org_deletions
  ON observation_deletions FOR SELECT
  USING (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'master'::text]))
    AND (
      (get_user_role(auth.uid()) = 'master'::text)
      OR (organization_id = get_user_organization_id(auth.uid()))
    )
  );

-- Migration summary
DO $$
DECLARE
  recent_scans_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO recent_scans_count
  FROM vehicle_observations_v2
  WHERE recorded_at >= (nz_now() - INTERVAL '24 hours');
  
  RAISE NOTICE '✅ Session History 24-Hour Window Migration Complete';
  RAISE NOTICE '   - Created officers_delete_recent_scans policy';
  RAISE NOTICE '   - Created officers_update_recent_scans policy';
  RAISE NOTICE '   - Created get_observation_edit_status() function';
  RAISE NOTICE '   - Created get_org_scans_24h() function';
  RAISE NOTICE '   - Created observation_deletions audit table';
  RAISE NOTICE '   - Created deletion audit trigger';
  RAISE NOTICE '';
  RAISE NOTICE '   📊 Current Data:';
  RAISE NOTICE '      - Scans in last 24h: %', recent_scans_count;
  RAISE NOTICE '';
  RAISE NOTICE '   🔐 Permissions:';
  RAISE NOTICE '      - Officers can edit/delete own scans within 24h';
  RAISE NOTICE '      - All deletions logged to observation_deletions table';
  RAISE NOTICE '      - Organization-wide 24h view available via get_org_scans_24h()';
END $$;
