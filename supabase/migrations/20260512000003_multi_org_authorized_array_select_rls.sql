-- Extend org-scoped SELECT RLS for multi-org authorized users.
-- Source of truth for this migration: JWT claim `user_authorised_organisations`.

CREATE OR REPLACE FUNCTION public.get_jwt_authorised_organisation_ids()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim jsonb;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  v_claim := auth.jwt() -> 'user_authorised_organisations';

  IF v_claim IS NULL OR jsonb_typeof(v_claim) <> 'array' THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  SELECT COALESCE(array_agg(DISTINCT value::uuid), ARRAY[]::uuid[])
  INTO v_ids
  FROM jsonb_array_elements_text(v_claim) AS value
  WHERE value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  RETURN COALESCE(v_ids, ARRAY[]::uuid[]);
EXCEPTION
  WHEN OTHERS THEN
    -- Fail closed: malformed JWT claim should not expand access.
    RETURN ARRAY[]::uuid[];
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_jwt_authorised_organisation_ids() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_can_read_organization(target_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service_grant boolean := false;
BEGIN
  IF target_org_id IS NULL OR auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF target_org_id = ANY(public.get_user_organization_ids()) THEN
    RETURN true;
  END IF;

  IF target_org_id = ANY(public.get_jwt_authorised_organisation_ids()) THEN
    RETURN true;
  END IF;

  -- Preserve provider/service access behavior when available.
  IF to_regprocedure('public.can_access_service(uuid,text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.can_access_service($1, $2)'
      INTO v_service_grant
      USING target_org_id, 'freedom_camping';
    IF COALESCE(v_service_grant, false) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
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
    CREATE POLICY "org_scope_select_observations_v2"
      ON public.observations
      FOR SELECT
      TO authenticated
      USING (
        public.user_can_read_organization(organization_id)
      );
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
    CREATE POLICY "org_scope_select_patrol_logs_v2"
      ON public.patrol_logs
      FOR SELECT
      TO authenticated
      USING (
        public.user_can_read_organization(organization_id)
      );
  END IF;
END;
$$;
