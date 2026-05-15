-- =============================================================================
-- Unified Org Access Restriction Gate (RLS Simplification)
-- Date: 2026-05-13
-- Purpose:
--   1) Centralize org visibility logic into one SECURITY DEFINER function.
--   2) Support direct org membership + explicit JWT org grants + provider/client
--      service grants + active contractor workspace handshake access.
--   3) Rebind core SELECT policies to this single gate to reduce duplicated RLS.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.org_access_allowed(
  p_target_org_id uuid,
  p_service_type text DEFAULT 'freedom_camping'
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed_orgs uuid[] := ARRAY[]::uuid[];
  v_jwt_orgs uuid[] := ARRAY[]::uuid[];
  v_service_grant boolean := false;
  v_workspace_grant boolean := false;
BEGIN
  IF p_target_org_id IS NULL OR auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  -- Primary/descendant/extra/work-location scope.
  v_allowed_orgs := COALESCE(public.get_user_organization_ids(), ARRAY[]::uuid[]);
  IF p_target_org_id = ANY(v_allowed_orgs) THEN
    RETURN true;
  END IF;

  -- Optional JWT-injected temporary org grants.
  IF to_regprocedure('public.get_jwt_authorised_organisation_ids()') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(public.get_jwt_authorised_organisation_ids(), ARRAY[]::uuid[])'
      INTO v_jwt_orgs;
    IF p_target_org_id = ANY(COALESCE(v_jwt_orgs, ARRAY[]::uuid[])) THEN
      RETURN true;
    END IF;
  END IF;

  -- Explicit provider->client service grants.
  IF to_regclass('public.provider_client_access_grants') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.provider_client_access_grants g
      WHERE g.provider_org_id = ANY(v_allowed_orgs)
        AND g.client_org_id = p_target_org_id
        AND g.is_active = true
        AND g.allow_without_roster = true
        AND (
          p_service_type IS NULL
          OR g.service_type::text = p_service_type
        )
    )
    INTO v_service_grant;

    IF COALESCE(v_service_grant, false) THEN
      RETURN true;
    END IF;
  END IF;

  -- Backward compatibility for existing service-check helper.
  IF to_regprocedure('public.can_access_service(uuid,text)') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(public.can_access_service($1, $2), false)'
      INTO v_service_grant
      USING p_target_org_id, COALESCE(p_service_type, 'freedom_camping');

    IF COALESCE(v_service_grant, false) THEN
      RETURN true;
    END IF;
  END IF;

  -- Active contractor/workspace handshake grants.
  IF to_regclass('public.contractor_access') IS NOT NULL
     AND to_regclass('public.workspaces') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.contractor_access ca
      INNER JOIN public.workspaces w ON w.id = ca.workspace_id
      WHERE ca.provider_org_id = ANY(v_allowed_orgs)
        AND w.owner_org_id = p_target_org_id
        AND ca.status = 'active'
        AND ca.valid_from <= CURRENT_DATE
        AND (ca.valid_to IS NULL OR ca.valid_to >= CURRENT_DATE)
    )
    INTO v_workspace_grant;

    IF COALESCE(v_workspace_grant, false) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.org_access_allowed(uuid, text) IS
  'Canonical org access gate for RLS and Bob restrictions. Combines direct org scope, JWT authorised orgs, provider-client grants, can_access_service compatibility, and active contractor workspace handshakes.';

GRANT EXECUTE ON FUNCTION public.org_access_allowed(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_can_read_organization(target_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.org_access_allowed(target_org_id, 'freedom_camping');
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_can_read_organization(uuid) TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'observations'
  ) THEN
    DROP POLICY IF EXISTS "org_scope_select_observations_v2" ON public.observations;
    DROP POLICY IF EXISTS "org_scope_select_observations_v3" ON public.observations;
    CREATE POLICY "org_scope_select_observations_v3"
      ON public.observations
      FOR SELECT
      TO authenticated
      USING (public.org_access_allowed(organization_id, 'freedom_camping'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'patrol_logs'
  ) THEN
    DROP POLICY IF EXISTS "org_scope_select_patrol_logs_v2" ON public.patrol_logs;
    DROP POLICY IF EXISTS "org_scope_select_patrol_logs_v3" ON public.patrol_logs;
    CREATE POLICY "org_scope_select_patrol_logs_v3"
      ON public.patrol_logs
      FOR SELECT
      TO authenticated
      USING (public.org_access_allowed(organization_id, 'freedom_camping'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'breach_alerts'
  ) THEN
    DROP POLICY IF EXISTS "org_scope_select_breach_alerts_v2" ON public.breach_alerts;
    DROP POLICY IF EXISTS "org_scope_select_breach_alerts_v3" ON public.breach_alerts;
    CREATE POLICY "org_scope_select_breach_alerts_v3"
      ON public.breach_alerts
      FOR SELECT
      TO authenticated
      USING (public.org_access_allowed(organization_id, 'freedom_camping'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'patrols'
  ) THEN
    DROP POLICY IF EXISTS "org_scope_select_patrols_v2" ON public.patrols;
    DROP POLICY IF EXISTS "org_scope_select_patrols_v3" ON public.patrols;
    CREATE POLICY "org_scope_select_patrols_v3"
      ON public.patrols
      FOR SELECT
      TO authenticated
      USING (public.org_access_allowed(organization_id, 'freedom_camping'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'incidents'
  ) THEN
    DROP POLICY IF EXISTS "org_scope_select_incidents_v2" ON public.incidents;
    DROP POLICY IF EXISTS "org_scope_select_incidents_v3" ON public.incidents;
    CREATE POLICY "org_scope_select_incidents_v3"
      ON public.incidents
      FOR SELECT
      TO authenticated
      USING (public.org_access_allowed(organization_id, 'freedom_camping'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'enforcement_actions'
  ) THEN
    DROP POLICY IF EXISTS "org_scope_select_enforcement_actions_v2" ON public.enforcement_actions;
    DROP POLICY IF EXISTS "org_scope_select_enforcement_actions_v3" ON public.enforcement_actions;
    CREATE POLICY "org_scope_select_enforcement_actions_v3"
      ON public.enforcement_actions
      FOR SELECT
      TO authenticated
      USING (
        organization_id IS NOT NULL
        AND public.org_access_allowed(organization_id, 'freedom_camping')
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'zones'
  ) THEN
    DROP POLICY IF EXISTS "org_scope_select_zones_v2" ON public.zones;
    DROP POLICY IF EXISTS "org_scope_select_zones_v3" ON public.zones;
    CREATE POLICY "org_scope_select_zones_v3"
      ON public.zones
      FOR SELECT
      TO authenticated
      USING (public.org_access_allowed(organization_id, 'freedom_camping'));
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'client_sites'
  ) THEN
    DROP POLICY IF EXISTS "org_scope_select_client_sites_v2" ON public.client_sites;
    DROP POLICY IF EXISTS "org_scope_select_client_sites_v3" ON public.client_sites;
    CREATE POLICY "org_scope_select_client_sites_v3"
      ON public.client_sites
      FOR SELECT
      TO authenticated
      USING (public.org_access_allowed(organization_id, 'site_guarding'));
  END IF;
END;
$$;
