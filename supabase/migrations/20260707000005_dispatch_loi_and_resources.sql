-- =============================================================================
-- Dispatch Architecture Foundation — LOI, ServiceAgreement, JobType,
-- DispatchResource, and Zone-to-Resource Coverage Rules
-- =============================================================================
--
-- Context: see docs/DISPATCH_SCHEDULING_ARCHITECTURE.md
--
-- Goals
--   1) Introduce LocationOfInterest (LOI) as the canonical address anchor.
--      Every job can reference an LOI independent of any ClientSite.
--   2) Introduce ServiceAgreement (Contract) to link payer/governance +
--      capabilities (client submission, auto-dispatch).
--   3) Introduce JobType as a structured registry for module/specialty types.
--   4) Introduce DispatchResource (PatrolRun) as the dispatchable callsign
--      container (replacing the direct officer assignment at dispatch time).
--   5) Introduce zone_dispatch_resource_rules to map polygon zones →
--      DispatchResource for automatic assignment.
--   6) Add loi_id + service_agreement_id + dispatch_resource_id to
--      dispatch_jobs (nullable — backwards-compatible).
--
-- All changes are additive. No existing tables, columns, or constraints are
-- altered destructively. Existing workflows continue to function unchanged.
-- =============================================================================


-- ── 0. LOI CIRCULAR POLYGON GENERATOR ────────────────────────────────────────
--
-- Generates a GeoJSON Polygon that approximates a circle of `p_radius_meters`
-- around a lat/lng centre. Uses pure trigonometry — PostGIS is not required.
--
-- The resulting polygon is compatible with the existing isPointInPolygon
-- ray-casting check in src/lib/geofence.ts (GeoJSON Polygon, [lng,lat] order).
--
-- Parameters:
--   p_lat           Centre latitude  (degrees)
--   p_lng           Centre longitude (degrees)
--   p_radius_meters Radius of the circle in metres  (default 100 m)
--   p_num_points    Number of vertices on the polygon (default 32)

