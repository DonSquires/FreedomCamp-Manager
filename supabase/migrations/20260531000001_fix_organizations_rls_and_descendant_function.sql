-- Hotfix: organizations RLS reliability + descendant helper hardening
-- Date: 2026-05-31

CREATE OR REPLACE FUNCTION public.get_descendant_organizations(org_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  descendants uuid[];
BEGIN
  WITH RECURSIVE org_tree AS (
    SELECT id, parent_organization_id
    FROM public.organizations
    WHERE id = org_id
    UNION ALL
    SELECT o.id, o.parent_organization_id
    FROM public.organizations o
    INNER JOIN org_tree ot ON o.parent_organization_id = ot.id
  )
  SELECT array_agg(id) INTO descendants FROM org_tree;

  RETURN COALESCE(descendants, ARRAY[]::uuid[]);
END;
$$;

COMMENT ON FUNCTION public.get_descendant_organizations(uuid) IS
  'Returns organization ID + all descendants. SECURITY DEFINER to avoid RLS recursion in policy evaluation.';

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "org_member_read_descendant_orgs" ON public.organizations;
  CREATE POLICY "org_member_read_descendant_orgs"
    ON public.organizations
    FOR SELECT
    TO authenticated
    USING (
      get_user_role(auth.uid()) IN ('admin', 'master', 'admin_officer', 'officer')
      AND id = ANY(get_user_organization_ids())
    );
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "admin_manage_descendant_orgs" ON public.organizations;
  CREATE POLICY "admin_manage_descendant_orgs"
    ON public.organizations
    FOR ALL
    TO authenticated
    USING (
      get_user_role(auth.uid()) IN ('admin', 'master')
      AND id = ANY(get_user_organization_ids())
    )
    WITH CHECK (
      get_user_role(auth.uid()) IN ('admin', 'master')
      AND id = ANY(get_user_organization_ids())
    );
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';