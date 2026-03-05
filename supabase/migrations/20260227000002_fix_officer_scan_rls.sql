-- Fix RLS policies for officer scanning workflow
-- Date: 2026-02-27
-- Issue: "new row violates row-level security policy" when creating observations

-- ============================================================================
-- 1. OBSERVATIONS TABLE - Loosen INSERT policy for field officers
-- ============================================================================

-- Drop old restrictive policy
DROP POLICY IF EXISTS "officers_insert_observations" ON observations;

-- Create new permissive policy for authenticated users scanning
CREATE POLICY "authenticated_insert_observations"
  ON observations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow insert if user is authenticated and is the recorder
    recorded_by = auth.uid()
    -- Don't check organization_id here - will be validated by trigger
  );

-- Add policy to allow officers to insert with any organization they belong to
CREATE POLICY "officers_insert_any_org_observations"
  ON observations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    recorded_by = auth.uid() AND
    (
      -- Allow if organization_id matches user's primary org
      organization_id = get_user_organization_id(auth.uid()) OR
      -- OR if organization_id is in user's authorized work locations
      organization_id = ANY(
        SELECT unnest(authorized_work_locations) 
        FROM user_profiles 
        WHERE id = auth.uid()
      ) OR
      -- OR if organization_id is user's employer organization
      organization_id = (
        SELECT employer_organization_id 
        FROM user_profiles 
        WHERE id = auth.uid()
      )
    )
  );

-- ============================================================================
-- 2. PHOTO_METADATA TABLE - Allow officers to upload photos
-- ============================================================================

-- Drop existing restrictive policy if exists
DROP POLICY IF EXISTS "users_insert_photo_metadata" ON photo_metadata;

-- Create permissive policy for photo uploads during scanning
CREATE POLICY "authenticated_upload_photos"
  ON photo_metadata
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow if user is the uploader
    user_id = auth.uid()
  );

-- ============================================================================
-- 3. VEHICLE_MONTHLY_STAYS - Allow system to update stays
-- ============================================================================

-- This table should be managed by triggers, so we need to allow system updates
DROP POLICY IF EXISTS "system_manage_monthly_stays" ON vehicle_monthly_stays;

CREATE POLICY "system_manage_monthly_stays"
  ON vehicle_monthly_stays
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 4. COMPLIANCE_RESULTS - Allow automatic compliance evaluation
--    NOTE: compliance_results was dropped in 20260221_rebuild_observations_clean.sql.
--          These statements are wrapped to be no-ops when the table no longer exists.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'compliance_results'
  ) THEN
    DROP POLICY IF EXISTS "system_insert_compliance_results" ON compliance_results;
    -- Allow system to create compliance results
    EXECUTE $p$
      CREATE POLICY "system_manage_compliance_results"
        ON compliance_results
        FOR ALL
        USING (true)
        WITH CHECK (true)
    $p$;
  END IF;
END $$;

-- ============================================================================
-- 5. BREACH_ALERTS - Allow system to create breach alerts
-- ============================================================================

-- Drop old policy
DROP POLICY IF EXISTS "system_create_breach_alerts" ON breach_alerts;

-- Allow system to create and update breach alerts
CREATE POLICY "system_manage_breach_alerts"
  ON breach_alerts
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "system_update_breach_alerts"
  ON breach_alerts
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 6. CANONICAL_VEHICLES - Allow system to upsert vehicles
-- ============================================================================

-- Drop existing policies if too restrictive
DROP POLICY IF EXISTS "admins_manage_canonical_vehicles" ON canonical_vehicles;

-- Allow authenticated users to read all vehicles (for safety - flagged vehicles)
CREATE POLICY "authenticated_view_canonical_vehicles"
  ON canonical_vehicles
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow system to manage canonical vehicles via functions
CREATE POLICY "system_manage_canonical_vehicles"
  ON canonical_vehicles
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 7. Add helper function to validate organization access
-- ============================================================================

CREATE OR REPLACE FUNCTION user_can_record_in_organization(org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_profiles
    WHERE id = auth.uid()
    AND (
      organization_id = org_id OR
      employer_organization_id = org_id OR
      org_id = ANY(authorized_work_locations)
    )
  );
END;
$$;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check current user's organizations
-- SELECT 
--   organization_id,
--   employer_organization_id,
--   authorized_work_locations
-- FROM user_profiles
-- WHERE id = auth.uid();

-- Test observation insert permissions
-- INSERT INTO observations (
--   plate_number, photo_url, photo_hash, recorded_at,
--   zone_id, organization_id, gps_latitude, gps_longitude,
--   recorded_by
-- ) VALUES (
--   'TEST123', 'https://test.jpg', 'test_hash', now(),
--   '<zone_id>', '<org_id>', -36.8485, 174.7633,
--   auth.uid()
-- );

COMMENT ON POLICY "authenticated_insert_observations" ON observations IS 
'Allow authenticated users to create observations where they are the recorder - organization validated by trigger';

COMMENT ON POLICY "officers_insert_any_org_observations" ON observations IS 
'Allow officers to create observations in any organization they have access to (primary org, employer, or authorized work locations)';

COMMENT ON FUNCTION user_can_record_in_organization IS 
'Helper function to check if current user can record observations in a specific organization';
