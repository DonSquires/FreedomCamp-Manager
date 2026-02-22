-- Admin Dashboard RPC Function
-- Date: 2026-02-24
-- Purpose: Fast aggregated stats for admin dashboard KPIs

-- ============================================================================
-- Function: get_admin_dashboard_stats
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_organization_id UUID DEFAULT NULL
)
RETURNS TABLE(
  total_observations BIGINT,
  total_breaches BIGINT,
  pending_breaches BIGINT,
  active_investigations BIGINT,
  active_officers BIGINT,
  zones_with_activity BIGINT,
  total_vehicles BIGINT,
  flagged_vehicles BIGINT,
  homeless_vehicles BIGINT,
  homeless_exempt BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    -- Total observations in date range
    (
      SELECT COUNT(*)
      FROM public.observations
      WHERE recorded_at BETWEEN p_start_date AND p_end_date
        AND deleted_at IS NULL
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    ) AS total_observations,
    
    -- Total breaches in date range
    (
      SELECT COUNT(*)
      FROM public.observations
      WHERE recorded_at BETWEEN p_start_date AND p_end_date
        AND deleted_at IS NULL
        AND is_compliant = FALSE
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    ) AS total_breaches,
    
    -- Pending breach alerts
    (
      SELECT COUNT(*)
      FROM public.breach_alerts
      WHERE created_at BETWEEN p_start_date AND p_end_date
        AND status IN ('pending', 'assigned')
        AND deleted_at IS NULL
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    ) AS pending_breaches,
    
    -- Active investigations
    (
      SELECT COUNT(*)
      FROM public.investigation_jobs
      WHERE created_at <= p_end_date
        AND status IN ('pending', 'assigned')
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    ) AS active_investigations,
    
    -- Active officers (logged activity in date range)
    (
      SELECT COUNT(DISTINCT recorded_by)
      FROM public.observations
      WHERE recorded_at BETWEEN p_start_date AND p_end_date
        AND deleted_at IS NULL
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    ) AS active_officers,
    
    -- Zones with activity in date range
    (
      SELECT COUNT(DISTINCT zone_id)
      FROM public.observations
      WHERE recorded_at BETWEEN p_start_date AND p_end_date
        AND deleted_at IS NULL
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    ) AS zones_with_activity,
    
    -- Total vehicles in canonical registry
    (
      SELECT COUNT(*)
      FROM public.canonical_vehicles
      WHERE (p_organization_id IS NULL OR TRUE) -- Global registry
    ) AS total_vehicles,
    
    -- Flagged vehicles (is_flagged = true)
    (
      SELECT COUNT(*)
      FROM public.canonical_vehicles
      WHERE is_flagged = TRUE
    ) AS flagged_vehicles,
    
    -- Homeless vehicles (homeless_status confirmed)
    (
      SELECT COUNT(*)
      FROM public.canonical_vehicles
      WHERE homeless_status IN ('confirmed', 'suspected')
    ) AS homeless_vehicles,
    
    -- Homeless exempt (observations today with homeless exemption)
    (
      SELECT COUNT(DISTINCT plate_number)
      FROM public.observations
      WHERE DATE(recorded_at AT TIME ZONE 'Pacific/Auckland') = CURRENT_DATE
        AND deleted_at IS NULL
        AND is_compliant = TRUE
        AND breach_reason LIKE '%homeless%exempt%'
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    ) AS homeless_exempt;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats TO authenticated;

COMMENT ON FUNCTION public.get_admin_dashboard_stats IS 
  'Returns aggregated KPI stats for admin dashboard filtered by date range and organization';

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  v_result RECORD;
BEGIN
  -- Test function with today's data
  SELECT * INTO v_result
  FROM public.get_admin_dashboard_stats(
    CURRENT_DATE::TIMESTAMPTZ,
    (CURRENT_DATE + INTERVAL '1 day')::TIMESTAMPTZ,
    NULL
  );

  RAISE NOTICE '✅ Admin dashboard RPC function created successfully';
  RAISE NOTICE '   - Total observations: %', v_result.total_observations;
  RAISE NOTICE '   - Total breaches: %', v_result.total_breaches;
  RAISE NOTICE '   - Pending breaches: %', v_result.pending_breaches;
END;
$$;
