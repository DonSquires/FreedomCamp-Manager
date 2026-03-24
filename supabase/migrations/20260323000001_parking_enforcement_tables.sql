-- ============================================================
-- Parking Enforcement Module
-- NZ council-style ANPR/LPR parking enforcement, integrated
-- with ParkPow for watchlists, sessions, and violations.
-- ============================================================

-- ── parking_zones ────────────────────────────────────────────
-- Extends the existing zones concept with parking-specific
-- config (time limits, permit types, ParkPow lot linkage).
-- NOTE: zones.parkpow_lot_id already exists; this table adds
--       parking-specific configuration layered on top.
CREATE TABLE IF NOT EXISTS parking_zones (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id               UUID REFERENCES zones(id) ON DELETE SET NULL,
  name                  TEXT NOT NULL,
  address               TEXT,
  zone_type             TEXT NOT NULL DEFAULT 'time_limited'
                          CHECK (zone_type IN ('time_limited','permit_only','pay_and_display','no_parking','disabled_only','loading_zone','mixed')),
  max_stay_minutes      INTEGER,           -- NULL = no time limit
  enforcement_hours     JSONB,             -- e.g. {"days":["Mon-Fri"],"from":"08:00","to":"18:00"}
  permit_types_accepted TEXT[],            -- e.g. ['zone_a_permit','resident_permit']
  grace_period_minutes  INTEGER DEFAULT 5,
  fine_amount_nzd       NUMERIC(8,2),
  parkpow_lot_id        INTEGER,           -- mirrors zones.parkpow_lot_id for parking context
  camera_ids            TEXT[],            -- camera identifiers for this zone
  geometry              JSONB,             -- GeoJSON for map display
  is_active             BOOLEAN NOT NULL DEFAULT true,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── parking_sessions ─────────────────────────────────────────
-- Every vehicle detection / entry event.  Mirrors ParkPow
-- sessions and serves as the source of truth for dwell-time.
CREATE TABLE IF NOT EXISTS parking_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parking_zone_id       UUID REFERENCES parking_zones(id) ON DELETE SET NULL,
  plate_number          TEXT NOT NULL,
  entry_time            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exit_time             TIMESTAMPTZ,
  dwell_minutes         INTEGER GENERATED ALWAYS AS (
                          CASE WHEN exit_time IS NOT NULL
                          THEN EXTRACT(EPOCH FROM (exit_time - entry_time))::INTEGER / 60
                          END
                        ) STORED,
  entry_photo_url       TEXT,              -- ALPR camera capture
  exit_photo_url        TEXT,
  -- TicketOr2-style electronic chalking / multi-pass tracking
  pass_number           INTEGER NOT NULL DEFAULT 1,   -- 1 = first chalk pass, 2+ = re-check pass
  first_pass_id         UUID REFERENCES parking_sessions(id) ON DELETE SET NULL, -- links re-check back to original chalk
  entry_tyre_valve_pos  TEXT,              -- e.g. 'north','south','east','west' — valve position at first pass
  exit_tyre_valve_pos   TEXT,             -- valve position at re-check (different = moved)
  tyre_valve_photo_url  TEXT,             -- close-up of tyre valve (TicketOr2 requirement)
  camera_id             TEXT,
  gps_lat               DOUBLE PRECISION,
  gps_lng               DOUBLE PRECISION,
  parkpow_session_id    INTEGER,           -- ParkPow session ID
  is_violation          BOOLEAN NOT NULL DEFAULT false,
  violation_reason      TEXT,
  officer_id            UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── parking_permits ──────────────────────────────────────────
-- Per-vehicle permits / exemptions for specific parking zones.
CREATE TABLE IF NOT EXISTS parking_permits (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parking_zone_id       UUID REFERENCES parking_zones(id) ON DELETE SET NULL,
  plate_number          TEXT NOT NULL,
  permit_type           TEXT NOT NULL DEFAULT 'resident'
                          CHECK (permit_type IN ('resident','business','disabled','visitor','contractor','staff','other')),
  holder_name           TEXT,
  holder_address        TEXT,
  holder_phone          TEXT,
  holder_email          TEXT,
  valid_from            DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to              DATE,             -- NULL = permanent
  is_active             BOOLEAN NOT NULL DEFAULT true,
  parkpow_vehicle_id    INTEGER,          -- ParkPow allow-list record
  issued_by             UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── parking_infringement_counters ────────────────────────────
-- Atomic sequential infringement number generation per org.
CREATE TABLE IF NOT EXISTS parking_infringement_counters (
  organization_id       UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  last_number           INTEGER NOT NULL DEFAULT 0
);

-- ── parking_infringements ────────────────────────────────────
-- Formal parking infringement notices (equivalent to NZ
-- council infringement under Land Transport Act 1998 s.128).
CREATE TABLE IF NOT EXISTS parking_infringements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  infringement_number   TEXT NOT NULL,    -- e.g. "PKG-2026-000042"
  parking_session_id    UUID REFERENCES parking_sessions(id) ON DELETE SET NULL,
  parking_zone_id       UUID REFERENCES parking_zones(id) ON DELETE SET NULL,
  plate_number          TEXT NOT NULL,
  vehicle_make          TEXT,
  vehicle_model         TEXT,
  vehicle_colour        TEXT,
  offence_code          TEXT,             -- e.g. "LTA_S166_1A"
  offence_description   TEXT NOT NULL,
  offence_time          TIMESTAMPTZ NOT NULL,
  location_address      TEXT NOT NULL,
  location_lat          DOUBLE PRECISION,
  location_lng          DOUBLE PRECISION,
  fine_amount_nzd       NUMERIC(8,2),
  early_payment_amount  NUMERIC(8,2),     -- discounted amount if paid within 14 days
  early_payment_days    INTEGER DEFAULT 14,
  due_date              DATE,
  status                TEXT NOT NULL DEFAULT 'issued'
                          CHECK (status IN ('issued','reminder_sent','paid','disputed','withdrawn','court_referred','written_off')),
  payment_received_at   TIMESTAMPTZ,
  payment_method        TEXT,
  payment_reference     TEXT,
  evidence_photos       TEXT[],           -- URLs of supporting photos
  officer_id            UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  officer_name          TEXT,
  parkpow_violation_id  INTEGER,          -- ParkPow violation record
  dispute_notes         TEXT,
  court_reference       TEXT,
  cancelled_reason      TEXT,
  pdf_url               TEXT,             -- generated infringement PDF
  issued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, infringement_number)
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_parking_zones_org        ON parking_zones(organization_id);
CREATE INDEX IF NOT EXISTS idx_parking_sessions_org     ON parking_sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_parking_sessions_plate   ON parking_sessions(plate_number);
CREATE INDEX IF NOT EXISTS idx_parking_sessions_zone    ON parking_sessions(parking_zone_id);
CREATE INDEX IF NOT EXISTS idx_parking_sessions_active  ON parking_sessions(organization_id, parking_zone_id) WHERE exit_time IS NULL;
CREATE INDEX IF NOT EXISTS idx_parking_permits_org      ON parking_permits(organization_id);
CREATE INDEX IF NOT EXISTS idx_parking_permits_plate    ON parking_permits(plate_number);
CREATE INDEX IF NOT EXISTS idx_parking_infringements_org   ON parking_infringements(organization_id);
CREATE INDEX IF NOT EXISTS idx_parking_infringements_plate ON parking_infringements(plate_number);
CREATE INDEX IF NOT EXISTS idx_parking_infringements_status ON parking_infringements(organization_id, status);

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE parking_zones             ENABLE ROW LEVEL SECURITY;
ALTER TABLE parking_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE parking_permits           ENABLE ROW LEVEL SECURITY;
ALTER TABLE parking_infringement_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE parking_infringements     ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read/write their own org data
CREATE POLICY "parking_zones_org_rw"           ON parking_zones
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "parking_sessions_org_rw"        ON parking_sessions
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "parking_permits_org_rw"         ON parking_permits
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "parking_infringement_counters_org_rw" ON parking_infringement_counters
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "parking_infringements_org_rw"   ON parking_infringements
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- grand_master can read all
CREATE POLICY "parking_zones_gm_read"          ON parking_zones           FOR SELECT
  USING ((SELECT role FROM user_profiles WHERE id = auth.uid()) = 'grand_master');
CREATE POLICY "parking_sessions_gm_read"       ON parking_sessions        FOR SELECT
  USING ((SELECT role FROM user_profiles WHERE id = auth.uid()) = 'grand_master');
CREATE POLICY "parking_permits_gm_read"        ON parking_permits         FOR SELECT
  USING ((SELECT role FROM user_profiles WHERE id = auth.uid()) = 'grand_master');
CREATE POLICY "parking_infringements_gm_read"  ON parking_infringements   FOR SELECT
  USING ((SELECT role FROM user_profiles WHERE id = auth.uid()) = 'grand_master');

-- ── next_parking_infringement_number() ────────────────────────
-- Atomically increments the counter and returns a formatted
-- infringement number like "PKG-2026-000042".
CREATE OR REPLACE FUNCTION next_parking_infringement_number(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next  INTEGER;
  v_year  TEXT := to_char(NOW() AT TIME ZONE 'Pacific/Auckland', 'YYYY');
BEGIN
  INSERT INTO parking_infringement_counters (organization_id, last_number)
  VALUES (p_org_id, 1)
  ON CONFLICT (organization_id) DO UPDATE
    SET last_number = parking_infringement_counters.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN 'PKG-' || v_year || '-' || lpad(v_next::TEXT, 6, '0');
END;
$$;

-- ── updated_at triggers ───────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_parking_zones_updated_at') THEN
    CREATE TRIGGER trg_parking_zones_updated_at
      BEFORE UPDATE ON parking_zones
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_parking_sessions_updated_at') THEN
    CREATE TRIGGER trg_parking_sessions_updated_at
      BEFORE UPDATE ON parking_sessions
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_parking_infringements_updated_at') THEN
    CREATE TRIGGER trg_parking_infringements_updated_at
      BEFORE UPDATE ON parking_infringements
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END;
$$;
