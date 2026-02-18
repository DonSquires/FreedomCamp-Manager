/**
 * FIX ADMIN_OFFICER PERMISSIONS
 * 
 * Problem: admin_officer users currently only see their own data in Admin Portal
 * Solution: 
 * - SELECT: admin_officer sees ALL org data (same as admin/master)
 * - INSERT: admin_officer can create records
 * - UPDATE: admin_officer can edit records they DIDN'T create (conflict of interest prevention)
 * - DELETE: admin_officer follows same rules as admin
 */

-- ============================================================
-- HELPER FUNCTION: Check if user created a specific record
-- ============================================================

CREATE OR REPLACE FUNCTION user_created_record(record_user_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN record_user_id = auth.uid();
END;
$$;

COMMENT ON FUNCTION user_created_record IS 'Returns true if current user created the record (for conflict of interest prevention)';

-- ============================================================
-- 1. VEHICLE_OBSERVATIONS_V2
-- ============================================================

-- Drop existing policies
DROP POLICY IF EXISTS users_view_observations_v2 ON vehicle_observations_v2;
DROP POLICY IF EXISTS admins_manage_observations_v2 ON vehicle_observations_v2;

-- SELECT: admin_officer sees ALL org data
CREATE POLICY users_view_observations_v2
  ON vehicle_observations_v2 FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master')
    OR
    (organization_id = ANY(get_user_organization_ids()))
  );

-- INSERT: admin_officer can create
CREATE POLICY users_create_observations_v2
  ON vehicle_observations_v2 FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
    )
  );

-- UPDATE: admin_officer can edit, but NOT their own records
CREATE POLICY admins_manage_observations_v2
  ON vehicle_observations_v2 FOR UPDATE
  TO authenticated
  USING (
    (
      (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text]))
      AND
      (
        (get_user_role(auth.uid()) = 'master')
        OR
        (organization_id = get_user_organization_id(auth.uid()))
      )
      AND
      -- admin_officer CANNOT edit their own records (conflict of interest)
      (
        (get_user_role(auth.uid()) != 'admin_officer')
        OR
        (recorded_by != auth.uid())
      )
    )
  );

COMMENT ON POLICY admins_manage_observations_v2 ON vehicle_observations_v2 IS 
  'Admins and admin_officers can edit observations, but admin_officers cannot edit their own (conflict of interest)';

-- ============================================================
-- 2. INCIDENTS
-- ============================================================

-- Drop existing policies
DROP POLICY IF EXISTS org_users_select_incidents ON incidents;
DROP POLICY IF EXISTS admin_manage_incidents ON incidents;
DROP POLICY IF EXISTS officers_update_own_incidents ON incidents;

-- SELECT: admin_officer sees ALL org data
CREATE POLICY org_users_select_incidents
  ON incidents FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master')
    OR
    (organization_id = ANY(get_user_organization_ids()))
  );

-- INSERT: admin_officer can create
CREATE POLICY officers_create_incidents
  ON incidents FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      (organization_id = get_user_organization_id(auth.uid()))
      AND
      (user_id = auth.uid())
    )
  );

-- UPDATE: admin_officer can edit, but NOT their own records
CREATE POLICY admin_manage_incidents
  ON incidents FOR UPDATE
  TO authenticated
  USING (
    (
      (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text]))
      AND
      (
        (get_user_role(auth.uid()) = 'master')
        OR
        (organization_id = get_user_organization_id(auth.uid()))
      )
      AND
      -- admin_officer CANNOT edit their own records (conflict of interest)
      (
        (get_user_role(auth.uid()) != 'admin_officer')
        OR
        (user_id != auth.uid())
      )
    )
  );

-- Officers can only update their own non-court-ready incidents
CREATE POLICY officers_update_own_incidents
  ON incidents FOR UPDATE
  TO authenticated
  USING (
    (
      (user_id = auth.uid())
      AND
      (court_ready = false)
      AND
      (get_user_role(auth.uid()) NOT IN ('admin', 'admin_officer', 'master'))
    )
  );

COMMENT ON POLICY admin_manage_incidents ON incidents IS 
  'Admins and admin_officers can edit incidents, but admin_officers cannot edit their own (conflict of interest)';

-- ============================================================
-- 3. ENFORCEMENT_ACTIONS
-- ============================================================

-- Drop existing policies
DROP POLICY IF EXISTS org_users_select_enforcement_actions ON enforcement_actions;
DROP POLICY IF EXISTS admin_update_enforcement_actions ON enforcement_actions;

-- SELECT: admin_officer sees ALL org data
CREATE POLICY org_users_select_enforcement_actions
  ON enforcement_actions FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master')
    OR
    (organization_id = ANY(get_user_organization_ids()))
  );

