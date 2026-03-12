-- ============================================================================
-- OBSERVATIONS SYSTEM REBUILD - Clean Architecture
-- ============================================================================
-- Purpose: Replace complex observations_v2 with simplified evidence-focused table
-- Affected: observations, ObservationsReport frontend
-- ============================================================================

-- Drop old observation table and dependencies
DROP TABLE IF EXISTS observations CASCADE;
DROP TABLE IF EXISTS compliance_results CASCADE;
DROP TABLE IF EXISTS scan_idempotency_keys CASCADE;

-- ============================================================================
-- NEW: observations (simplified, evidence-focused)
-- ============================================================================
CREATE TABLE observations (
  -- Identity
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text UNIQUE NOT NULL, -- Offline sync deduplication
  
  -- Core Evidence
  plate_number text NOT NULL,
  photo_url text NOT NULL, -- Direct evidence bucket URL
  photo_hash text NOT NULL, -- SHA-256 integrity check
  recorded_at timestamptz NOT NULL,
  
  -- Location Evidence
  zone_id uuid NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  gps_latitude numeric(10,8) NOT NULL,
  gps_longitude numeric(11,8) NOT NULL,
  gps_accuracy numeric(10,2), -- meters
  
  -- Context
  recorded_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  officer_notes text,
  weather_conditions text,
  
  -- Vehicle Snapshot (at time of observation)
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  vehicle_color text,
  self_contained boolean DEFAULT false,
  self_contained_expiry date,
  
  -- Compliance State (at time of observation)
  is_compliant boolean DEFAULT true,
  breach_type text,
  breach_reason text,
  nights_stayed_this_month integer DEFAULT 0,
  consecutive_nights integer DEFAULT 0,
  
  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX idx_obs_plate ON observations(plate_number);
CREATE INDEX idx_obs_zone ON observations(zone_id);
CREATE INDEX idx_obs_org ON observations(organization_id);
CREATE INDEX idx_obs_recorded_at ON observations(recorded_at);
CREATE INDEX idx_obs_recorded_by ON observations(recorded_by);
CREATE INDEX idx_obs_compliance ON observations(is_compliant);
CREATE INDEX idx_obs_idempotency ON observations(idempotency_key);

-- ============================================================================
-- RLS Policies
-- ============================================================================
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;

-- Officers create observations
CREATE POLICY officers_insert_observations ON observations
  FOR INSERT
  WITH CHECK (
    recorded_by = auth.uid()
    AND organization_id = get_user_organization_id(auth.uid())
  );

-- Users view org observations
CREATE POLICY users_view_observations ON observations
  FOR SELECT
  USING (
    (get_user_role(auth.uid()) = 'master'::text)
    OR (organization_id = ANY (get_user_organization_ids()))
  );

-- Admins update observations
CREATE POLICY admins_update_observations ON observations
  FOR UPDATE
  USING (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'master'::text]))
    AND (
      (get_user_role(auth.uid()) = 'master'::text)
      OR (organization_id = get_user_organization_id(auth.uid()))
    )
  );

-- Super delete (emergency cleanup)
CREATE POLICY super_delete_observations ON observations
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND email = 'don.squire@firstsecurity.co.nz'
        AND permissions @> '["super_delete"]'::jsonb
    )
  );

-- ============================================================================
-- Triggers
-- ============================================================================

-- Auto-update updated_at
CREATE TRIGGER update_observations_updated_at
  BEFORE UPDATE ON observations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Get observation summary for reports
CREATE OR REPLACE FUNCTION get_observation_summary(
  p_start_date date,
  p_end_date date,
  p_organization_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
)
RETURNS TABLE (
  total_observations bigint,
  compliant_count bigint,
  breach_count bigint,
  unique_vehicles bigint,
  unique_zones bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::bigint as total_observations,
    COUNT(*) FILTER (WHERE is_compliant = true)::bigint as compliant_count,
    COUNT(*) FILTER (WHERE is_compliant = false)::bigint as breach_count,
    COUNT(DISTINCT plate_number)::bigint as unique_vehicles,
    COUNT(DISTINCT zone_id)::bigint as unique_zones
  FROM observations
  WHERE recorded_at >= p_start_date
    AND recorded_at <= p_end_date
    AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    AND (p_zone_id IS NULL OR zone_id = p_zone_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Data Migration (from canonical_vehicles if needed)
-- ============================================================================
-- NOTE: Run this manually after reviewing existing data:
-- 
-- INSERT INTO observations (
--   plate_number, photo_url, photo_hash, recorded_at,
--   zone_id, organization_id, gps_latitude, gps_longitude,
--   recorded_by, vehicle_make, vehicle_model, vehicle_year, vehicle_color,
--   self_contained, self_contained_expiry, idempotency_key
-- )
-- SELECT ...
-- FROM legacy_source
-- WHERE ...;

COMMENT ON TABLE observations IS 'Simplified vehicle observations - evidence-focused design for field officers';
COMMENT ON COLUMN observations.photo_url IS 'Direct URL to evidence photo in storage bucket';
COMMENT ON COLUMN observations.photo_hash IS 'SHA-256 hash for photo integrity verification';
COMMENT ON COLUMN observations.idempotency_key IS 'Format: {deviceId}:{localCaptureId} for offline deduplication';
COMMENT ON COLUMN observations.is_compliant IS 'Compliance status at time of observation (snapshot)';
COMMENT ON COLUMN observations.breach_reason IS 'Human-readable explanation if not compliant';
