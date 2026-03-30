-- ============================================================================
-- Harden user role helper functions + admins_manage_profiles policy
-- Date: 2026-05-03
--
-- SECURITY DEFINER functions should set search_path to 'public' to prevent
-- potential security issues where a malicious user could create objects in
-- their own schema that shadow public schema objects.
--
-- Also adds grand_master to the user_profiles RLS policy for admins_manage_profiles
-- if not already present, ensuring grand_master can manage all user profiles.
-- ============================================================================

-- Fix get_user_role with proper search_path
CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
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

-- Fix get_user_organization_id with proper search_path
CREATE OR REPLACE FUNCTION public.get_user_organization_id(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
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

-- NOTE: Do not redefine get_user_organization_ids() here.
-- Newer migrations contain the canonical org-scoped implementation and
-- redefining it in this migration would regress role/org access behavior.

-- Ensure admins_manage_profiles policy includes grand_master
-- Drop and recreate to ensure it has all required roles
DROP POLICY IF EXISTS admins_manage_profiles ON user_profiles;
CREATE POLICY admins_manage_profiles ON user_profiles
  FOR ALL TO authenticated
  USING (public.get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master'));

-- Grant execute on the helper functions to authenticated users
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_organization_id(UUID) TO authenticated;
