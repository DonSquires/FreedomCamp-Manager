-- =============================================================================
-- Unified Org Access Write Policy Consolidation
-- Date: 2026-05-13
-- Purpose:
--   1) Add one canonical write gate function for org-scoped mutations.
--   2) Rebind core write policies to the canonical gate to reduce duplicated RLS.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.org_access_allowed_write(
  p_target_org_id uuid,
  p_service_type text DEFAULT 'freedom_camping',
  p_allowed_roles text[] DEFAULT ARRAY['admin','admin_officer','master','grand_master']::text[]
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL OR p_target_org_id IS NULL THEN
    RETURN false;
  END IF;

  v_role := public.get_user_role(auth.uid());

  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (v_role = ANY(COALESCE(p_allowed_roles, ARRAY[]::text[]))) THEN
    RETURN false;
  END IF;

  -- Platform roles are already role-gated above.
  IF v_role IN ('grand_master', 'master') THEN
    RETURN true;
  END IF;

  RETURN public.org_access_allowed(p_target_org_id, p_service_type);
END;
$$;

COMMENT ON FUNCTION public.org_access_allowed_write(uuid, text, text[]) IS
  'Canonical write gate. Enforces role allow-list and org_access_allowed() for mutations.';

GRANT EXECUTE ON FUNCTION public.org_access_allowed_write(uuid, text, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.org_record_not_self(p_record_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_record_user_id IS NULL THEN
    RETURN true;
  END IF;
  RETURN p_record_user_id <> auth.uid();
END;
$$;

COMMENT ON FUNCTION public.org_record_not_self(uuid) IS
  'Conflict-of-interest helper. True when target record owner/creator is not auth.uid().';

GRANT EXECUTE ON FUNCTION public.org_record_not_self(uuid) TO authenticated, service_role;

DO $$
DECLARE
  obs_table text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'observations'
  ) THEN
    obs_table := 'observations';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vehicle_observations_v2'
  ) THEN
    obs_table := 'vehicle_observations_v2';
  ELSE
    obs_table := null;
  END IF;

  IF obs_table IS NOT NULL THEN
    EXECUTE format('DROP POLICY IF EXISTS users_create_observations_v2 ON %I', obs_table);
    EXECUTE format('CREATE POLICY users_create_observations_v2 ON %I FOR INSERT TO authenticated WITH CHECK (public.org_access_allowed_write(organization_id, %L, ARRAY[%L,%L,%L,%L,%L]::text[]))',
      obs_table,
      'freedom_camping',
      'officer', 'admin', 'admin_officer', 'master', 'grand_master'
    );

    EXECUTE format('DROP POLICY IF EXISTS admins_manage_observations_v2 ON %I', obs_table);
    EXECUTE format('CREATE POLICY admins_manage_observations_v2 ON %I FOR UPDATE TO authenticated USING (public.org_access_allowed_write(organization_id, %L, ARRAY[%L,%L,%L,%L]::text[]) AND (public.get_user_role(auth.uid()) <> %L OR public.org_record_not_self(recorded_by))) WITH CHECK (public.org_access_allowed_write(organization_id, %L, ARRAY[%L,%L,%L,%L]::text[]))',
      obs_table,
      'freedom_camping',
      'admin', 'admin_officer', 'master', 'grand_master',
      'admin_officer',
      'freedom_camping',
      'admin', 'admin_officer', 'master', 'grand_master'
    );
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'incidents'
  ) THEN
    DROP POLICY IF EXISTS officers_create_incidents ON public.incidents;
    CREATE POLICY officers_create_incidents
      ON public.incidents FOR INSERT
      TO authenticated
      WITH CHECK (
        public.org_access_allowed_write(
          organization_id,
          'freedom_camping',
          ARRAY['officer','admin','admin_officer','master','grand_master']::text[]
        )
      );

    DROP POLICY IF EXISTS admin_manage_incidents ON public.incidents;
    CREATE POLICY admin_manage_incidents
      ON public.incidents FOR UPDATE
      TO authenticated
      USING (
        public.org_access_allowed_write(
          organization_id,
          'freedom_camping',
          ARRAY['admin','admin_officer','master','grand_master']::text[]
        )
      )
      WITH CHECK (
        public.org_access_allowed_write(
          organization_id,
          'freedom_camping',
          ARRAY['admin','admin_officer','master','grand_master']::text[]
        )
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'enforcement_actions'
  ) THEN
    DROP POLICY IF EXISTS users_insert_enforcement_actions ON public.enforcement_actions;
    CREATE POLICY users_insert_enforcement_actions
      ON public.enforcement_actions FOR INSERT
      TO authenticated
      WITH CHECK (
        public.org_access_allowed_write(
          organization_id,
          'freedom_camping',
          ARRAY['officer','admin','admin_officer','master','grand_master']::text[]
        )
      );

    DROP POLICY IF EXISTS admin_update_enforcement_actions ON public.enforcement_actions;
    CREATE POLICY admin_update_enforcement_actions
      ON public.enforcement_actions FOR UPDATE
      TO authenticated
      USING (
        public.org_access_allowed_write(
          organization_id,
          'freedom_camping',
          ARRAY['admin','admin_officer','master','grand_master']::text[]
        )
      )
      WITH CHECK (
        public.org_access_allowed_write(
          organization_id,
          'freedom_camping',
          ARRAY['admin','admin_officer','master','grand_master']::text[]
        )
      );
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'patrols'
  ) THEN
    DROP POLICY IF EXISTS admins_manage_patrols ON public.patrols;
    CREATE POLICY admins_manage_patrols
      ON public.patrols FOR ALL
      TO authenticated
      USING (
        public.org_access_allowed_write(
          organization_id,
          'freedom_camping',
          ARRAY['admin','admin_officer','master','grand_master']::text[]
        )
      )
      WITH CHECK (
        public.org_access_allowed_write(
          organization_id,
          'freedom_camping',
          ARRAY['admin','admin_officer','master','grand_master']::text[]
        )
      );
  END IF;
END;
$$;