-- INSERT: admin_officer can create
CREATE POLICY users_insert_enforcement_actions
  ON enforcement_actions FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      (organization_id IN (
        SELECT user_profiles.organization_id
        FROM user_profiles
        WHERE user_profiles.id = auth.uid()
      ))
      OR
      (get_user_role(auth.uid()) = 'master')
    )
  );

-- UPDATE: admin_officer can edit, but NOT their own records
CREATE POLICY admin_update_enforcement_actions
  ON enforcement_actions FOR UPDATE
  TO authenticated
  USING (
    (
      (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text]))
      AND
      (
        (get_user_role(auth.uid()) = 'master')
        OR
        (organization_id = get_user_organization_id(auth.uid()))
      )
      AND
      -- admin_officer CANNOT edit their own records (conflict of interest)
      (
        (get_user_role(auth.uid()) != 'admin_officer')
        OR
        (user_id != auth.uid())
      )
    )
  );

COMMENT ON POLICY admin_update_enforcement_actions ON enforcement_actions IS 
  'Admins and admin_officers can edit enforcement actions, but admin_officers cannot edit their own (conflict of interest)';

-- ============================================================
-- 4. BREACH_ALERTS
-- ============================================================

-- Drop existing policies
DROP POLICY IF EXISTS users_view_breach_alerts ON breach_alerts;
DROP POLICY IF EXISTS users_manage_breach_alerts ON breach_alerts;

-- SELECT: admin_officer sees ALL org data
CREATE POLICY users_view_breach_alerts
  ON breach_alerts FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master')
    OR
    (organization_id = ANY(get_user_organization_ids()))
  );

-- UPDATE: admin_officer can manage all breach alerts (no conflict since they don't create them)
CREATE POLICY users_manage_breach_alerts
  ON breach_alerts FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
    )
  );

-- ============================================================
-- 5. HEALTH_SAFETY_REPORTS
-- ============================================================

-- Drop existing policies
DROP POLICY IF EXISTS users_view_hs_reports ON health_safety_reports;
DROP POLICY IF EXISTS admins_update_hs_reports ON health_safety_reports;

-- SELECT: admin_officer sees ALL org data
CREATE POLICY users_view_hs_reports
  ON health_safety_reports FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master')
    OR
    (organization_id = ANY(get_user_organization_ids()))
  );

-- UPDATE: admin_officer can edit, but NOT their own records
CREATE POLICY admins_update_hs_reports
  ON health_safety_reports FOR UPDATE
  TO authenticated
  USING (
    (
      (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text]))
      AND
      -- admin_officer CANNOT edit their own records (conflict of interest)
      (
        (get_user_role(auth.uid()) != 'admin_officer')
        OR
        (reported_by != auth.uid())
      )
    )
  );

-- ============================================================
-- 6. PLATE_SCANS
-- ============================================================

-- Drop existing policies
DROP POLICY IF EXISTS users_view_own_scans ON plate_scans;
DROP POLICY IF EXISTS admins_view_org_scans ON plate_scans;
DROP POLICY IF EXISTS admins_update_scans ON plate_scans;
DROP POLICY IF EXISTS officers_update_own_scans ON plate_scans;

-- SELECT: Officers see own, admin_officer sees ALL org
CREATE POLICY users_view_plate_scans
  ON plate_scans FOR SELECT
  TO authenticated
  USING (
    (scanned_by = auth.uid())
    OR
    (
      (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text]))
      AND
      (
        (get_user_role(auth.uid()) = 'master')
        OR
        (organization_id = get_user_organization_id(auth.uid()))
      )
    )
  );

-- UPDATE: admin_officer can edit, but NOT their own records
CREATE POLICY admins_update_scans
  ON plate_scans FOR UPDATE
  TO authenticated
  USING (
    (
      (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text]))
      AND
      (
        (get_user_role(auth.uid()) = 'master')
        OR
        (organization_id = get_user_organization_id(auth.uid()))
      )
      AND
      -- admin_officer CANNOT edit their own records (conflict of interest)
      (
        (get_user_role(auth.uid()) != 'admin_officer')
        OR
        (scanned_by != auth.uid())
      )
    )
  );

-- Officers can update their own unreviewed scans
CREATE POLICY officers_update_own_scans
  ON plate_scans FOR UPDATE
  TO authenticated
  USING (
    (
      (scanned_by = auth.uid())
      AND
      (reviewed = false)
      AND
      (get_user_role(auth.uid()) NOT IN ('admin', 'admin_officer', 'master'))
    )
  );

-- ============================================================
-- 7. INVESTIGATION_JOBS
-- ============================================================

-- Drop existing policies
DROP POLICY IF EXISTS users_view_org_jobs ON investigation_jobs;
DROP POLICY IF EXISTS admins_create_jobs ON investigation_jobs;
DROP POLICY IF EXISTS admins_update_jobs ON investigation_jobs;

