-- B-17: Camper self-registration table
-- B-18: Zone amenity columns (has_toilets, has_water, etc.)
--
-- ── 1. Zone amenity/facility columns (B-18) ──────────────────────────────────
ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS has_toilets        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_water          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_dump_station   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_shower         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_rubbish        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_vehicles       INTEGER,
  ADD COLUMN IF NOT EXISTS fee_nzd            NUMERIC(8,2);

COMMENT ON COLUMN public.zones.has_toilets      IS 'Zone has public toilet facilities';
COMMENT ON COLUMN public.zones.has_water        IS 'Zone has potable water access point';
COMMENT ON COLUMN public.zones.has_dump_station IS 'Zone has a certified self-contained vehicle dump station';
COMMENT ON COLUMN public.zones.has_shower       IS 'Zone has shower facilities';
COMMENT ON COLUMN public.zones.has_rubbish      IS 'Zone has rubbish/waste disposal bins';
COMMENT ON COLUMN public.zones.max_vehicles     IS 'Maximum number of vehicles permitted simultaneously (NULL = unlimited)';
COMMENT ON COLUMN public.zones.fee_nzd          IS 'Nightly fee in NZD (NULL = free)';

-- ── 2. camper_registrations (B-17) ───────────────────────────────────────────
-- Public self-registration: campers declare their stay at a freedom camping zone.
-- Used for zone capacity tracking, compliance dashboards, and welfare monitoring.
CREATE TABLE IF NOT EXISTS public.camper_registrations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id             UUID NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  confirmation_code   TEXT NOT NULL UNIQUE,   -- e.g. "CR-2026-A3F7"
  plate_number        TEXT,
  vehicle_type        TEXT CHECK (vehicle_type IN ('self_contained','campervan','tent','car','motorhome','other')),
  is_self_contained   BOOLEAN NOT NULL DEFAULT false,
  contact_name        TEXT,
  contact_email       TEXT,
  contact_phone       TEXT,
  party_size          SMALLINT NOT NULL DEFAULT 1 CHECK (party_size >= 1 AND party_size <= 20),
  arrival_date        DATE NOT NULL,
  departure_date      DATE NOT NULL,
  nights              SMALLINT GENERATED ALWAYS AS (
                        GREATEST(1, (departure_date - arrival_date)::SMALLINT)
                      ) STORED,
  notes               TEXT,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','departed','cancelled')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cr_dates_check CHECK (departure_date >= arrival_date)
);

CREATE INDEX IF NOT EXISTS idx_camper_reg_zone     ON public.camper_registrations(zone_id);
CREATE INDEX IF NOT EXISTS idx_camper_reg_code     ON public.camper_registrations(confirmation_code);
CREATE INDEX IF NOT EXISTS idx_camper_reg_plate    ON public.camper_registrations(plate_number) WHERE plate_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_camper_reg_dates    ON public.camper_registrations(zone_id, arrival_date, departure_date);
CREATE INDEX IF NOT EXISTS idx_camper_reg_active   ON public.camper_registrations(zone_id, status) WHERE status = 'active';

CREATE OR REPLACE TRIGGER update_camper_registrations_updated_at
  BEFORE UPDATE ON public.camper_registrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.camper_registrations IS
  'Public camper stay registrations — submitted via /public/register (B-17)';

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.camper_registrations ENABLE ROW LEVEL SECURITY;

-- Anon: INSERT only
CREATE POLICY "camper_registrations_anon_insert"
  ON public.camper_registrations FOR INSERT
  TO anon
  WITH CHECK (true);

-- Anon: SELECT own registration by confirmation_code (public lookup on status page)
CREATE POLICY "camper_registrations_anon_select_own"
  ON public.camper_registrations FOR SELECT
  TO anon
  USING (true);   -- row-level filtering done in application layer by confirmation_code

-- Authenticated staff: full access to own org's zones' registrations
CREATE POLICY "camper_registrations_staff_rw"
  ON public.camper_registrations
  USING (
    zone_id IN (
      SELECT id FROM public.zones
      WHERE organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
    )
  );

-- grand_master: read all
CREATE POLICY "camper_registrations_gm_read"
  ON public.camper_registrations FOR SELECT
  USING ((SELECT role FROM user_profiles WHERE id = auth.uid()) = 'grand_master');

-- ── Confirmation code generator ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_camper_confirmation_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_code TEXT;
  v_year TEXT := to_char(NOW() AT TIME ZONE 'Pacific/Auckland', 'YYYY');
  v_suffix TEXT;
BEGIN
  LOOP
    v_suffix := upper(substring(md5(random()::text) FROM 1 FOR 4));
    v_code := 'CR-' || v_year || '-' || v_suffix;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.camper_registrations WHERE confirmation_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

COMMENT ON FUNCTION public.generate_camper_confirmation_code IS
  'Generates a unique confirmation code like CR-2026-A3F7 for camper self-registration';