CREATE OR REPLACE FUNCTION public.generate_loi_circular_polygon(
  p_lat           DOUBLE PRECISION,
  p_lng           DOUBLE PRECISION,
  p_radius_meters INTEGER          DEFAULT 100,
  p_num_points    INTEGER          DEFAULT 32
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  i               INTEGER;
  angle           DOUBLE PRECISION;
  pt_lat          DOUBLE PRECISION;
  pt_lng          DOUBLE PRECISION;
  -- Degrees of latitude per metre (constant for a sphere)
  lat_deg_m       DOUBLE PRECISION := 1.0 / (6371000.0 * PI() / 180.0);
  -- Degrees of longitude per metre at this latitude
  lng_deg_m       DOUBLE PRECISION;
  coords          JSONB := '[]'::JSONB;
BEGIN
  -- Avoid division by zero at the poles
  IF ABS(p_lat) >= 90 THEN
    RETURN NULL;
  END IF;

  lng_deg_m := 1.0 / (6371000.0 * COS(RADIANS(p_lat)) * PI() / 180.0);

  FOR i IN 0..(p_num_points - 1) LOOP
    angle  := (2.0 * PI() * i) / p_num_points;
    pt_lat := p_lat + (p_radius_meters * SIN(angle) * lat_deg_m);
    pt_lng := p_lng + (p_radius_meters * COS(angle) * lng_deg_m);
    -- GeoJSON coordinate order is [longitude, latitude]
    coords := coords || jsonb_build_array(
      jsonb_build_array(
        ROUND(pt_lng::NUMERIC, 7),
        ROUND(pt_lat::NUMERIC, 7)
      )
    );
  END LOOP;

  -- Close the ring: last coordinate must equal the first
  coords := coords || jsonb_build_array(coords->0);

  RETURN jsonb_build_object(
    'type',        'Polygon',
    'coordinates', jsonb_build_array(coords)
  );
END;
$$;

COMMENT ON FUNCTION public.generate_loi_circular_polygon(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER) IS
  'Generates a GeoJSON Polygon approximating a circle around a lat/lng point. '
  'Uses pure trigonometry (no PostGIS required). '
  'Output is compatible with the isPointInPolygon ray-casting check in geofence.ts.';

GRANT EXECUTE ON FUNCTION public.generate_loi_circular_polygon(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER)
  TO authenticated;


-- ── 1. LOCATIONS OF INTEREST ─────────────────────────────────────────────────
--
-- A canonical, reusable address record.
-- Created on first encounter; reused on subsequent jobs at the same location.
-- Client sites can optionally derive their address from an LOI record.
--
-- Auto-geofence behaviour:
--   When gps_lat and gps_lng are set (on INSERT or UPDATE) a circular GeoJSON
--   Polygon is automatically computed and stored in `geofence_geometry`.
--   The radius defaults to 100 m for a precise address geofence but can be
--   overridden via `geofence_radius_meters`.

CREATE TABLE IF NOT EXISTS public.locations_of_interest (
  id                    UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID            NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Human-readable address (always populated)
  display_address       TEXT            NOT NULL,

  -- Structured address fields (populated where possible)
  street_number         TEXT,
  street_name           TEXT,
  suburb                TEXT,
  city                  TEXT,
  postcode              TEXT,
  country_code          TEXT            NOT NULL DEFAULT 'NZ',

  -- Geocoded position (used for polygon zone lookup)
  gps_lat               DOUBLE PRECISION,
  gps_lng               DOUBLE PRECISION,

  -- Auto-generated geofence polygon (circular approximation around gps_lat/gps_lng)
  -- Populated automatically by trg_loi_auto_geofence whenever gps_lat or gps_lng change.
  -- Stored as a GeoJSON Polygon { type: "Polygon", coordinates: [[[lng,lat],...]] }
  -- compatible with the existing detectCurrentZones / isPointInPolygon pipeline.
  geofence_radius_meters INTEGER         NOT NULL DEFAULT 100,
  geofence_geometry      JSONB,          -- auto-populated; do not set manually

  -- Geocode provenance
  geocode_source        TEXT            CHECK (geocode_source IN ('manual', 'linz', 'google', 'mapbox', 'other')),
  is_verified           BOOLEAN         NOT NULL DEFAULT false,

  -- Optional free-text notes (hazards, access instructions, etc.)
  notes                 TEXT,

  is_active             BOOLEAN         NOT NULL DEFAULT true,
  created_by            UUID            REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Compatibility backfill for environments where locations_of_interest
-- was created earlier with a smaller column set.
ALTER TABLE IF EXISTS public.locations_of_interest
  ADD COLUMN IF NOT EXISTS display_address TEXT,
  ADD COLUMN IF NOT EXISTS street_number TEXT,
  ADD COLUMN IF NOT EXISTS street_name TEXT,
  ADD COLUMN IF NOT EXISTS suburb TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS postcode TEXT,
  ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT 'NZ',
  ADD COLUMN IF NOT EXISTS gps_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS gps_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geofence_radius_meters INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS geofence_geometry JSONB,
  ADD COLUMN IF NOT EXISTS geocode_source TEXT,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations_of_interest'
      AND column_name = 'address_full'
  ) THEN
    EXECUTE '
      UPDATE public.locations_of_interest
      SET display_address = COALESCE(display_address, address_full)
      WHERE display_address IS NULL
    ';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_loi_org
  ON public.locations_of_interest(organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_loi_gps
  ON public.locations_of_interest(gps_lat, gps_lng)
  WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loi_city_suburb
  ON public.locations_of_interest(organization_id, city, suburb)
  WHERE city IS NOT NULL;

COMMENT ON TABLE public.locations_of_interest IS
  'Canonical address records decoupled from client/billing relationships. '
  'Every dispatch_job should reference an LOI; ClientSite is optional enrichment. '
  'geofence_geometry is auto-populated as a GeoJSON Polygon whenever gps_lat/gps_lng are set. '
  'See docs/DISPATCH_SCHEDULING_ARCHITECTURE.md §3.2.';

COMMENT ON COLUMN public.locations_of_interest.display_address IS
  'Full human-readable address string, e.g. "12 Trafalgar St, Nelson 7010"';
COMMENT ON COLUMN public.locations_of_interest.geocode_source IS
  'Authority used to derive gps_lat/gps_lng: manual entry, LINZ, Google, etc.';
COMMENT ON COLUMN public.locations_of_interest.is_verified IS
  'True when geocode has been confirmed against an authoritative address register';
COMMENT ON COLUMN public.locations_of_interest.geofence_radius_meters IS
  'Radius in metres for the auto-generated circular geofence. Default 100 m. '
  'Change this value to regenerate geofence_geometry with the new radius.';
COMMENT ON COLUMN public.locations_of_interest.geofence_geometry IS
  'Auto-generated GeoJSON Polygon (circular approximation) populated by '
  'trg_loi_auto_geofence whenever gps_lat, gps_lng, or geofence_radius_meters change. '
  'Do not set manually — it will be overwritten on the next write.';

-- ── Auto-geofence trigger ──────────────────────────────────────────────────
-- Regenerates `geofence_geometry` whenever gps_lat, gps_lng, or
-- geofence_radius_meters changes. Runs BEFORE INSERT OR UPDATE so the
-- generated polygon is stored in the same write as the coordinate change.

CREATE OR REPLACE FUNCTION public.loi_auto_geofence()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Only regenerate when coordinates or radius are present/changed
  IF NEW.gps_lat IS NOT NULL AND NEW.gps_lng IS NOT NULL THEN
    -- Re-compute when any of the three driver columns change (or on insert)
    IF (TG_OP = 'INSERT')
      OR (NEW.gps_lat    IS DISTINCT FROM OLD.gps_lat)
      OR (NEW.gps_lng    IS DISTINCT FROM OLD.gps_lng)
      OR (NEW.geofence_radius_meters IS DISTINCT FROM OLD.geofence_radius_meters)
    THEN
      NEW.geofence_geometry := public.generate_loi_circular_polygon(
        NEW.gps_lat,
        NEW.gps_lng,
        COALESCE(NEW.geofence_radius_meters, 100)
      );
    END IF;
  ELSE
    -- Coordinates cleared — remove the geofence
    NEW.geofence_geometry := NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.loi_auto_geofence() IS
  'Trigger function: auto-generates a circular GeoJSON Polygon geofence around '
  'gps_lat/gps_lng whenever an LOI is inserted or its coordinates/radius change.';

DROP TRIGGER IF EXISTS trg_loi_auto_geofence ON public.locations_of_interest;
CREATE TRIGGER trg_loi_auto_geofence
  BEFORE INSERT OR UPDATE ON public.locations_of_interest
  FOR EACH ROW EXECUTE FUNCTION public.loi_auto_geofence();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_loi_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_loi_updated_at ON public.locations_of_interest;
CREATE TRIGGER trg_loi_updated_at
  BEFORE UPDATE ON public.locations_of_interest
  FOR EACH ROW EXECUTE FUNCTION public.update_loi_updated_at();

-- RLS
ALTER TABLE public.locations_of_interest ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_loi"
  ON public.locations_of_interest FOR SELECT TO authenticated
  USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "admins_manage_loi"
  ON public.locations_of_interest FOR ALL TO authenticated
  USING (
    organization_id = get_user_organization_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
  )
  WITH CHECK (
    organization_id = get_user_organization_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
  );

-- Officers can create LOIs (needed for field-initiated jobs)
CREATE POLICY "officers_insert_loi"
  ON public.locations_of_interest FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_organization_id(auth.uid()));


-- ── 2. SERVICE AGREEMENTS (CONTRACT) ─────────────────────────────────────────
--
-- Links a payer (client organisation) to governance + capability flags.
-- Controls whether clients can submit jobs via portal and whether
-- submitted jobs bypass approval (auto-dispatch).

CREATE TABLE IF NOT EXISTS public.service_agreements (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Payer / client context (nullable = internal operational agreement)
  client_org_id             UUID        REFERENCES public.organizations(id) ON DELETE SET NULL,

  name                      TEXT        NOT NULL,
  reference_number          TEXT,       -- contract or PO number

  agreement_type            TEXT        NOT NULL DEFAULT 'other'
    CHECK (agreement_type IN (
      'alarm',
      'patrol',
      'noise_control',
      'freedom_camping',
      'parking',
      'investigation',
      'guarding',
      'biosecurity',
      'ems',
      'other'
    )),

  -- Capability flags
  allows_client_submission  BOOLEAN     NOT NULL DEFAULT false,
  -- ^ Whether client staff can submit jobs via the client portal
  allows_auto_dispatch      BOOLEAN     NOT NULL DEFAULT false,
  -- ^ When true, submitted jobs bypass approval and are dispatched immediately
  --   (monitoring centres, after-hours call centres)

  -- SLA defaults (overridable per job)
  default_sla_minutes       INTEGER     NOT NULL DEFAULT 60,
  default_priority          TEXT        NOT NULL DEFAULT 'normal'
    CHECK (default_priority IN ('low', 'normal', 'high', 'urgent')),

  -- Contract validity window
  active_from               DATE,
  active_to                 DATE,       -- null = open-ended

  notes                     TEXT,
  is_active                 BOOLEAN     NOT NULL DEFAULT true,
  created_by                UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_agreements_org
  ON public.service_agreements(organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_service_agreements_client_org
  ON public.service_agreements(client_org_id)
  WHERE client_org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_service_agreements_type
  ON public.service_agreements(organization_id, agreement_type, is_active);

COMMENT ON TABLE public.service_agreements IS
  'Contract/payer governance for dispatch jobs. '
  'Controls SLA defaults, client portal submission rights, and auto-dispatch rules. '
  'See docs/DISPATCH_SCHEDULING_ARCHITECTURE.md §3.3.';

COMMENT ON COLUMN public.service_agreements.allows_client_submission IS
  'Client staff may submit jobs via the portal when true';
COMMENT ON COLUMN public.service_agreements.allows_auto_dispatch IS
  'Submitted jobs skip approval and are dispatched immediately (e.g. monitoring centres)';

CREATE OR REPLACE FUNCTION public.update_service_agreements_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_service_agreements_updated_at
  BEFORE UPDATE ON public.service_agreements
  FOR EACH ROW EXECUTE FUNCTION public.update_service_agreements_updated_at();

ALTER TABLE public.service_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_service_agreements"
  ON public.service_agreements FOR SELECT TO authenticated
  USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "admins_manage_service_agreements"
  ON public.service_agreements FOR ALL TO authenticated
  USING (
    organization_id = get_user_organization_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'master', 'grand_master')
  )
  WITH CHECK (
    organization_id = get_user_organization_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'master', 'grand_master')
  );


-- ── 3. JOB TYPES ─────────────────────────────────────────────────────────────
--
-- Structured registry of job module/specialty types.
-- Platform-level types (organization_id IS NULL) are visible to all orgs.
-- Org-level types override or extend the platform list.

CREATE TABLE IF NOT EXISTS public.job_types (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- null = platform-wide type; non-null = org-specific extension
  organization_id       UUID        REFERENCES public.organizations(id) ON DELETE CASCADE,

  code                  TEXT        NOT NULL,   -- e.g. 'noise_complaint', 'alarm_response'
  label                 TEXT        NOT NULL,   -- e.g. 'Noise Complaint'

  -- Module / specialty grouping
  module                TEXT        NOT NULL DEFAULT 'security'
    CHECK (module IN (
      'security',       -- alarm response, guarding, escort, CIT
      'enforcement',    -- freedom camping, parking, noise control
      'community',      -- welfare check, public safety
      'investigation',  -- PI-style investigations
      'ems',            -- electronic monitoring
      'other'
    )),

  -- Dispatch behaviour defaults
  default_sla_minutes   INTEGER     NOT NULL DEFAULT 60,
  default_priority      TEXT        NOT NULL DEFAULT 'normal'
    CHECK (default_priority IN ('low', 'normal', 'high', 'urgent')),

  -- Whether a ClientSite is required for this job type
  -- false = community/public-space jobs (noise, parking, FC, etc.)
  requires_client_site  BOOLEAN     NOT NULL DEFAULT false,

  -- UI helpers
  icon                  TEXT,       -- icon key for frontend rendering
  color                 TEXT,       -- hex color for UI badges

  sort_order            INTEGER     NOT NULL DEFAULT 0,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique code per scope (platform or per-org)
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_types_code_org
  ON public.job_types(code, organization_id)
  WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_types_code_platform
  ON public.job_types(code)
  WHERE organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_job_types_module
  ON public.job_types(module, is_active);

COMMENT ON TABLE public.job_types IS
  'Structured module/specialty type registry. '
  'requires_client_site=false allows community jobs (noise, FC, parking) to be dispatched '
  'without a paying client site. See docs/DISPATCH_SCHEDULING_ARCHITECTURE.md §3.4.';

ALTER TABLE public.job_types ENABLE ROW LEVEL SECURITY;

-- Platform types (org IS NULL) are readable by all
CREATE POLICY "all_read_platform_job_types"
  ON public.job_types FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "admins_manage_org_job_types"
  ON public.job_types FOR ALL TO authenticated
  USING (
    organization_id = get_user_organization_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'master', 'grand_master')
  )
  WITH CHECK (
    organization_id = get_user_organization_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'master', 'grand_master')
  );

