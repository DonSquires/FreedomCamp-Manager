-- ===========================================
-- PATROL CHECKPOINTS SYSTEM
-- Supports QR / NFC checkpoint scanning for
-- Lone Worker Protocol (Health & Safety at Work Act 2015)
-- ===========================================

-- Checkpoint definitions (admin-managed)
CREATE TABLE IF NOT EXISTS patrol_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  location_lat DOUBLE PRECISION,
  location_lng DOUBLE PRECISION,
  qr_code TEXT NOT NULL UNIQUE,  -- Encoded payload / URL
  nfc_tag_id TEXT,               -- NFC tag UID (optional)
  is_active BOOLEAN NOT NULL DEFAULT true,
  required_on_patrol BOOLEAN NOT NULL DEFAULT false,
  check_in_radius_metres INT NOT NULL DEFAULT 50,
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patrol_checkpoints_org ON patrol_checkpoints(organization_id);
CREATE INDEX IF NOT EXISTS idx_patrol_checkpoints_zone ON patrol_checkpoints(zone_id);
CREATE INDEX IF NOT EXISTS idx_patrol_checkpoints_qr ON patrol_checkpoints(qr_code);

-- Check-in records (immutable append-only for chain-of-custody)
CREATE TABLE IF NOT EXISTS checkpoint_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_id UUID NOT NULL REFERENCES patrol_checkpoints(id) ON DELETE CASCADE,
  officer_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  patrol_id UUID REFERENCES patrols(id) ON DELETE SET NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scan_method TEXT NOT NULL CHECK (scan_method IN ('qr_camera', 'nfc', 'manual_code', 'url_deep_link')),
  gps_latitude DOUBLE PRECISION,
  gps_longitude DOUBLE PRECISION,
  gps_accuracy DOUBLE PRECISION,
  gps_distance_from_checkpoint DOUBLE PRECISION,
  -- within_radius is set by the application layer on insert (avoids per-row subquery overhead)
  within_radius BOOLEAN,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_visits_checkpoint ON checkpoint_visits(checkpoint_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkpoint_visits_officer ON checkpoint_visits(officer_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkpoint_visits_patrol ON checkpoint_visits(patrol_id);
CREATE INDEX IF NOT EXISTS idx_checkpoint_visits_org ON checkpoint_visits(organization_id, visited_at DESC);

COMMENT ON TABLE patrol_checkpoints IS 'QR/NFC checkpoint definitions for patrol route verification (Lone Worker Protocol — Health & Safety at Work Act 2015)';
COMMENT ON TABLE checkpoint_visits IS 'Immutable checkpoint visit records — evidence of officer presence at physical patrol points';

-- ===========================================
-- ROW LEVEL SECURITY
-- ===========================================

ALTER TABLE patrol_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkpoint_visits ENABLE ROW LEVEL SECURITY;

-- patrol_checkpoints: anyone in the org can read; admins can manage
CREATE POLICY "org_members_read_checkpoints"
  ON patrol_checkpoints FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "admins_manage_checkpoints"
  ON patrol_checkpoints FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master')
    )
  );

-- checkpoint_visits: officers can insert own; admins can read org
CREATE POLICY "officers_insert_own_visit"
  ON checkpoint_visits FOR INSERT
  TO authenticated
  WITH CHECK (officer_id = auth.uid());

CREATE POLICY "admins_read_org_visits"
  ON checkpoint_visits FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- ===========================================
-- UPDATED-AT TRIGGER
-- ===========================================

DROP TRIGGER IF EXISTS update_patrol_checkpoints_updated_at ON patrol_checkpoints;
CREATE TRIGGER update_patrol_checkpoints_updated_at
  BEFORE UPDATE ON patrol_checkpoints
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
