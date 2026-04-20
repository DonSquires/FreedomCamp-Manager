-- Unified org-scope helper + standard org-scoped SELECT policies.

CREATE OR REPLACE FUNCTION public.get_user_effective_access_scope()
RETURNS TABLE (organization_id uuid, access_reason text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_primary_org uuid;
  v_extra_org_ids uuid[] := ARRAY[]::uuid[];
  v_authorized_locations uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    up.role,
    up.organization_id,
    COALESCE(up.extra_organization_ids, ARRAY[]::uuid[]),
    COALESCE(up.authorized_work_locations, ARRAY[]::uuid[])
  INTO
    v_role,
    v_primary_org,
    v_extra_org_ids,
    v_authorized_locations
  FROM public.user_profiles up
  WHERE up.id = v_user_id;

  IF v_role IN ('grand_master', 'master') THEN
    RETURN QUERY
      SELECT o.id, 'master_role'::text
      FROM public.organizations o
      WHERE COALESCE(o.is_active, true);
    RETURN;
  END IF;

  IF v_primary_org IS NOT NULL THEN
    RETURN QUERY
      SELECT DISTINCT x.org_id, 'hierarchy'::text
      FROM (
        SELECT v_primary_org AS org_id
        UNION ALL
        SELECT UNNEST(COALESCE(public.get_descendant_organizations(v_primary_org), ARRAY[]::uuid[]))
      ) x
      WHERE x.org_id IS NOT NULL;
  END IF;

  RETURN QUERY
    SELECT DISTINCT org_id, 'user_override_extra'::text
    FROM UNNEST(v_extra_org_ids) AS org_id
    WHERE org_id IS NOT NULL;

  RETURN QUERY
    SELECT DISTINCT org_id, 'user_override_location'::text
    FROM UNNEST(v_authorized_locations) AS org_id
    WHERE org_id IS NOT NULL;

  RETURN QUERY
    WITH base_access AS (
      SELECT DISTINCT x.org_id
      FROM (
        SELECT v_primary_org AS org_id
        UNION ALL
        SELECT UNNEST(COALESCE(public.get_descendant_organizations(v_primary_org), ARRAY[]::uuid[]))
        UNION ALL
        SELECT UNNEST(v_extra_org_ids)
        UNION ALL
        SELECT UNNEST(v_authorized_locations)
      ) x
      WHERE x.org_id IS NOT NULL
    )
    SELECT DISTINCT g.client_org_id, 'provider_grant:' || g.service_type::text
    FROM public.provider_client_access_grants g
    JOIN base_access b ON b.org_id = g.provider_org_id
    WHERE g.is_active
      AND g.allow_without_roster = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_organization_ids_v2()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_primary_org uuid;
  v_extra_org_ids uuid[] := ARRAY[]::uuid[];
  v_authorized_locations uuid[] := ARRAY[]::uuid[];
  v_result uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_user_id IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  SELECT
    up.role,
    up.organization_id,
    COALESCE(up.extra_organization_ids, ARRAY[]::uuid[]),
    COALESCE(up.authorized_work_locations, ARRAY[]::uuid[])
  INTO
    v_role,
    v_primary_org,
    v_extra_org_ids,
    v_authorized_locations
  FROM public.user_profiles up
  WHERE up.id = v_user_id;

  IF v_role IN ('grand_master', 'master') THEN
    SELECT COALESCE(array_agg(o.id), ARRAY[]::uuid[])
    INTO v_result
    FROM public.organizations o
    WHERE COALESCE(o.is_active, true);
    RETURN v_result;
  END IF;

  IF v_primary_org IS NOT NULL THEN
    v_result := array_cat(v_result, ARRAY[v_primary_org]::uuid[]);
    v_result := array_cat(v_result, COALESCE(public.get_descendant_organizations(v_primary_org), ARRAY[]::uuid[]));
  END IF;

  v_result := array_cat(v_result, v_extra_org_ids);
  v_result := array_cat(v_result, v_authorized_locations);

  SELECT COALESCE(array_agg(DISTINCT org_id), ARRAY[]::uuid[])
  INTO v_result
  FROM unnest(v_result) AS org_id
  WHERE org_id IS NOT NULL;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_service(
  p_org_id uuid,
  p_service_type text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service_type public.provider_service_type;
BEGIN
  IF p_org_id IS NULL OR auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF public.get_user_role(auth.uid()) IN ('grand_master', 'master') THEN
    RETURN true;
  END IF;

  IF p_org_id = ANY(public.get_user_organization_ids_v2()) THEN
    RETURN true;
  END IF;

  BEGIN
    v_service_type := p_service_type::public.provider_service_type;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN false;
  END;

  RETURN EXISTS (
    SELECT 1
    FROM public.provider_client_access_grants g
    WHERE g.provider_org_id = ANY(public.get_user_organization_ids_v2())
      AND g.client_org_id = p_org_id
      AND g.service_type = v_service_type
      AND g.is_active
      AND g.allow_without_roster = true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_effective_access_scope() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_organization_ids_v2() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_service(uuid, text) TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'observations') THEN
    DROP POLICY IF EXISTS "org_scope_select_observations_v2" ON public.observations;
    CREATE POLICY "org_scope_select_observations_v2"
      ON public.observations
      FOR SELECT
      TO authenticated
      USING (
        organization_id = ANY(public.get_user_organization_ids_v2())
        OR public.can_access_service(organization_id, 'freedom_camping')
      );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'breach_alerts') THEN
    DROP POLICY IF EXISTS "org_scope_select_breach_alerts_v2" ON public.breach_alerts;
    CREATE POLICY "org_scope_select_breach_alerts_v2"
      ON public.breach_alerts
      FOR SELECT
      TO authenticated
      USING (
        organization_id = ANY(public.get_user_organization_ids_v2())
        OR public.can_access_service(organization_id, 'freedom_camping')
      );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patrols') THEN
    DROP POLICY IF EXISTS "org_scope_select_patrols_v2" ON public.patrols;
    CREATE POLICY "org_scope_select_patrols_v2"
      ON public.patrols
      FOR SELECT
      TO authenticated
      USING (
        organization_id = ANY(public.get_user_organization_ids_v2())
        OR public.can_access_service(organization_id, 'freedom_camping')
      );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'incidents') THEN
    DROP POLICY IF EXISTS "org_scope_select_incidents_v2" ON public.incidents;
    CREATE POLICY "org_scope_select_incidents_v2"
      ON public.incidents
      FOR SELECT
      TO authenticated
      USING (
        organization_id = ANY(public.get_user_organization_ids_v2())
        OR public.can_access_service(organization_id, 'freedom_camping')
      );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'client_sites') THEN
    DROP POLICY IF EXISTS "org_scope_select_client_sites_v2" ON public.client_sites;
    CREATE POLICY "org_scope_select_client_sites_v2"
      ON public.client_sites
      FOR SELECT
      TO authenticated
      USING (
        organization_id = ANY(public.get_user_organization_ids_v2())
        OR public.can_access_service(organization_id, 'site_guarding')
      );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'enforcement_actions') THEN
    DROP POLICY IF EXISTS "org_scope_select_enforcement_actions_v2" ON public.enforcement_actions;
    CREATE POLICY "org_scope_select_enforcement_actions_v2"
      ON public.enforcement_actions
      FOR SELECT
      TO authenticated
      USING (
        organization_id IS NOT NULL
        AND (
          organization_id = ANY(public.get_user_organization_ids_v2())
          OR public.can_access_service(organization_id, 'freedom_camping')
        )
      );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'zones') THEN
    DROP POLICY IF EXISTS "org_scope_select_zones_v2" ON public.zones;
    CREATE POLICY "org_scope_select_zones_v2"
      ON public.zones
      FOR SELECT
      TO authenticated
      USING (
        organization_id = ANY(public.get_user_organization_ids_v2())
        OR public.can_access_service(organization_id, 'freedom_camping')
      );
  END IF;
END $$;
