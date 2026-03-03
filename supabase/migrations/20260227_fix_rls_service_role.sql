-- Fix RLS policies for vehicle-ingest Edge Function using SERVICE_ROLE
-- Date: 2026-02-27
-- Issue: Edge Function uses SERVICE_ROLE_KEY but policies expect auth.uid()

-- ============================================================================
-- 1. DROP CONFLICTING POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "authenticated_insert_observations" ON observations;
DROP POLICY IF EXISTS "officers_insert_any_org_observations" ON observations;
DROP POLICY IF EXISTS "officers_insert_observations" ON observations;

-- ============================================================================
-- 2. CREATE SINGLE PERMISSIVE INSERT POLICY FOR SERVICE ROLE
-- ============================================================================

-- Allow SERVICE_ROLE to insert observations (used by vehicle-ingest Edge Function)
-- This bypasses RLS entirely when using SERVICE_ROLE_KEY
CREATE POLICY "service_role_insert_observations"
  ON observations
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Allow authenticated users to insert their own observations
CREATE POLICY "authenticated_insert_own_observations"
  ON observations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- User must be the recorder
    recorded_by = auth.uid()
  );

-- ============================================================================
-- 3. FIX CANONICAL_VEHICLES POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "authenticated_view_canonical_vehicles" ON canonical_vehicles;
DROP POLICY IF EXISTS "system_manage_canonical_vehicles" ON canonical_vehicles;

-- Allow all authenticated users to view vehicles (for safety checks)
CREATE POLICY "users_view_canonical_vehicles"
  ON canonical_vehicles
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow SERVICE_ROLE to manage vehicles (used by Edge Functions)
CREATE POLICY "service_role_manage_canonical_vehicles"
  ON canonical_vehicles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 4. FIX PHOTO_METADATA POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "authenticated_upload_photos" ON photo_metadata;

-- Allow users to upload their own photos
CREATE POLICY "users_upload_own_photos"
  ON photo_metadata
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Allow SERVICE_ROLE to manage photo metadata (used by Edge Functions)
CREATE POLICY "service_role_manage_photos"
  ON photo_metadata
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 5. FIX VEHICLE_MONTHLY_STAYS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "system_manage_monthly_stays" ON vehicle_monthly_stays;

-- Allow SERVICE_ROLE to manage stays (used by triggers)
CREATE POLICY "service_role_manage_monthly_stays"
  ON vehicle_monthly_stays
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 6. FIX COMPLIANCE_RESULTS POLICIES
--    NOTE: compliance_results was dropped in 20260221_rebuild_observations_clean.sql.
--          These statements are wrapped to be no-ops when the table no longer exists.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'compliance_results'
  ) THEN
    DROP POLICY IF EXISTS "system_manage_compliance_results" ON compliance_results;
    EXECUTE $p$
      CREATE POLICY "service_role_manage_compliance_results"
        ON compliance_results
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true)
    $p$;
  END IF;
END $$;

-- ============================================================================
-- 7. FIX BREACH_ALERTS POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "system_manage_breach_alerts" ON breach_alerts;
DROP POLICY IF EXISTS "system_update_breach_alerts" ON breach_alerts;

-- Allow SERVICE_ROLE to manage breach alerts (used by triggers)
CREATE POLICY "service_role_manage_breach_alerts"
  ON breach_alerts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- VERIFICATION
-- ============================================================================

COMMENT ON POLICY "service_role_insert_observations" ON observations IS 
'Allow Edge Functions using SERVICE_ROLE_KEY to insert observations without RLS checks';

COMMENT ON POLICY "authenticated_insert_own_observations" ON observations IS 
'Allow authenticated users to insert observations where they are the recorder';

-- Test query (run as service_role):
-- INSERT INTO observations (
--   plate_number, photo_url, photo_hash, recorded_at,
--   zone_id, organization_id, gps_latitude, gps_longitude,
--   recorded_by, idempotency_key
-- ) VALUES (
--   'TEST123', 'https://test.jpg', 'test_hash', now(),
--   '<zone_id>', '<org_id>', -36.8485, 174.7633,
--   '<user_id>', 'test-key-123'
-- );
