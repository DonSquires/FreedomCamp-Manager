-- Enable missing RLS coverage and align org visibility policies
-- Supabase Advisor follow-up: organizations, drift_events, zone_compliance_matrix

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'organizations'
  ) THEN
    ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "grand_master_all_orgs" ON public.organizations;
    CREATE POLICY "grand_master_all_orgs"
      ON public.organizations
      FOR ALL
      TO authenticated
      USING (get_user_role(auth.uid()) = 'grand_master')
      WITH CHECK (get_user_role(auth.uid()) = 'grand_master');

    DROP POLICY IF EXISTS "client_viewer_view_own_organization" ON public.organizations;
    CREATE POLICY "client_viewer_view_own_organization"
      ON public.organizations
      FOR SELECT
      TO authenticated
      USING (
        get_user_role(auth.uid()) IN ('client_viewer', 'client_officer', 'client_admin')
        AND id = get_user_organization_id(auth.uid())
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'drift_events'
  ) THEN
    ALTER TABLE public.drift_events ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "users_view_org_drift_events" ON public.drift_events;
    CREATE POLICY "users_view_org_drift_events"
      ON public.drift_events
      FOR SELECT
      TO authenticated
      USING (
        get_user_role(auth.uid()) = 'grand_master'
        OR (
          get_user_role(auth.uid()) IN ('master', 'admin', 'admin_officer', 'officer')
          AND organization_id = ANY(get_user_organization_ids())
        )
        OR (
          get_user_role(auth.uid()) IN ('client_viewer', 'client_officer', 'client_admin')
          AND organization_id = get_user_organization_id(auth.uid())
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'zone_compliance_matrix'
  ) THEN
    ALTER TABLE public.zone_compliance_matrix ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "users_view_org_matrix" ON public.zone_compliance_matrix;
    CREATE POLICY "users_view_org_matrix"
      ON public.zone_compliance_matrix
      FOR SELECT
      TO authenticated
      USING (
        get_user_role(auth.uid()) = 'grand_master'
        OR (
          get_user_role(auth.uid()) IN ('master', 'admin', 'admin_officer', 'officer')
          AND organization_id = ANY(get_user_organization_ids())
        )
        OR (
          get_user_role(auth.uid()) IN ('client_viewer', 'client_officer', 'client_admin')
          AND organization_id = get_user_organization_id(auth.uid())
        )
      );
  END IF;
END
$$;
