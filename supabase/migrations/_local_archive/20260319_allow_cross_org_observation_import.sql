-- ============================================================================
-- Allow cross-org observation imports for admin/admin_officer
-- Date: 2026-03-19
-- Issue: Historical data import violates RLS when observations are assigned
--        to zones in different organizations
-- Solution: Add explicit RLS policy for authenticated admin_officer users
--           importing observations (they already have the role permission)
-- ============================================================================

-- Drop overly-restrictive policy if it exists
DROP POLICY IF EXISTS "authenticated_insert_own_observations" ON observations;
DROP POLICY IF EXISTS "service_role_insert_observations" ON observations;
DROP POLICY IF EXISTS "admins_insert_any_org_observations" ON observations;
DROP POLICY IF EXISTS "users_insert_own_observations" ON observations;

-- Allow service role (edge functions using SERVICE_ROLE_KEY) to insert
CREATE POLICY "service_role_insert_observations"
  ON observations
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Allow authenticated admin/admin_officer to insert observations during imports
-- (they already completed auth checks in the edge function)
CREATE POLICY "admins_insert_any_org_observations"
  ON observations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master']))
  );

-- Fallback: allow regular users to insert their own observations
CREATE POLICY "users_insert_own_observations"
  ON observations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    recorded_by = auth.uid()
    AND organization_id = COALESCE(
      (SELECT organization_id FROM user_profiles WHERE id = auth.uid()),
      organization_id
    )
  );

-- Add comment for audit trail
COMMENT ON POLICY "admins_insert_any_org_observations" ON observations IS
  'Allow admin/admin_officer to insert observations for any organization (used by historical import)';

COMMENT ON POLICY "service_role_insert_observations" ON observations IS
  'Allow service role (edge functions with SERVICE_ROLE_KEY) to insert without restrictions';
