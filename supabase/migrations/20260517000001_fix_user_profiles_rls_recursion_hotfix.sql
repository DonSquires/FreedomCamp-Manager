-- =============================================================================
-- Hotfix: eliminate infinite recursion in user_profiles RLS policies
-- Date: 2026-05-17
--
-- Symptom:
--   infinite recursion detected in policy for relation "user_profiles"
--
-- Cause:
--   Any ON user_profiles policy that directly SELECTs from user_profiles in
--   USING / WITH CHECK can recursively re-enter RLS evaluation.
--
-- Strategy:
--   1) Ensure helper functions are SECURITY DEFINER and fixed to public schema.
--   2) Drop potentially recursive user_profiles policies.
--   3) Recreate only non-recursive policies using auth.uid() and helpers.
--   4) Keep admin management policy role-based and non-recursive.
-- =============================================================================

-- 1) Harden helper functions used by user_profiles policies
CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role
  FROM public.user_profiles
  WHERE id = p_user_id;
  RETURN COALESCE(v_role, 'officer');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_organization_id(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM public.user_profiles
  WHERE id = p_user_id;
  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_organization_id(UUID) TO authenticated;

-- 2) Remove known/legacy policies that can conflict or recurse
DROP POLICY IF EXISTS "authenticated_view_all_user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "users_view_user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "users_select_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "users_select_own_profile" ON public.user_profiles;
DROP POLICY IF EXISTS "users_view_own_profile" ON public.user_profiles;
DROP POLICY IF EXISTS "users_view_org_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "client_viewer_view_user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "grand_master_all_user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "anon_insert_profile_on_signup" ON public.user_profiles;
DROP POLICY IF EXISTS "users_update_own_profile" ON public.user_profiles;
DROP POLICY IF EXISTS "admins_manage_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "officers_view_own_compliance" ON public.user_profiles;
DROP POLICY IF EXISTS "admins_view_org_compliance" ON public.user_profiles;

-- 3) Recreate non-recursive policies

-- Read own row
CREATE POLICY "users_view_own_profile"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- Read org rows + elevated roles
CREATE POLICY "users_view_org_profiles"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_user_organization_id(auth.uid())
    OR public.get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
  );

-- Client portal row visibility (own org only)
CREATE POLICY "client_viewer_view_user_profiles"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (
    public.get_user_role(auth.uid()) IN ('client_viewer', 'client_officer', 'client_admin')
    AND organization_id = public.get_user_organization_id(auth.uid())
  );

-- Update own row only
CREATE POLICY "users_update_own_profile"
  ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Optional signup insert path for anon profile bootstrap
CREATE POLICY "anon_insert_profile_on_signup"
  ON public.user_profiles
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Admin/master management policy (non-recursive)
CREATE POLICY "admins_manage_profiles"
  ON public.user_profiles
  FOR ALL
  TO authenticated
  USING (public.get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master'));

-- Compliance read policy equivalents (non-recursive)
CREATE POLICY "officers_view_own_compliance"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    AND role IN ('officer', 'admin_officer')
  );

CREATE POLICY "admins_view_org_compliance"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (
    public.get_user_role(auth.uid()) IN ('admin', 'master', 'grand_master')
    AND organization_id = public.get_user_organization_id(auth.uid())
  );

-- Ensure RLS is on and refresh schema cache
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
