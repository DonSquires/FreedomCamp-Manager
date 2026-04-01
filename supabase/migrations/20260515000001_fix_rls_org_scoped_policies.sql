-- ============================================================================
-- Migration: Fix RLS Policies - Replace USING (true) with Org-Scoped Policies
-- Date: 2026-05-15
-- Purpose: Critical security fix - ensure data isolation between organizations
-- ============================================================================

-- Helper function to check if user belongs to an organization
CREATE OR REPLACE FUNCTION auth.user_belongs_to_org(target_org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- Check if user's primary organization matches
  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid()
    AND (
      organization_id = target_org_id
      OR target_org_id = ANY(extra_organization_ids)
    )
  ) THEN
    RETURN TRUE;
  END IF;
  
  -- Grand masters can see all organizations
  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND role = 'grand_master'
  ) THEN
    RETURN TRUE;
  END IF;
  
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- Secure breach_alerts: Users should only see/update alerts from their org
-- ============================================================================
DROP POLICY IF EXISTS "system_update_breach_alerts" ON breach_alerts;
DROP POLICY IF EXISTS "authenticated_view_breach_alerts" ON breach_alerts;

-- Users can view breach alerts from their organization
CREATE POLICY "authenticated_view_breach_alerts"
  ON breach_alerts FOR SELECT
  TO authenticated
  USING (
    organization_id IS NULL -- System-wide alerts
    OR auth.user_belongs_to_org(organization_id)
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('grand_master', 'master')
    )
  );

-- Users can update breach alerts from their organization
CREATE POLICY "authenticated_update_breach_alerts"
  ON breach_alerts FOR UPDATE
  TO authenticated
  USING (
    organization_id IS NULL
    OR auth.user_belongs_to_org(organization_id)
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('grand_master', 'master')
    )
  )
  WITH CHECK (
    organization_id IS NULL
    OR auth.user_belongs_to_org(organization_id)
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('grand_master', 'master')
    )
  );

-- ============================================================================
-- Secure user_profiles: Users should only see profiles from their org
-- (Note: Officers need to see colleagues for dispatch/welfare)
-- ============================================================================
DROP POLICY IF EXISTS "authenticated_view_all_user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "users_view_user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "users_select_profiles" ON user_profiles;

-- Users can view their own profile
CREATE POLICY "users_view_own_profile"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- Users can view profiles from their organization
CREATE POLICY "users_view_org_profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (
    auth.user_belongs_to_org(organization_id)
    OR EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('grand_master', 'master')
    )
  );

-- Users can update their own profile
CREATE POLICY "users_update_own_profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ============================================================================
-- Secure incidents table (if exists)
-- ============================================================================
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'incidents') THEN
    EXECUTE 'DROP POLICY IF EXISTS "authenticated_view_incidents" ON incidents';
    EXECUTE 'DROP POLICY IF EXISTS "users_view_incidents" ON incidents';
    
    -- Users can view incidents from their organization
    EXECUTE '
      CREATE POLICY "users_view_org_incidents"
        ON incidents FOR SELECT
        TO authenticated
        USING (
          organization_id IS NULL
          OR auth.user_belongs_to_org(organization_id)
          OR EXISTS (
            SELECT 1 FROM user_profiles
            WHERE id = auth.uid() AND role IN (''grand_master'', ''master'')
          )
        )
    ';
  END IF;
END $$;

-- ============================================================================
-- Secure patrols table (if exists)
-- ============================================================================
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'patrols') THEN
    EXECUTE 'DROP POLICY IF EXISTS "authenticated_view_patrols" ON patrols';
    EXECUTE 'DROP POLICY IF EXISTS "users_view_patrols" ON patrols';
    
    -- Users can view patrols from their organization
    EXECUTE '
      CREATE POLICY "users_view_org_patrols"
        ON patrols FOR SELECT
        TO authenticated
        USING (
          organization_id IS NULL
          OR auth.user_belongs_to_org(organization_id)
          OR EXISTS (
            SELECT 1 FROM user_profiles
            WHERE id = auth.uid() AND role IN (''grand_master'', ''master'')
          )
        )
    ';
  END IF;
END $$;

-- ============================================================================
-- IMPORTANT: canonical_vehicles stays USING (true) intentionally
-- Officers need to see all flagged/dangerous vehicles across orgs for safety
-- This is a documented security trade-off for officer safety
-- ============================================================================

-- Add comment explaining the trade-off
COMMENT ON TABLE canonical_vehicles IS 
  'Vehicle records - intentionally visible to all authenticated users for officer safety. '
  'Officers need to see flagged/dangerous vehicles across all organizations.';

-- ============================================================================
-- Grant execute on helper function
-- ============================================================================
GRANT EXECUTE ON FUNCTION auth.user_belongs_to_org(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION auth.user_belongs_to_org(UUID) TO service_role;

-- ============================================================================
-- Log the security fix
-- ============================================================================
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_log') THEN
    INSERT INTO audit_log (action, table_name, details, created_at)
    VALUES (
      'SECURITY_FIX',
      'multiple',
      jsonb_build_object(
        'migration', '20260515000001_fix_rls_org_scoped_policies',
        'description', 'Fixed RLS policies to be org-scoped instead of USING (true)',
        'tables_fixed', ARRAY['breach_alerts', 'user_profiles', 'incidents', 'patrols'],
        'tables_intentionally_open', ARRAY['canonical_vehicles']
      ),
      NOW()
    );
  END IF;
END $$;
