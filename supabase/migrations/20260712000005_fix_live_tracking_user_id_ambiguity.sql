-- =============================================================================
-- Live tracking: fix ambiguous user_id reference in RPC
-- Date: 2026-07-12
--
-- Why:
--   Production RPC calls to get_live_officer_locations can fail with:
--   "column reference \"user_id\" is ambiguous".
--   In plpgsql RETURNS TABLE functions, output column names become variables,
--   so unqualified references like user_id inside nested queries are ambiguous.
--
-- What:
--   Recreate get_live_officer_locations with fully-qualified oal.user_id
--   references in all officer_activity_log subqueries.
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
      SELECT oal.gps_latitude
      FROM public.officer_activity_log oal
      WHERE oal.user_id = up.id
        AND oal.activity_type = 'gps_update'
        AND oal.gps_latitude IS NOT NULL
      ORDER BY oal.recorded_at DESC
      LIMIT 1
    ) AS last_gps_latitude,

    (
      SELECT oal.gps_longitude
      FROM public.officer_activity_log oal
      WHERE oal.user_id = up.id
        AND oal.activity_type = 'gps_update'
        AND oal.gps_longitude IS NOT NULL
      ORDER BY oal.recorded_at DESC
      LIMIT 1
    ) AS last_gps_longitude,

    (
      SELECT oal.gps_accuracy
      FROM public.officer_activity_log oal
      WHERE oal.user_id = up.id
        AND oal.activity_type = 'gps_update'
        AND oal.gps_latitude IS NOT NULL
      ORDER BY oal.recorded_at DESC
      LIMIT 1
    ) AS last_gps_accuracy,

    (
      SELECT oal.recorded_at
      FROM public.officer_activity_log oal
      WHERE oal.user_id = up.id
        AND oal.activity_type = 'gps_update'
        AND oal.gps_latitude IS NOT NULL
      ORDER BY oal.recorded_at DESC
      LIMIT 1
    ) AS last_gps_update,

    (
      SELECT COUNT(*)
      FROM public.officer_activity_log oal
      WHERE oal.user_id = up.id
        AND oal.activity_type = 'vehicle_scan'
        AND oal.recorded_at >= CURRENT_DATE
    )::INTEGER AS recent_scans,

    (
      SELECT oal.metadata->>'plate_number'
      FROM public.officer_activity_log oal
      WHERE oal.user_id = up.id
        AND oal.activity_type = 'vehicle_scan'
        AND oal.metadata->>'plate_number' IS NOT NULL
      ORDER BY oal.recorded_at DESC
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
        FROM public.investigation_jobs ij
        WHERE ij.assigned_to = up.id
          AND ij.status = 'in_progress'
      )
    ) AS is_active_investigation,

    (
      SELECT CASE WHEN COUNT(*) > 0 THEN 'alert' ELSE 'ok' END
      FROM public.officer_welfare_alerts owa
      WHERE owa.officer_id = up.id
        AND owa.status = 'pending'
        AND owa.alert_type = 'welfare_check'
    ) AS welfare_status

  FROM public.user_profiles up
  WHERE up.role IN ('officer', 'admin_officer')
    AND up.is_active = TRUE
    AND up.organization_id = ANY(v_allowed_orgs)
    AND (p_organization_id IS NULL OR up.organization_id = p_organization_id)
  ORDER BY up.first_name, up.last_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_live_officer_locations(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_live_officer_locations(UUID) TO authenticated, service_role;