-- SELECT: admin_officer sees ALL org data
CREATE POLICY users_view_org_jobs
  ON investigation_jobs FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master')
    OR
    (organization_id = ANY(get_user_organization_ids()))
  );

-- INSERT: admin_officer can create
CREATE POLICY admins_create_jobs
  ON investigation_jobs FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text]))
      AND
      (
        (get_user_role(auth.uid()) = 'master')
        OR
        (organization_id = get_user_organization_id(auth.uid()))
      )
    )
  );

-- UPDATE: admin_officer can edit, but NOT jobs they created
CREATE POLICY admins_update_jobs
  ON investigation_jobs FOR UPDATE
  TO authenticated
  USING (
    (
      (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text]))
      AND
      (
        (get_user_role(auth.uid()) = 'master')
        OR
        (organization_id = get_user_organization_id(auth.uid()))
      )
      AND
      -- admin_officer CANNOT edit jobs they created (conflict of interest)
      (
        (get_user_role(auth.uid()) != 'admin_officer')
        OR
        (created_by != auth.uid())
      )
    )
  );

-- ============================================================
-- 8. VEHICLE_RECORDS (Legacy)
-- ============================================================

-- Drop existing policies
DROP POLICY IF EXISTS users_view_vehicle_records ON vehicle_records;
DROP POLICY IF EXISTS admin_update_vehicle_records ON vehicle_records;

-- SELECT: admin_officer sees ALL org data
CREATE POLICY users_view_vehicle_records
  ON vehicle_records FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master')
    OR
    (organization_id = get_user_organization_id(auth.uid()))
  );

-- UPDATE: admin_officer can edit, but NOT their own records
CREATE POLICY admin_update_vehicle_records
  ON vehicle_records FOR UPDATE
  TO authenticated
  USING (
    (
      (get_user_role(auth.uid()) = 'master')
      OR
      (
        (organization_id IN (
          SELECT user_profiles.organization_id
          FROM user_profiles
          WHERE user_profiles.id = auth.uid()
        ))
        AND
        (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text]))
      )
    )
    AND
    -- admin_officer CANNOT edit their own records (conflict of interest)
    (
      (get_user_role(auth.uid()) != 'admin_officer')
      OR
      (recorded_by != auth.uid())
    )
  )
  WITH CHECK (
    (
      (get_user_role(auth.uid()) = 'master')
      OR
      (
        (organization_id IN (
          SELECT user_profiles.organization_id
          FROM user_profiles
          WHERE user_profiles.id = auth.uid()
        ))
        AND
        (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text]))
      )
    )
    AND
    -- admin_officer CANNOT edit their own records (conflict of interest)
    (
      (get_user_role(auth.uid()) != 'admin_officer')
      OR
      (recorded_by != auth.uid())
    )
  );

-- ============================================================
-- 9. PATROLS
-- ============================================================

-- Drop existing policies
DROP POLICY IF EXISTS users_view_patrols ON patrols;
DROP POLICY IF EXISTS admins_manage_patrols ON patrols;

-- SELECT: admin_officer sees ALL org data
CREATE POLICY users_view_patrols
  ON patrols FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master')
    OR
    (organization_id = ANY(get_user_organization_ids()))
  );

-- UPDATE: admin_officer can manage all patrols (no conflict since they don't directly create field patrols)
CREATE POLICY admins_manage_patrols
  ON patrols FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role = ANY(ARRAY['admin'::text, 'admin_officer'::text, 'master'::text])
    )
  );

-- ============================================================
-- 10. FLAGGED_VEHICLES
-- ============================================================

-- Drop existing policies
DROP POLICY IF EXISTS org_users_select_flagged_vehicles ON flagged_vehicles;
DROP POLICY IF EXISTS admin_manage_flagged_vehicles ON flagged_vehicles;

-- SELECT: admin_officer sees ALL org data
CREATE POLICY org_users_select_flagged_vehicles
  ON flagged_vehicles FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master')
    OR
    (organization_id = ANY(get_user_organization_ids()))
  );

-- UPDATE: admin_officer can manage all flagged vehicles (no direct conflict)
CREATE POLICY admin_manage_flagged_vehicles
  ON flagged_vehicles FOR ALL
  TO authenticated
  USING (
    (
      (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text]))
      AND
      (
        (get_user_role(auth.uid()) = 'master')
        OR
        (organization_id IN (
          SELECT user_profiles.organization_id
          FROM user_profiles
          WHERE user_profiles.id = auth.uid()
        ))
      )
    )
  );

-- ============================================================
-- GRANT PERMISSIONS
-- ============================================================

GRANT EXECUTE ON FUNCTION user_created_record TO authenticated;

-- ============================================================
-- DONE
-- ============================================================

COMMENT ON MIGRATION IS 'Fixed admin_officer permissions: Full view of org data in Admin Portal, can edit all records except their own (conflict of interest prevention)';