-- Seed platform-level job types
INSERT INTO public.job_types (organization_id, code, label, module, default_sla_minutes, default_priority, requires_client_site, sort_order)
VALUES
  -- Security
  (NULL, 'alarm_response',         'Alarm Response',                 'security',     20,  'high',   true,  10),
  (NULL, 'permanent_patrol',       'Permanent Patrol',               'security',     60,  'normal', false, 20),
  (NULL, 'casual_patrol',          'Casual Patrol',                  'security',     60,  'normal', false, 30),
  (NULL, 'escort',                 'Escort',                         'security',     30,  'normal', false, 40),
  (NULL, 'key_collection',         'Key Collection',                 'security',     30,  'normal', true,  50),
  (NULL, 'key_return',             'Key Return',                     'security',     30,  'normal', true,  60),
  (NULL, 'let_in',                 'Let In',                         'security',     30,  'normal', true,  70),
  (NULL, 'let_out',                'Let Out',                        'security',     30,  'normal', true,  80),
  (NULL, 'lockup',                 'Lockup',                         'security',     30,  'normal', true,  90),
  (NULL, 'lock_unlock',            'Lock / Unlock',                  'security',     30,  'normal', true,  100),
  (NULL, 'alarm_reset',            'Alarm Reset',                    'security',     20,  'normal', true,  110),
  (NULL, 'first_line_one_guard',   'First Line (1 Guard)',           'security',     20,  'high',   true,  120),
  (NULL, 'first_line_two_guard',   'First Line (2 Guards)',          'security',     20,  'high',   true,  130),
  (NULL, 'second_line_response',   'Second Line Response',           'security',     30,  'high',   true,  140),
  (NULL, 'cash_in_transit',        'Cash in Transit',                'security',     60,  'urgent', true,  150),
  (NULL, 'property_check',         'Property Check',                 'security',     60,  'normal', false, 160),
  (NULL, 'vandalism',              'Vandalism',                      'security',     60,  'normal', false, 170),
  (NULL, 'suspicious_activity',    'Suspicious Activity',            'security',     30,  'high',   false, 180),
  -- Enforcement / community
  (NULL, 'noise_complaint',        'Noise Complaint',                'enforcement',  45,  'normal', false, 200),
  (NULL, 'freedom_camping',        'Freedom Camping',                'enforcement',  60,  'normal', false, 210),
  (NULL, 'parking',                'Parking Enforcement',            'enforcement',  60,  'normal', false, 220),
  (NULL, 'biosecurity',            'Biosecurity Inspection',         'enforcement',  60,  'normal', false, 230),
  (NULL, 'smoke_complaint',        'Smoke / Out of Hours Complaint', 'enforcement',  45,  'normal', false, 240),
  -- Community
  (NULL, 'welfare_check',          'Welfare Check',                  'community',    30,  'high',   false, 300),
  (NULL, 'medical',                'Medical Assist',                 'community',    15,  'urgent', false, 310),
  (NULL, 'fire',                   'Fire / Hazard',                  'community',    15,  'urgent', false, 320),
  -- Investigation
  (NULL, 'investigation',          'Investigation',                  'investigation',120, 'normal', false, 400),
  -- EMS
  (NULL, 'ems',                    'Electronic Monitoring Services', 'ems',          60,  'normal', false, 500),
  -- Misc
  (NULL, 'general',                'General',                        'other',        60,  'normal', false, 900),
  (NULL, 'other',                  'Other',                          'other',        60,  'normal', false, 910)
