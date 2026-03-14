-- ===========================================
-- GEOFENCE ZONE CHECKPOINTS & SITE VISIT TRACKING
-- Auto-generates patrol checkpoints from geofenced zones.
-- Tracks officer shifts (parent zone entry/exit) and
-- site visits (child zone entry/exit).
-- ===========================================

-- ─── 1. Add checkpoint_type to patrol_checkpoints ───────────────────────
ALTER TABLE patrol_checkpoints
  ADD COLUMN IF NOT EXISTS checkpoint_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (checkpoint_type IN ('manual', 'geofence_zone'));

COMMENT ON COLUMN patrol_checkpoints.checkpoint_type
  IS 'manual = admin-created QR/NFC checkpoint; geofence_zone = auto-generated from a zone with geofence data';

-- ─── 2. Officer shifts table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS officer_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_zone_id UUID REFERENCES zones(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT CHECK (end_reason IN ('logout', 'app_timeout', 'manual', 'zone_exit')),
  gps_start_lat DOUBLE PRECISION,
  gps_start_lng DOUBLE PRECISION,
  gps_end_lat DOUBLE PRECISION,
  gps_end_lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_officer_shifts_officer ON officer_shifts(officer_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_officer_shifts_org ON officer_shifts(organization_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_officer_shifts_active ON officer_shifts(officer_id) WHERE ended_at IS NULL;

COMMENT ON TABLE officer_shifts
  IS 'Tracks officer shift lifecycle. Shift starts on parent zone entry (login), ends on logout / 15-min app timeout.';

-- ─── 3. Patrol site visits table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patrol_site_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES officer_shifts(id) ON DELETE SET NULL,
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  exited_at TIMESTAMPTZ,
  gps_entry_lat DOUBLE PRECISION,
  gps_entry_lng DOUBLE PRECISION,
  gps_exit_lat DOUBLE PRECISION,
  gps_exit_lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patrol_site_visits_officer ON patrol_site_visits(officer_id, entered_at DESC);
CREATE INDEX IF NOT EXISTS idx_patrol_site_visits_org ON patrol_site_visits(organization_id, entered_at DESC);
CREATE INDEX IF NOT EXISTS idx_patrol_site_visits_shift ON patrol_site_visits(shift_id);
CREATE INDEX IF NOT EXISTS idx_patrol_site_visits_zone ON patrol_site_visits(zone_id);
CREATE INDEX IF NOT EXISTS idx_patrol_site_visits_active ON patrol_site_visits(officer_id) WHERE exited_at IS NULL;

COMMENT ON TABLE patrol_site_visits
  IS 'Tracks zone-level site visits. Starts on child zone geofence entry, ends on geofence exit.';

-- ─── 4. RLS ─────────────────────────────────────────────────────────────

ALTER TABLE officer_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrol_site_visits ENABLE ROW LEVEL SECURITY;

-- officer_shifts: officers see own; admins see org
CREATE POLICY "officers_read_own_shifts"
  ON officer_shifts FOR SELECT
  TO authenticated
  USING (officer_id = auth.uid());

CREATE POLICY "officers_insert_own_shift"
  ON officer_shifts FOR INSERT
  TO authenticated
  WITH CHECK (officer_id = auth.uid());

CREATE POLICY "officers_update_own_shift"
  ON officer_shifts FOR UPDATE
  TO authenticated
  USING (officer_id = auth.uid());

CREATE POLICY "admins_read_org_shifts"
  ON officer_shifts FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master')
    )
  );

-- patrol_site_visits: officers see own; admins see org
CREATE POLICY "officers_read_own_site_visits"
  ON patrol_site_visits FOR SELECT
  TO authenticated
  USING (officer_id = auth.uid());

CREATE POLICY "officers_insert_own_site_visit"
  ON patrol_site_visits FOR INSERT
  TO authenticated
  WITH CHECK (officer_id = auth.uid());

CREATE POLICY "officers_update_own_site_visit"
  ON patrol_site_visits FOR UPDATE
  TO authenticated
  USING (officer_id = auth.uid());

CREATE POLICY "admins_read_org_site_visits"
  ON patrol_site_visits FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master')
    )
  );

-- ─── 5. Updated-at triggers ─────────────────────────────────────────────

DROP TRIGGER IF EXISTS update_officer_shifts_updated_at ON officer_shifts;
CREATE TRIGGER update_officer_shifts_updated_at
  BEFORE UPDATE ON officer_shifts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─── 6. Sync zones as checkpoints function ──────────────────────────────

CREATE OR REPLACE FUNCTION sync_geofence_zone_checkpoints(p_organization_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER := 0;
  v_zone RECORD;
BEGIN
  -- For each active zone with geofence data that does not yet have a
  -- geofence_zone checkpoint, create one automatically.
  FOR v_zone IN
    SELECT z.id, z.name, z.location_lat, z.location_lng
    FROM zones z
    WHERE z.organization_id = p_organization_id
      AND z.is_active = true
      AND z.location_lat IS NOT NULL
      AND z.location_lng IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM patrol_checkpoints pc
        WHERE pc.zone_id = z.id
          AND pc.checkpoint_type = 'geofence_zone'
          AND pc.organization_id = p_organization_id
      )
  LOOP
    INSERT INTO patrol_checkpoints (
      organization_id, zone_id, name, description,
      location_lat, location_lng, qr_code,
      is_active, required_on_patrol, check_in_radius_metres,
      checkpoint_type
    ) VALUES (
      p_organization_id,
      v_zone.id,
      v_zone.name || ' (Geofence)',
      'Auto-generated checkpoint from zone geofence',
      v_zone.location_lat,
      v_zone.location_lng,
      'geofence-zone-' || v_zone.id::text,
      true,
      true,
      100,
      'geofence_zone'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION sync_geofence_zone_checkpoints(UUID)
  IS 'Creates patrol_checkpoints entries for every geofenced zone that does not already have one. Returns number of checkpoints created.';
