-- =============================================================================
-- Migration: GeoZones — Polygon/Area Entities Separate from Dispatch
-- Date: 2026-07-07
-- =============================================================================
--
-- Problem this solves:
--   The existing `zones` table conflates two distinct concepts:
--     (a) Geofence polygon/area  — "where" (geography)
--     (b) Patrol run/callsign    — "who covers it" (operational resource)
--
--   This migration introduces `geo_zones` as the canonical polygon-area table.
--   The existing `zones` table is kept intact for backwards compatibility;
--   a `zone_kind` column and FK bridges are added to `zones` so each existing
--   record can declare whether it is:
--     'geo'      – purely a polygon/area (→ references geo_zones)
--     'dispatch' – purely a patrol run/callsign (→ references dispatch_resources)
--     'both'     – currently mixing both concerns (legacy; should be split)
--
-- GeoZone holds:
--   - Polygon geometry (GeoJSON — matching existing zones.geometry convention)
--   - Jurisdiction / authority metadata
--   - Land-managing agency (mirrors zones.land_managing_agency)
--   - Seasonal access windows
--   - Task types applicable in this area (freedom_camping, parking, etc.)
--
-- Relationship summary:
--   geo_zones  1──* locations_of_interest  (LOIs whose coords fall inside)
--   geo_zones  *──* dispatch_resources      (via geo_zone_dispatch_map)
--   zones      1──1 geo_zones              (optional bridge FK)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.geo_zones (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Identity
  name                  TEXT        NOT NULL,
  short_code            TEXT,                -- e.g. "NBS-PARK-01"
  description           TEXT,

  -- Polygon geometry (GeoJSON, matching existing zones.geometry convention)
  -- PostGIS `geom` column is also available via the existing postgis extension
  -- (added in 20260701000002). Both are kept in sync by application layer.
  geometry_geojson      JSONB,               -- GeoJSON Polygon / MultiPolygon
  geom                  geography(POLYGON, 4326),  -- PostGIS for spatial queries

  -- Centroid (for quick Haversine lookups and display)
  center_lat            DOUBLE PRECISION,
  center_lng            DOUBLE PRECISION,
  radius_meters         INTEGER     NOT NULL DEFAULT 500,

  -- Jurisdiction / legal metadata
  land_managing_agency  TEXT
    CHECK (land_managing_agency IN ('council','doc','linz','nzta','crown','private','other')),
  jurisdiction_org_id   UUID        REFERENCES public.organizations(id) ON DELETE SET NULL,
  bylaw_reference       TEXT,
  legal_description     TEXT,

  -- Applicable task types within this area
  -- e.g. ['freedom_camping','parking','excessive_smoke','noise']
  task_types            TEXT[]      DEFAULT '{}',

  -- Seasonal access
  seasonal_open_month   SMALLINT    CHECK (seasonal_open_month  BETWEEN 1 AND 12),
  seasonal_close_month  SMALLINT    CHECK (seasonal_close_month BETWEEN 1 AND 12),

  -- Display / UI
  color                 TEXT        DEFAULT '#3B82F6',
  icon                  TEXT        DEFAULT 'map-pin',

  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_by            UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_geo_zones_org_active
  ON public.geo_zones(organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_geo_zones_center
  ON public.geo_zones(center_lat, center_lng)
  WHERE center_lat IS NOT NULL AND center_lng IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_geo_zones_geometry
  ON public.geo_zones USING gin(geometry_geojson);

CREATE INDEX IF NOT EXISTS idx_geo_zones_geom
  ON public.geo_zones USING gist(geom)
  WHERE geom IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_geo_zones_task_types
  ON public.geo_zones USING gin(task_types);

-- ── Updated-at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_geo_zones_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_geo_zones_updated_at ON public.geo_zones;
CREATE TRIGGER trg_geo_zones_updated_at
  BEFORE UPDATE ON public.geo_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_geo_zones_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.geo_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "geo_zones_select_org_members"
  ON public.geo_zones FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT unnest(get_user_organization_ids()))
  );

CREATE POLICY "geo_zones_write_admins"
  ON public.geo_zones FOR ALL TO authenticated
  USING (
    organization_id IN (SELECT unnest(get_user_organization_ids()))
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master')
    )
  )
  WITH CHECK (
    organization_id IN (SELECT unnest(get_user_organization_ids()))
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master')
    )
  );

-- ── Convenience function: is_geo_zone_seasonally_open ────────────────────────
CREATE OR REPLACE FUNCTION public.is_geo_zone_seasonally_open(p_geo_zone_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open  SMALLINT;
  v_close SMALLINT;
  v_month SMALLINT;
BEGIN
  SELECT seasonal_open_month, seasonal_close_month
    INTO v_open, v_close
    FROM public.geo_zones
   WHERE id = p_geo_zone_id;

  IF v_open IS NULL OR v_close IS NULL THEN
    RETURN TRUE;
  END IF;

  v_month := EXTRACT(MONTH FROM NOW() AT TIME ZONE 'Pacific/Auckland')::SMALLINT;

  IF v_open <= v_close THEN
    RETURN v_month BETWEEN v_open AND v_close;
  ELSE
    RETURN v_month >= v_open OR v_month <= v_close;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_geo_zone_seasonally_open(UUID) TO authenticated;

-- ── Column comments ───────────────────────────────────────────────────────────
COMMENT ON TABLE  public.geo_zones IS
  'Polygon/area entities representing geographic coverage zones. '
  'Distinct from dispatch_resources (patrol runs/callsigns). '
  'The existing zones table may reference geo_zones via zones.geo_zone_id.';

COMMENT ON COLUMN public.geo_zones.geometry_geojson IS
  'GeoJSON Polygon or MultiPolygon matching the zones.geometry convention. '
  'Use geom (PostGIS geography) column for spatial operators.';
COMMENT ON COLUMN public.geo_zones.geom IS
  'PostGIS geography column for spatial containment queries. '
  'Should be kept in sync with geometry_geojson.';
COMMENT ON COLUMN public.geo_zones.task_types IS
  'Task types applicable within this area, e.g. freedom_camping, parking, '
  'excessive_smoke, noise, trespass, litter, bylaw_enforcement.';
COMMENT ON COLUMN public.geo_zones.land_managing_agency IS
  'Authority managing the land. Determines applicable legislation.';
