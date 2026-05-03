-- Migration: Enable RLS on organizations table and add properly-scoped policies
-- Sprint 1 / B-01 — CRM org isolation
-- Date: 2026-05-03

-- Step 1: Enable RLS on the organizations table.
-- Previously policies were defined but RLS was never enabled, meaning all
-- authenticated users could read all organization records regardless of their role.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Step 2: grand_master — full access to all organizations (already defined, re-affirm).
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

-- Step 3: admin / master / admin_officer / officer — can read their own org and
-- all descendant organizations via the existing get_descendant_organizations() RPC.
DO $$ BEGIN
  DROP POLICY IF EXISTS "org_member_read_descendant_orgs" ON public.organizations;
  CREATE POLICY "org_member_read_descendant_orgs"
    ON public.organizations
    FOR SELECT
    TO authenticated
    USING (
      get_user_role(auth.uid()) IN ('admin', 'master', 'admin_officer', 'officer')
      AND id IN (
        SELECT unnest(get_descendant_organizations(
          (SELECT organization_id FROM user_profiles WHERE id = auth.uid() LIMIT 1)
        ))
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Step 4: admin can INSERT / UPDATE / DELETE organizations within their own
-- descendant tree (required for org management functions).
DO $$ BEGIN
  DROP POLICY IF EXISTS "admin_manage_descendant_orgs" ON public.organizations;
  CREATE POLICY "admin_manage_descendant_orgs"
    ON public.organizations
    FOR ALL
    TO authenticated
    USING (
      get_user_role(auth.uid()) IN ('admin', 'master')
      AND id IN (
        SELECT unnest(get_descendant_organizations(
          (SELECT organization_id FROM user_profiles WHERE id = auth.uid() LIMIT 1)
        ))
      )
    )
    WITH CHECK (
      get_user_role(auth.uid()) IN ('admin', 'master')
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Step 5: client roles — can read only their own organization.
-- Replaces the previously defined client_viewer_view_own_organization policy.
DO $$ BEGIN
  DROP POLICY IF EXISTS "client_viewer_view_own_organization" ON public.organizations;
  CREATE POLICY "client_viewer_view_own_organization"
    ON public.organizations
    FOR SELECT
    TO authenticated
    USING (
      get_user_role(auth.uid()) IN ('client_viewer', 'client_officer', 'client_admin')
      AND id = (
        SELECT organization_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Step 6: nzscv_monitor — no organization record access needed.
-- No policy added; they see nothing (RLS default deny).
