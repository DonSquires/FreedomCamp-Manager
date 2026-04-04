-- =============================================================================
-- Harden live tracking org isolation
-- Date: 2026-06-04
--
-- Why:
--   Prevent any cross-organization leakage from live officer tracking queries.
--
-- What:
--   Replaces get_live_officer_locations() with an org-scoped version that:
--   1) Requires an authenticated user
--   2) Restricts officers to caller-visible orgs from get_user_organization_ids()
--   3) Optionally enforces p_organization_id to be within caller-visible orgs
--
-- Result:
--   A user from one organization cannot read live tracking rows for another
--   unrelated organization, even if a client-side filter is missing/bypassed.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_live_officer_locations(
  p_organization_id UUID DEFAULT NULL
)
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
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed_orgs UUID[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required for live officer tracking';
  END IF;

  v_allowed_orgs := COALESCE(get_user_organization_ids(), ARRAY[]::UUID[]);

  IF p_organization_id IS NOT NULL AND NOT (p_organization_id = ANY(v_allowed_orgs)) THEN
    RAISE EXCEPTION 'Access denied: organization % is outside your scope', p_organization_id;
  END IF;

  RETURN QUERY
  SELECT
    up.id AS user_id,
    up.first_name,
    up.last_name,
    up.phone,
    up.organization_id,

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

    (
      SELECT COUNT(*)
      FROM public.officer_activity_log
      WHERE user_id = up.id
        AND activity_type = 'vehicle_scan'
        AND recorded_at >= CURRENT_DATE
    )::INTEGER AS recent_scans,

    (
      SELECT metadata->>'plate_number'
      FROM public.officer_activity_log
      WHERE user_id = up.id
        AND activity_type = 'vehicle_scan'
        AND metadata->>'plate_number' IS NOT NULL
      ORDER BY recorded_at DESC
      LIMIT 1
    ) AS last_scan_plate,

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

    (
      SELECT EXISTS (
        SELECT 1
        FROM public.investigation_jobs
        WHERE assigned_to = up.id
          AND status = 'in_progress'
      )
    ) AS is_active_investigation,

    (
      SELECT CASE WHEN COUNT(*) > 0 THEN 'alert' ELSE 'ok' END
      FROM public.officer_welfare_alerts
      WHERE officer_id = up.id
        AND status = 'pending'
        AND alert_type = 'welfare_check'
    ) AS welfare_status

  FROM public.user_profiles up
  WHERE up.role = 'officer'
    AND up.is_active = TRUE
    AND up.organization_id = ANY(v_allowed_orgs)
    AND (p_organization_id IS NULL OR up.organization_id = p_organization_id)
  ORDER BY up.first_name, up.last_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_live_officer_locations(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_live_officer_locations(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_live_officer_locations(UUID) IS
  'Returns live officer tracking rows only for organizations visible to auth.uid(). '
  'Optional p_organization_id must also be within caller scope.';
