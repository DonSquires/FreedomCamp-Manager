-- ============================================================================
-- Add grand_master role to user_profiles
-- Date: 2026-04-24
--
-- The grand_master role is for platform owners (Iron Eagle management /
-- product owner) who manage the entire platform across all clients.
-- Capabilities:
--   - View all organisations
--   - Create and manage organisations (onboarding)
--   - Access billing/usage metrics
--   - Manage feature flags per org
--   - Access platform-wide statistics
--   - Trigger SCV list sync
--   - Demo mode management
--
-- grand_master has all master privileges PLUS:
--   - Cross-org visibility without org restriction
--   - Organization CRUD (create/suspend/activate)
--   - Platform-level settings
--
-- This is distinct from master (which manages multiple orgs as an
-- operational role) and from nzscv_monitor (which was a read-only
-- monitoring role that is superseded by grand_master's broader access).
-- ============================================================================

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
    CHECK (role IN ('officer', 'admin', 'admin_officer', 'master', 'grand_master', 'nzscv_monitor'));

COMMENT ON CONSTRAINT user_profiles_role_check ON public.user_profiles IS
  'Valid roles: officer, admin, admin_officer, master, grand_master, nzscv_monitor. '
  'grand_master = platform owner (all orgs, billing, onboarding). '
  'nzscv_monitor = legacy read-only SCV monitoring role (superseded by grand_master).';

-- ── RLS: grand_master gets full cross-org read access ────────────────────────

-- Organisations: grand_master can read and write all orgs
DO $$ BEGIN
  DROP POLICY IF EXISTS "grand_master_all_orgs" ON public.organizations;
  CREATE POLICY "grand_master_all_orgs"
    ON public.organizations
    FOR ALL
    TO authenticated
    USING (get_user_role(auth.uid()) = 'grand_master')
    WITH CHECK (get_user_role(auth.uid()) = 'grand_master');
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- User profiles: grand_master can read and manage all user profiles
DO $$ BEGIN
  DROP POLICY IF EXISTS "grand_master_all_user_profiles" ON public.user_profiles;
  CREATE POLICY "grand_master_all_user_profiles"
    ON public.user_profiles
    FOR ALL
    TO authenticated
    USING (get_user_role(auth.uid()) = 'grand_master')
    WITH CHECK (get_user_role(auth.uid()) = 'grand_master');
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Zones: grand_master can read all zones (cross-org visibility for platform map)
DO $$ BEGIN
  DROP POLICY IF EXISTS "grand_master_read_all_zones" ON public.zones;
  CREATE POLICY "grand_master_read_all_zones"
    ON public.zones
    FOR SELECT
    TO authenticated
    USING (get_user_role(auth.uid()) = 'grand_master');
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Observations: grand_master has cross-org read for platform statistics
DO $$ BEGIN
  DROP POLICY IF EXISTS "grand_master_read_all_observations" ON public.observations;
  CREATE POLICY "grand_master_read_all_observations"
    ON public.observations
    FOR SELECT
    TO authenticated
    USING (get_user_role(auth.uid()) = 'grand_master');
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Breach alerts: grand_master cross-org read
DO $$ BEGIN
  DROP POLICY IF EXISTS "grand_master_read_all_breach_alerts" ON public.breach_alerts;
  CREATE POLICY "grand_master_read_all_breach_alerts"
    ON public.breach_alerts
    FOR SELECT
    TO authenticated
    USING (get_user_role(auth.uid()) = 'grand_master');
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Audit log: grand_master cross-org read
DO $$ BEGIN
  DROP POLICY IF EXISTS "grand_master_read_all_audit_log" ON public.audit_log;
  CREATE POLICY "grand_master_read_all_audit_log"
    ON public.audit_log
    FOR SELECT
    TO authenticated
    USING (get_user_role(auth.uid()) = 'grand_master');
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ── RPC: get_platform_stats() ────────────────────────────────────────────────
-- Returns platform-wide aggregated statistics for the grand_master dashboard.
-- SECURITY DEFINER so it bypasses RLS and aggregates across all orgs.

CREATE OR REPLACE FUNCTION public.get_platform_stats(
  p_from TIMESTAMPTZ DEFAULT (now() - interval '30 days'),
  p_to   TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Only grand_master can call this
  IF get_user_role(auth.uid()) != 'grand_master' THEN
    RAISE EXCEPTION 'Access denied: grand_master role required';
  END IF;

  SELECT jsonb_build_object(
    'total_organizations',    (SELECT count(*) FROM organizations),
    'active_organizations',   (SELECT count(*) FROM organizations WHERE is_active = true),
    'total_users',            (SELECT count(*) FROM user_profiles WHERE is_active = true),
    'total_officers',         (SELECT count(*) FROM user_profiles WHERE role = 'officer' AND is_active = true),
    'scans_in_period',        (SELECT count(*) FROM observations WHERE recorded_at BETWEEN p_from AND p_to),
    'breaches_in_period',     (SELECT count(*) FROM observations WHERE recorded_at BETWEEN p_from AND p_to AND is_compliant = false),
    'notices_issued',         (SELECT count(*) FROM notices_to_vacate WHERE created_at BETWEEN p_from AND p_to),
    'infringements_issued',   (SELECT count(*) FROM infringement_notices WHERE created_at BETWEEN p_from AND p_to),
    'open_disputes',          (SELECT count(*) FROM dispute_intake WHERE status = 'received'),
    'period_from',            p_from,
    'period_to',              p_to
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_stats(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION public.get_platform_stats IS
  'Platform-wide aggregated statistics for grand_master dashboard. Bypasses RLS.';

-- ── RPC: get_org_usage_summary() ─────────────────────────────────────────────
-- Returns per-org usage metrics for billing and activity monitoring.

CREATE OR REPLACE FUNCTION public.get_org_usage_summary(
  p_from TIMESTAMPTZ DEFAULT date_trunc('month', now()),
  p_to   TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  organization_id   UUID,
  organization_name TEXT,
  is_active         BOOLEAN,
  officer_count     BIGINT,
  scan_count        BIGINT,
  breach_count      BIGINT,
  notice_count      BIGINT,
  infringement_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only grand_master can call this
  IF get_user_role(auth.uid()) != 'grand_master' THEN
    RAISE EXCEPTION 'Access denied: grand_master role required';
  END IF;

  RETURN QUERY
  SELECT
    o.id                                                                    AS organization_id,
    o.name                                                                  AS organization_name,
    o.is_active,
    COUNT(DISTINCT up.id) FILTER (WHERE up.role = 'officer' AND up.is_active = true)  AS officer_count,
    COUNT(DISTINCT obs.observation_id)                                      AS scan_count,
    COUNT(DISTINCT obs.observation_id) FILTER (WHERE obs.is_compliant = false) AS breach_count,
    COUNT(DISTINCT ntv.id)                                                  AS notice_count,
    COUNT(DISTINCT inf.id)                                                  AS infringement_count
  FROM organizations o
  LEFT JOIN user_profiles up ON up.organization_id = o.id
  LEFT JOIN observations obs
    ON obs.org_id = o.id
    AND obs.recorded_at BETWEEN p_from AND p_to
  LEFT JOIN notices_to_vacate ntv
    ON ntv.organization_id = o.id
    AND ntv.created_at BETWEEN p_from AND p_to
  LEFT JOIN infringement_notices inf
    ON inf.organization_id = o.id
    AND inf.created_at BETWEEN p_from AND p_to
  GROUP BY o.id, o.name, o.is_active
  ORDER BY scan_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_usage_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION public.get_org_usage_summary IS
  'Per-org usage metrics for grand_master billing and activity monitoring.';

NOTIFY pgrst, 'reload schema';
