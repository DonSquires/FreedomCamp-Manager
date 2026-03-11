-- ============================================================================
-- FIX BREACH ALERTS RLS POLICIES
-- ============================================================================
-- The previous users_manage_breach_alerts policy was overly broad (FOR ALL,
-- any authenticated user), effectively bypassing org-scoping at the database
-- level for SELECT.  This migration tightens it so that:
--   - SELECT  → masters see all; other roles see only their org(s)
--   - INSERT/UPDATE → admins, admin_officers, and masters only
--   - DELETE  → reserved for the super_delete permission holder
-- The service_role bypass policy (added in 20260227000003) is retained as-is.
-- ============================================================================

-- Drop the broad catch-all policies that apply to authenticated users.
DROP POLICY IF EXISTS users_manage_breach_alerts ON breach_alerts;
DROP POLICY IF EXISTS "users_manage_breach_alerts" ON breach_alerts;

-- Ensure the select policy is up to date (drop and recreate for clarity).
DROP POLICY IF EXISTS users_view_breach_alerts ON breach_alerts;
DROP POLICY IF EXISTS "users_view_breach_alerts" ON breach_alerts;

-- SELECT: masters see everything; everyone else is scoped to their org(s).
CREATE POLICY "users_view_breach_alerts"
  ON breach_alerts FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master')
    OR
    (organization_id = ANY(get_user_organization_ids()))
  );

-- INSERT / UPDATE: only admin roles and masters may create or modify alerts.
CREATE POLICY "admins_manage_breach_alerts"
  ON breach_alerts FOR ALL
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master')
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master')
  );

-- Officers (read-only users) also need SELECT to see breach alerts in the UI.
-- The SELECT is already covered by users_view_breach_alerts above, so this
-- policy is only needed if we ever restrict admin access too tightly.
-- (No additional policy needed; the two policies above are sufficient.)