ON CONFLICT DO NOTHING;


-- ── 4. DISPATCH RESOURCES (PATROL RUNS) ──────────────────────────────────────
--
-- Represents a named patrol run / callsign (e.g., "587 Nelson Night Patrol").
-- This is the primary dispatch target. The roster layer separately resolves
-- which officer is currently assigned to a run.
--
-- Relationship to patrol_routes:
--   patrol_routes defines named route templates with checkpoints and zones.
--   dispatch_resources defines the *dispatchable unit / callsign* that operates
--   a patrol run. A dispatch_resource may optionally reference a patrol_route.

CREATE TABLE IF NOT EXISTS public.dispatch_resources (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Callsign / identifier (e.g. "587", "AC3", "ECHO 1")
  callsign                  TEXT        NOT NULL,

  -- Display name (e.g. "Nelson Night Patrol (Nelson)")
  display_name              TEXT        NOT NULL,

  -- Resource classification
  resource_type             TEXT        NOT NULL DEFAULT 'patrol_run'
    CHECK (resource_type IN (
      'patrol_run',     -- regular mobile patrol run
      'static_guard',   -- static / fixed-post guard
      'response_unit',  -- dedicated alarm response
      'supervisor',     -- supervisor / manager on call
      'contractor'      -- subcontractor run
    )),

  -- Depot / home zone (used for distance/routing estimates)
  depot_zone_id             UUID        REFERENCES public.zones(id) ON DELETE SET NULL,

  -- Optional link to a patrol route template
  patrol_route_id           UUID        REFERENCES public.patrol_routes(id) ON DELETE SET NULL,

  -- Shift schedule defaults
  shift_start_time          TIME,       -- e.g. 18:00
  shift_end_time            TIME,       -- e.g. 06:00 (may cross midnight)
  active_days               INTEGER[]   DEFAULT '{1,2,3,4,5,6,7}',
  -- ISO day-of-week: 1=Monday … 7=Sunday

  -- Auto-dispatch configuration
  auto_dispatch_enabled     BOOLEAN     NOT NULL DEFAULT false,
  auto_dispatch_sms         TEXT,       -- SMS number for automatic dispatch notifications
  auto_dispatch_app_user_id UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  -- ^ App user that receives push notifications when auto-dispatch is triggered

  -- Subcontractor info
  is_subcontractor          BOOLEAN     NOT NULL DEFAULT false,
  provider_org_id           UUID        REFERENCES public.organizations(id) ON DELETE SET NULL,

  -- Service types this resource handles (empty = all)
  supported_job_type_codes  TEXT[]      DEFAULT '{}',

  is_active                 BOOLEAN     NOT NULL DEFAULT true,
  created_by                UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Callsign must be unique within an organisation
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_resources_callsign
  ON public.dispatch_resources(organization_id, callsign)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_dispatch_resources_org
  ON public.dispatch_resources(organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_dispatch_resources_type
  ON public.dispatch_resources(organization_id, resource_type, is_active);

COMMENT ON TABLE public.dispatch_resources IS
  'Named patrol runs / callsigns. The primary dispatch target. '
  'Roster resolves which officer is on a run at dispatch time. '
  'See docs/DISPATCH_SCHEDULING_ARCHITECTURE.md §3.5.';

COMMENT ON COLUMN public.dispatch_resources.callsign IS
  'Short operational radio/dispatch callsign, e.g. "587", "AC3", "ECHO 1"';
COMMENT ON COLUMN public.dispatch_resources.active_days IS
  'ISO weekday numbers 1=Monday … 7=Sunday on which this run operates';
COMMENT ON COLUMN public.dispatch_resources.auto_dispatch_enabled IS
  'When true this resource can receive jobs via automatic polygon-zone assignment';

CREATE OR REPLACE FUNCTION public.update_dispatch_resources_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_dispatch_resources_updated_at
  BEFORE UPDATE ON public.dispatch_resources
  FOR EACH ROW EXECUTE FUNCTION public.update_dispatch_resources_updated_at();

ALTER TABLE public.dispatch_resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_dispatch_resources"
  ON public.dispatch_resources FOR SELECT TO authenticated
  USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "admins_manage_dispatch_resources"
  ON public.dispatch_resources FOR ALL TO authenticated
  USING (
    organization_id = get_user_organization_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
  )
  WITH CHECK (
    organization_id = get_user_organization_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
  );


-- ── 5. ZONE → DISPATCH RESOURCE COVERAGE RULES ───────────────────────────────
--
-- Maps a geographic zone (geofence) to the DispatchResource responsible for
-- handling jobs within that zone. Rules can be filtered by job type code,
-- day-of-week, and time window to support shift-aware selection.
--
-- The TypeScript dispatchAssignment service uses these rules to automatically
-- select the correct patrol run when a new job is created.

CREATE TABLE IF NOT EXISTS public.zone_dispatch_resource_rules (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- The geofence zone that this rule covers
  zone_id               UUID        NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,

  -- The dispatch resource assigned to handle jobs in this zone
  dispatch_resource_id  UUID        NOT NULL REFERENCES public.dispatch_resources(id) ON DELETE CASCADE,

  -- Optional job-type filter (NULL = applies to all job types)
  job_type_code         TEXT,

  -- Optional day-of-week filter (NULL = all days; 1=Mon…7=Sun)
  day_of_week           INTEGER     CHECK (day_of_week BETWEEN 1 AND 7),

  -- Optional time-of-day window (NULL = all hours)
  time_from             TIME,
  time_to               TIME,

  -- Priority for resolving multiple matching rules (lower = higher priority)
  priority              INTEGER     NOT NULL DEFAULT 100,

  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_by            UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zone_dr_rules_zone
  ON public.zone_dispatch_resource_rules(zone_id, is_active);

CREATE INDEX IF NOT EXISTS idx_zone_dr_rules_resource
  ON public.zone_dispatch_resource_rules(dispatch_resource_id, is_active);

CREATE INDEX IF NOT EXISTS idx_zone_dr_rules_org
  ON public.zone_dispatch_resource_rules(organization_id, is_active);

COMMENT ON TABLE public.zone_dispatch_resource_rules IS
  'Maps geofence zones to DispatchResources for automatic job assignment. '
  'Filtered by job_type_code, day_of_week, time_from/to for shift-aware selection. '
  'See docs/DISPATCH_SCHEDULING_ARCHITECTURE.md §6.';

ALTER TABLE public.zone_dispatch_resource_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_zone_dr_rules"
  ON public.zone_dispatch_resource_rules FOR SELECT TO authenticated
  USING (organization_id = get_user_organization_id(auth.uid()));

CREATE POLICY "admins_manage_zone_dr_rules"
  ON public.zone_dispatch_resource_rules FOR ALL TO authenticated
  USING (
    organization_id = get_user_organization_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
  )
  WITH CHECK (
    organization_id = get_user_organization_id(auth.uid())
    AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
  );


-- ── 6. EXTEND DISPATCH_JOBS ───────────────────────────────────────────────────
--
-- Add LOI, ServiceAgreement, DispatchResource, and JobType references.
-- All columns are nullable to maintain backwards compatibility with existing jobs.
-- The `pending_approval` status supports the client portal submission flow.

-- LOI reference (canonical address for the job)
ALTER TABLE public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS loi_id UUID
    REFERENCES public.locations_of_interest(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.dispatch_jobs.loi_id IS
  'Location of Interest — canonical address anchor. '
  'Required for new jobs; nullable for backwards compatibility with pre-LOI jobs. '
  'client_site_id is still used for alarm/guarding jobs.';

-- Service agreement (governs payer, SLA, portal submission rights)
ALTER TABLE public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS service_agreement_id UUID
    REFERENCES public.service_agreements(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.dispatch_jobs.service_agreement_id IS
  'Links this job to its governing service agreement (payer, SLA, auto-dispatch rules)';

-- Dispatch resource (the assigned patrol run / callsign)
ALTER TABLE public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS dispatch_resource_id UUID
    REFERENCES public.dispatch_resources(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.dispatch_jobs.dispatch_resource_id IS
  'The patrol run / callsign assigned to handle this job. '
  'Replaces direct officer assignment at dispatch time; roster resolves the officer.';

-- Job type reference (structured type registry)
ALTER TABLE public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS job_type_id UUID
    REFERENCES public.job_types(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.dispatch_jobs.job_type_id IS
  'Optional reference to the job_types registry for structured module/specialty classification. '
  'Falls back to the existing job_type TEXT column for backwards compatibility.';

-- Pending approval status for client portal submissions
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  -- The new constraint is a strict superset of the old one (we only add
  -- 'pending_approval'; no previously valid value is removed).  Existing rows
  -- therefore cannot violate the new constraint.  We nonetheless verify this
  -- before touching the constraint so any unexpected data surfaced now, not
  -- silently at query time.
  SELECT COUNT(*) INTO invalid_count
  FROM public.dispatch_jobs
  WHERE status NOT IN (
    'pending', 'pending_approval',
    'dispatched', 'acknowledged', 'en_route',
    'on_scene', 'completed', 'cancelled'
  );

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'dispatch_jobs has % row(s) with status values outside the new allowed set. '
      'Inspect with: SELECT id, status FROM dispatch_jobs WHERE status NOT IN '
      '(''pending'',''pending_approval'',''dispatched'',''acknowledged'','
      '''en_route'',''on_scene'',''completed'',''cancelled'');',
      invalid_count;
  END IF;

  -- Drop the old constraint and replace it with the extended version.
  ALTER TABLE public.dispatch_jobs
    DROP CONSTRAINT IF EXISTS dispatch_jobs_status_check;

  ALTER TABLE public.dispatch_jobs
    ADD CONSTRAINT dispatch_jobs_status_check
    CHECK (status IN (
      'pending',
      'pending_approval',   -- submitted via client portal, awaiting dispatch approval
      'dispatched',
      'acknowledged',
      'en_route',
      'on_scene',
      'completed',
      'cancelled'
    ));
END;
$$;

-- Assist resources (officers from other runs helping cross-boundary)
ALTER TABLE public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS assist_resource_ids UUID[] DEFAULT '{}';

COMMENT ON COLUMN public.dispatch_jobs.assist_resource_ids IS
  'Secondary DispatchResource IDs providing cross-boundary assistance. '
  'Primary assignment remains dispatch_resource_id.';

-- Indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_loi
  ON public.dispatch_jobs(loi_id)
  WHERE loi_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_service_agreement
  ON public.dispatch_jobs(service_agreement_id)
  WHERE service_agreement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_dispatch_resource
  ON public.dispatch_jobs(dispatch_resource_id, status)
  WHERE dispatch_resource_id IS NOT NULL;


-- ── 7. VERIFICATION ───────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '✅ generate_loi_circular_polygon() function created (pure-trig, no PostGIS)';
  RAISE NOTICE '✅ locations_of_interest table created';
  RAISE NOTICE '✅ loi_auto_geofence trigger: geofence_geometry auto-populated on insert/update';
  RAISE NOTICE '✅ service_agreements table created';
  RAISE NOTICE '✅ job_types table created with platform seeds';
  RAISE NOTICE '✅ dispatch_resources table created';
  RAISE NOTICE '✅ zone_dispatch_resource_rules table created';
  RAISE NOTICE '✅ dispatch_jobs extended: loi_id, service_agreement_id, dispatch_resource_id, job_type_id, assist_resource_ids';
  RAISE NOTICE '✅ dispatch_jobs status constraint updated to include pending_approval';
  RAISE NOTICE 'ℹ  All new columns are nullable — existing jobs are unaffected';
  RAISE NOTICE 'ℹ  geofence_geometry is a GeoJSON Polygon, compatible with geofence.ts detectCurrentZones';
END;
$$;
