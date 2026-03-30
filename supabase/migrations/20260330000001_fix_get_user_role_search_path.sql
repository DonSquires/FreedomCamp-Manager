-- ============================================================================
-- Fix get_user_role and get_user_organization_id search_path
-- Date: 2026-03-30
--
-- SECURITY DEFINER functions should set search_path to 'public' to prevent
-- potential security issues where a malicious user could create objects in
-- their own schema that shadow public schema objects.
--
-- Also adds grand_master to the user_profiles RLS policy for admins_manage_profiles
-- if not already present, ensuring grand_master can manage all user profiles.
-- ============================================================================

-- Fix get_user_role with proper search_path
DROP FUNCTION IF EXISTS get_user_role(UUID);
CREATE OR REPLACE FUNCTION get_user_role(p_user_id UUID)
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
  FROM user_profiles
  WHERE id = p_user_id;
  RETURN COALESCE(v_role, 'officer');
END;
$$;

-- Fix get_user_organization_id with proper search_path
DROP FUNCTION IF EXISTS get_user_organization_id(UUID);
CREATE OR REPLACE FUNCTION get_user_organization_id(p_user_id UUID)
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
  FROM user_profiles
  WHERE id = p_user_id;
  RETURN v_org_id;
END;
$$;

-- Fix get_user_organization_ids with proper search_path (if it exists)
DO $$
BEGIN
  DROP FUNCTION IF EXISTS get_user_organization_ids();
  CREATE OR REPLACE FUNCTION get_user_organization_ids()
  RETURNS UUID[]
  LANGUAGE plpgsql
  SECURITY DEFINER
  STABLE
  SET search_path TO 'public'
  AS $fn$
  DECLARE
    v_org_ids UUID[];
  BEGIN
    -- Get primary organization
    SELECT ARRAY[organization_id] INTO v_org_ids
    FROM user_profiles
    WHERE id = auth.uid();
    
    -- Could be extended to include additional_organizations if that column exists
    RETURN COALESCE(v_org_ids, ARRAY[]::UUID[]);
  END;
  $fn$;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Ensure admins_manage_profiles policy includes grand_master
-- Drop and recreate to ensure it has all required roles
DROP POLICY IF EXISTS admins_manage_profiles ON user_profiles;
CREATE POLICY admins_manage_profiles ON user_profiles
  FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master'));

-- Grant execute on the helper functions to authenticated users
GRANT EXECUTE ON FUNCTION get_user_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_organization_id(UUID) TO authenticated;
