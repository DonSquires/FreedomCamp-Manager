-- ============================================================================
-- COMPLIANCE PAGE RPC FUNCTIONS
-- ============================================================================
-- Moves all compliance calculations from the frontend to the backend.
-- UI becomes a pure display / management layer — no maths in JavaScript.
--
-- Functions created / updated:
--   get_compliance_stats              → CompliancePage OverviewTab KPIs
--   get_zone_compliance_breakdown     → CompliancePage ZonesTab
--   get_compliance_analytics_summary  → ComplianceAnalytics page
--   get_admin_dashboard_stats         → ComplianceDashboard (updated with
--                                       compliance_rate + active_patrols,
--                                       breach count now from observations)
-- ============================================================================

-- ============================================================================
-- 1. get_compliance_stats
--    Single-row summary for the CompliancePage OverviewTab.
--    Replaces: 5 COUNT queries + Math.round() in the frontend.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_compliance_stats(
  p_start            TIMESTAMPTZ,
  p_end              TIMESTAMPTZ,
  p_organization_id  UUID DEFAULT NULL,
  p_zone_id          UUID DEFAULT NULL
)
RETURNS TABLE (
  total_observations  BIGINT,
  breach_count        BIGINT,
  compliant_count     BIGINT,
  compliance_rate     NUMERIC,   -- e.g. 96 for 96%
  flagged_vehicles    BIGINT,
  homeless_vehicles   BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH obs AS (
    SELECT
      COUNT(*)                                        AS total,
      COUNT(*) FILTER (WHERE is_compliant = TRUE)    AS compliant,
      COUNT(*) FILTER (WHERE is_compliant = FALSE)   AS breaches
    FROM observations
    WHERE recorded_at BETWEEN p_start AND p_end
      AND (p_organization_id IS NULL OR organization_id = p_organization_id)
      AND (p_zone_id         IS NULL OR zone_id         = p_zone_id)
  ),
  veh AS (
    SELECT
      COUNT(*) FILTER (WHERE is_flagged = TRUE)                               AS flagged,
      COUNT(*) FILTER (WHERE homeless_status IN ('confirmed','claimed','suspected','declined')) AS homeless
    FROM canonical_vehicles
  )
  SELECT
    obs.total       AS total_observations,
    obs.breaches    AS breach_count,
    obs.compliant   AS compliant_count,
    COALESCE(
      ROUND(100.0 * obs.compliant / NULLIF(obs.total, 0)),
      0
    )               AS compliance_rate,
    veh.flagged     AS flagged_vehicles,
    veh.homeless    AS homeless_vehicles
  FROM obs, veh;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_compliance_stats TO authenticated;
COMMENT ON FUNCTION public.get_compliance_stats IS
  'Returns pre-aggregated KPI stats for CompliancePage OverviewTab. '
  'Eliminates all client-side counting and rate calculations.';

-- ============================================================================
-- 2. get_zone_compliance_breakdown
--    Per-zone stats for the CompliancePage ZonesTab.
--    Replaces: zones query + observations GROUP BY + client reduce + Math.round
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_zone_compliance_breakdown(
  p_start            TIMESTAMPTZ,
  p_end              TIMESTAMPTZ,
  p_organization_id  UUID DEFAULT NULL
)
RETURNS TABLE (
  zone_id                 UUID,
  zone_name               TEXT,
  organization_name       TEXT,
  is_active               BOOLEAN,
  nights_per_month        INTEGER,
  max_consecutive_nights  INTEGER,
  self_contained_required BOOLEAN,
  day_visit_only          BOOLEAN,
  obs_count               BIGINT,
  breach_count            BIGINT,
  compliance_pct          NUMERIC    -- e.g. 96 for 96%
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    z.id                      AS zone_id,
    z.name                    AS zone_name,
    org.name                  AS organization_name,
    z.is_active,
    z.nights_per_month,
    z.max_consecutive_nights,
    z.self_contained_required,
    z.day_visit_only,
    COUNT(obs.id)                                                           AS obs_count,
    COUNT(obs.id) FILTER (WHERE obs.is_compliant = FALSE)                  AS breach_count,
    COALESCE(
      ROUND(
        100.0 * COUNT(obs.id) FILTER (WHERE obs.is_compliant = TRUE)
        / NULLIF(COUNT(obs.id), 0)
      ),
      100
    )                                                                       AS compliance_pct
  FROM zones z
  LEFT JOIN organizations org ON org.id = z.organization_id
  LEFT JOIN observations obs
    ON obs.zone_id = z.id
    AND obs.recorded_at BETWEEN p_start AND p_end
  WHERE (p_organization_id IS NULL OR z.organization_id = p_organization_id)
  GROUP BY
    z.id, z.name, org.name,
    z.is_active, z.nights_per_month, z.max_consecutive_nights,
    z.self_contained_required, z.day_visit_only
  ORDER BY breach_count DESC, obs_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_zone_compliance_breakdown TO authenticated;
COMMENT ON FUNCTION public.get_zone_compliance_breakdown IS
  'Returns per-zone compliance stats for CompliancePage ZonesTab. '
  'Replaces client-side GROUP BY aggregation.';

-- ============================================================================
-- 3. get_compliance_analytics_summary
--    All data needed by ComplianceAnalytics in a single JSONB response.
--    Replaces: 4 full-row queries + 6 client reduce/filter aggregations.
--
--    Returns JSONB:
--      metrics        – overall KPIs including avg_nights and repeat_offenders
--      breach_types   – [{name, value}] breach type frequency
--      zone_compliance– [{zone, total, compliant, rate}] per-zone breakdown
--      daily_trend    – [{date, total, compliant, breaches}] grouped by NZ date
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_compliance_analytics_summary(
  p_start            TIMESTAMPTZ,
  p_end              TIMESTAMPTZ,
  p_organization_id  UUID DEFAULT NULL,
  p_zone_id          UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_metrics         JSONB;
  v_breach_types    JSONB;
  v_zone_compliance JSONB;
  v_daily_trend     JSONB;
BEGIN
  -- ── Metrics ────────────────────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'total_observations',  COUNT(*),
    'compliant',           COUNT(*) FILTER (WHERE is_compliant = TRUE),
    'non_compliant',       COUNT(*) FILTER (WHERE is_compliant = FALSE),
    'compliance_rate',     COALESCE(
                             ROUND(
                               100.0 * COUNT(*) FILTER (WHERE is_compliant = TRUE)
                               / NULLIF(COUNT(*), 0),
                               1
                             ), 0
                           ),
    'total_vehicles',      COUNT(DISTINCT plate_number),
    'repeat_offenders',    (
                             SELECT COUNT(*)
                             FROM (
                               SELECT plate_number
                               FROM observations
                               WHERE recorded_at BETWEEN p_start AND p_end
                                 AND is_compliant = FALSE
                                 AND (p_organization_id IS NULL OR organization_id = p_organization_id)
                                 AND (p_zone_id         IS NULL OR zone_id         = p_zone_id)
                               GROUP BY plate_number
                               HAVING COUNT(*) > 1
                             ) ro
                           ),
    'avg_nights_per_vehicle', COALESCE(
                                (
                                  SELECT ROUND(AVG(cnt)::NUMERIC, 2)
                                  FROM (
                                    SELECT COUNT(*) AS cnt
                                    FROM observations
                                    WHERE recorded_at BETWEEN p_start AND p_end
                                      AND (p_organization_id IS NULL OR organization_id = p_organization_id)
                                      AND (p_zone_id         IS NULL OR zone_id         = p_zone_id)
                                    GROUP BY plate_number
                                  ) vc
                                ), 0
                              )
  )
  INTO v_metrics
  FROM observations
  WHERE recorded_at BETWEEN p_start AND p_end
    AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    AND (p_zone_id         IS NULL OR zone_id         = p_zone_id);

  -- ── Breach types breakdown ─────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'name',  REPLACE(COALESCE(breach_type, 'unknown'), '_', ' '),
      'value', cnt
    ) ORDER BY cnt DESC
  ), '[]'::JSONB)
  INTO v_breach_types
  FROM (
    SELECT breach_type, COUNT(*) AS cnt
    FROM observations
    WHERE recorded_at BETWEEN p_start AND p_end
      AND is_compliant = FALSE
      AND (p_organization_id IS NULL OR organization_id = p_organization_id)
      AND (p_zone_id         IS NULL OR zone_id         = p_zone_id)
    GROUP BY breach_type
  ) bt;

  -- ── Per-zone compliance ────────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'zone',      z.name,
      'total',     COUNT(obs.id),
      'compliant', COUNT(obs.id) FILTER (WHERE obs.is_compliant = TRUE),
      'rate',      COALESCE(
                     ROUND(
                       100.0 * COUNT(obs.id) FILTER (WHERE obs.is_compliant = TRUE)
                       / NULLIF(COUNT(obs.id), 0),
                       1
                     ), 100
                   )
    ) ORDER BY COUNT(obs.id) DESC
  ), '[]'::JSONB)
  INTO v_zone_compliance
  FROM zones z
  LEFT JOIN observations obs
    ON obs.zone_id = z.id
    AND obs.recorded_at BETWEEN p_start AND p_end
  WHERE (p_organization_id IS NULL OR z.organization_id = p_organization_id)
  GROUP BY z.id, z.name;

  -- ── Daily trend (NZ timezone grouping) ────────────────────────────────────
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date',      nz_date::TEXT,
      'total',     total,
      'compliant', compliant_cnt,
      'breaches',  breach_cnt
    ) ORDER BY nz_date
  ), '[]'::JSONB)
  INTO v_daily_trend
  FROM (
    SELECT
      DATE(recorded_at AT TIME ZONE 'Pacific/Auckland') AS nz_date,
      COUNT(*)                                          AS total,
      COUNT(*) FILTER (WHERE is_compliant = TRUE)       AS compliant_cnt,
      COUNT(*) FILTER (WHERE is_compliant = FALSE)      AS breach_cnt
    FROM observations
    WHERE recorded_at BETWEEN p_start AND p_end
      AND (p_organization_id IS NULL OR organization_id = p_organization_id)
      AND (p_zone_id         IS NULL OR zone_id         = p_zone_id)
    GROUP BY DATE(recorded_at AT TIME ZONE 'Pacific/Auckland')
    ORDER BY nz_date
  ) dt;

  RETURN jsonb_build_object(
    'metrics',         v_metrics,
    'breach_types',    v_breach_types,
    'zone_compliance', v_zone_compliance,
    'daily_trend',     v_daily_trend
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_compliance_analytics_summary TO authenticated;
COMMENT ON FUNCTION public.get_compliance_analytics_summary IS
  'Single-call analytics summary for ComplianceAnalytics page. '
  'Returns metrics, breach_types, zone_compliance, and daily_trend as JSONB. '
  'Replaces 4 separate full-row queries and all client-side aggregations.';

-- ============================================================================
-- 4. get_admin_dashboard_stats (updated)
--    Adds: compliance_rate, active_patrols, non_compliant_observations.
--    Fixes: breach count now uses observations.is_compliant=FALSE instead of
--           breach_alerts (which may be partially populated).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats(
  p_start_date      TIMESTAMPTZ,
  p_end_date        TIMESTAMPTZ,
  p_organization_id UUID DEFAULT NULL
)
RETURNS TABLE(
  total_observations          BIGINT,
  compliant_observations      BIGINT,
  non_compliant_observations  BIGINT,
  compliance_rate             NUMERIC,   -- e.g. 96 for 96%
  total_breaches              BIGINT,
  pending_breach_alerts       BIGINT,
  active_investigations       BIGINT,
  active_officers             BIGINT,
  active_patrols              BIGINT,
  zones_with_activity         BIGINT,
  total_vehicles              BIGINT,
  flagged_vehicles            BIGINT,
  homeless_vehicles           BIGINT,
  homeless_exempt             BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH obs AS (
    SELECT
      COUNT(*)                                       AS total,
      COUNT(*) FILTER (WHERE is_compliant = TRUE)   AS compliant,
      COUNT(*) FILTER (WHERE is_compliant = FALSE)   AS breaches
    FROM public.observations
    WHERE recorded_at BETWEEN p_start_date AND p_end_date
      AND (p_organization_id IS NULL OR organization_id = p_organization_id)
  )
  SELECT
    obs.total       AS total_observations,
    obs.compliant   AS compliant_observations,
    obs.breaches    AS non_compliant_observations,
    COALESCE(
      ROUND(100.0 * obs.compliant / NULLIF(obs.total, 0)),
      0
    )               AS compliance_rate,
    obs.breaches    AS total_breaches,

    -- Pending breach alerts (workflow status, from breach_alerts table)
    (
      SELECT COUNT(*)
      FROM public.breach_alerts
      WHERE status IN ('pending', 'acknowledged')
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    )               AS pending_breach_alerts,

    -- Active investigations
    (
      SELECT COUNT(*)
      FROM public.investigation_jobs
      WHERE created_at <= p_end_date
        AND status IN ('pending', 'assigned')
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    )               AS active_investigations,

    -- Active officers (unique recorders in date range)
    (
      SELECT COUNT(DISTINCT recorded_by)
      FROM public.observations
      WHERE recorded_at BETWEEN p_start_date AND p_end_date
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    )               AS active_officers,

    -- Active patrols right now
    (
      SELECT COUNT(*)
      FROM public.patrols
      WHERE status = 'in_progress'
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    )               AS active_patrols,

    -- Zones with observations in date range
    (
      SELECT COUNT(DISTINCT zone_id)
      FROM public.observations
      WHERE recorded_at BETWEEN p_start_date AND p_end_date
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    )               AS zones_with_activity,

    -- Vehicle registry (global)
    (SELECT COUNT(*) FROM public.canonical_vehicles)
                    AS total_vehicles,

    (SELECT COUNT(*) FROM public.canonical_vehicles WHERE is_flagged = TRUE)
                    AS flagged_vehicles,

    (SELECT COUNT(*) FROM public.canonical_vehicles
     WHERE homeless_status IN ('confirmed', 'suspected', 'claimed', 'declined'))
                    AS homeless_vehicles,

    -- Homeless-exempt observations today
    (
      SELECT COUNT(DISTINCT plate_number)
      FROM public.observations
      WHERE DATE(recorded_at AT TIME ZONE 'Pacific/Auckland') = CURRENT_DATE
        AND is_compliant = TRUE
        AND breach_reason ILIKE '%homeless%exempt%'
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    )               AS homeless_exempt
  FROM obs;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats TO authenticated;
COMMENT ON FUNCTION public.get_admin_dashboard_stats IS
  'Admin dashboard KPI stats. Updated to include compliance_rate, active_patrols, '
  'and non_compliant_observations. Breach count now sourced from observations.is_compliant '
  'instead of breach_alerts for accuracy.';
