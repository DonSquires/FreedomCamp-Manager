-- =============================================================
-- FIX: Officers receive 403 Forbidden when auto-starting patrols
-- via geofence entry (POST /rest/v1/patrols?select=*)
--
-- Root cause: admins_manage_patrols policy restricts INSERT/UPDATE
-- to admin/admin_officer/master roles only.  Field officers
-- (role = 'officer') need to INSERT their own auto-started patrols
-- and UPDATE them when they leave a geofence.
-- =============================================================

-- Allow officers to INSERT a patrol assigned to themselves
DROP POLICY IF EXISTS officers_insert_own_patrols ON patrols;
CREATE POLICY officers_insert_own_patrols
  ON patrols FOR INSERT
  TO authenticated
  WITH CHECK (
    assigned_to = auth.uid()
    AND organization_id = ANY(get_user_organization_ids())
  );

-- Allow officers to UPDATE their own patrols (e.g. auto-complete on geofence exit).
-- WITH CHECK ensures they cannot change assigned_to or move the patrol to a
-- different organisation.
DROP POLICY IF EXISTS officers_update_own_patrols ON patrols;
CREATE POLICY officers_update_own_patrols
  ON patrols FOR UPDATE
  TO authenticated
  USING (assigned_to = auth.uid())
  WITH CHECK (
    assigned_to = auth.uid()
    AND organization_id = ANY(get_user_organization_ids())
  );
