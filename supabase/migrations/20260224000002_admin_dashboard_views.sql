-- Admin Dashboard Real-Time Views
-- Date: 2026-02-24
-- Purpose: Live KPI metrics and breach feed for enforcement command center

-- ============================================================================
-- View: dashboard_stats_live
-- Purpose: Real-time KPI metrics for admin dashboard
-- ============================================================================

-- Contract bootstrap: older table variants may not have recorded_at yet.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'enforcement_actions'
  ) THEN
    ALTER TABLE public.enforcement_actions
      ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ DEFAULT now();

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'enforcement_actions'
        AND column_name = 'created_at'
    ) THEN
      UPDATE public.enforcement_actions
      SET recorded_at = COALESCE(recorded_at, created_at, now())
      WHERE recorded_at IS NULL;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'officer_activity_log'
  ) THEN
    ALTER TABLE public.officer_activity_log
      ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ DEFAULT now();

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'officer_activity_log'
        AND column_name = 'created_at'
    ) THEN
      UPDATE public.officer_activity_log
      SET recorded_at = COALESCE(recorded_at, created_at, now())
      WHERE recorded_at IS NULL;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE VIEW public.dashboard_stats_live AS
SELECT
  -- Scans Today (observations created today)
  (
    SELECT COUNT(*)
    FROM public.observations
    WHERE DATE(recorded_at AT TIME ZONE 'Pacific/Auckland') = CURRENT_DATE
      AND deleted_at IS NULL
  ) AS scans_today,
  
  -- Active Breaches (open breach alerts)
  (
    SELECT COUNT(*)
    FROM public.breach_alerts
    WHERE status IN ('pending', 'assigned')
      AND deleted_at IS NULL
  ) AS active_breaches,
  
  -- Unique Vehicles in Last 24 Hours
  (
    SELECT COUNT(DISTINCT plate_number)
    FROM public.observations
    WHERE recorded_at >= NOW() - INTERVAL '24 hours'
      AND plate_number IS NOT NULL
      AND plate_number != 'MANUAL_REQUIRED'
      AND deleted_at IS NULL
  ) AS unique_vehicles_24h,
  
  -- Warnings Issued in Last 24 Hours
  (
    SELECT COUNT(*)
    FROM public.enforcement_actions
    WHERE action_type = 'warning'
      AND recorded_at >= NOW() - INTERVAL '24 hours'
  ) AS warnings_24h,
  
  -- Active Officers (logged in within last 2 hours)
  (
    SELECT COUNT(DISTINCT user_id)
    FROM public.officer_activity_log
    WHERE recorded_at >= NOW() - INTERVAL '2 hours'
  ) AS active_officers,
  
  -- Last Scan Time (most recent observation)
  (
    SELECT MAX(recorded_at)
    FROM public.observations
    WHERE deleted_at IS NULL
  ) AS last_scan_time;

-- Grant select to authenticated users (RLS applies via organization_id filters in queries)
GRANT SELECT ON public.dashboard_stats_live TO authenticated;

COMMENT ON VIEW public.dashboard_stats_live IS 
  'Real-time KPI metrics for admin dashboard command center';

-- ============================================================================
-- View: dashboard_breaches
-- Purpose: Live breach alert feed with vehicle and zone details
-- ============================================================================

CREATE OR REPLACE VIEW public.dashboard_breaches AS
SELECT
  ba.id AS alert_id,
  ba.status,
  ba.created_at,
  
  -- Vehicle Details
  COALESCE(ba.plate_number, cv.plate_number, 'UNKNOWN') AS plate_number,
  COALESCE(to_jsonb(cv)->>'make', to_jsonb(cv)->>'vehicle_make') AS make,
  COALESCE(to_jsonb(cv)->>'model', to_jsonb(cv)->>'vehicle_model') AS model,
  COALESCE(to_jsonb(cv)->>'colour', to_jsonb(cv)->>'color', to_jsonb(cv)->>'vehicle_color') AS color,
  
  -- Zone Details
  z.name AS zone_name,
  zcm.max_consecutive_nights,
  
  -- Breach Details
  ba.breach_type AS rule_applied,
  COALESCE(
    (ba.breach_details->>'nights_stayed')::INTEGER,
    0
  ) AS nights_stayed,
  
  -- Organization for RLS filtering
  ba.organization_id
  
FROM public.breach_alerts ba
LEFT JOIN public.canonical_vehicles cv ON ba.plate_number = cv.plate_number
LEFT JOIN public.zones z ON ba.zone_id = z.id
LEFT JOIN LATERAL (
  SELECT max_consecutive_nights
  FROM public.zone_compliance_matrix
  WHERE zone_id = ba.zone_id
    AND effective_from <= NOW()
    AND (effective_to IS NULL OR effective_to > NOW())
  ORDER BY version DESC
  LIMIT 1
) zcm ON TRUE
WHERE ba.deleted_at IS NULL
ORDER BY ba.created_at DESC;

-- Grant select to authenticated users
GRANT SELECT ON public.dashboard_breaches TO authenticated;

COMMENT ON VIEW public.dashboard_breaches IS 
  'Live breach alert feed with enriched vehicle and zone details for admin dashboard';

-- ============================================================================
-- RLS Policies for Views
-- ============================================================================
-- Note: Views inherit RLS from underlying tables, but we add explicit policies
-- for organization-scoped access

-- Create security barrier function for organization filtering
CREATE OR REPLACE FUNCTION dashboard_org_filter()
RETURNS SETOF public.dashboard_breaches AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.dashboard_breaches
  WHERE (
    -- Masters see all
    get_user_role(auth.uid()) = 'master'::text
    -- Others see their org + descendant orgs
    OR organization_id = ANY (get_user_organization_ids())
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION dashboard_org_filter() TO authenticated;

COMMENT ON FUNCTION dashboard_org_filter IS 
  'Organization-scoped filter for dashboard breach feed';

-- ============================================================================
-- Performance Indexes (if not already exist)
-- ============================================================================

-- Observations: recorded_at for today's scans
CREATE INDEX IF NOT EXISTS idx_observations_recorded_at_date 
  ON public.observations (DATE(recorded_at AT TIME ZONE 'Pacific/Auckland'))
  WHERE deleted_at IS NULL;

-- Breach Alerts: status + created_at for active breach counts
CREATE INDEX IF NOT EXISTS idx_breach_alerts_status_created 
  ON public.breach_alerts (status, created_at DESC)
  WHERE deleted_at IS NULL;

-- Officer Activity: recent activity for active officer counts
CREATE INDEX IF NOT EXISTS idx_officer_activity_recent 
  ON public.officer_activity_log (recorded_at DESC)
  WHERE recorded_at IS NOT NULL;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
DECLARE
  v_stats RECORD;
  v_breach_count INTEGER;
BEGIN
  -- Test stats view
  SELECT * INTO v_stats FROM public.dashboard_stats_live;
  
  IF v_stats.scans_today IS NULL THEN
    RAISE WARNING 'dashboard_stats_live returned NULL for scans_today - check data exists';
  END IF;
  
  -- Test breaches view
  SELECT COUNT(*) INTO v_breach_count FROM public.dashboard_breaches;
  
  RAISE NOTICE '✅ Admin dashboard views created successfully';
  RAISE NOTICE '   - dashboard_stats_live: KPI metrics view';
  RAISE NOTICE '   - dashboard_breaches: Breach alert feed view';
  RAISE NOTICE '   - Current stats: % scans today, % active breaches', 
    COALESCE(v_stats.scans_today, 0),
    COALESCE(v_stats.active_breaches, 0);
  RAISE NOTICE '   - Performance indexes added';
END;
$$;
