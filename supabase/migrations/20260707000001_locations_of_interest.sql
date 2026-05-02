-- =============================================================================
-- Migration: Locations of Interest (LOI) — Canonical Point/Address Record
-- Date: 2026-07-07
-- =============================================================================
--
-- LOI is the single canonical "place" entity for anything that has a real-world
-- position.  All other addressable entities (client_sites, dispatch_resources,
-- etc.) reference LOI rather than storing duplicate address/coordinate data.
--
-- Design decisions:
--   - LOI stores the *point* centroid (lat/lng) + plain-text address.
--   - LOI does NOT store polygon geometry — that belongs to geo_zones.
--   - LOI may optionally reference a geo_zone (the polygon area it falls inside).
--   - Multiple LOIs can belong to the same org and/or the same geo_zone.
--   - address fields are nullable: an LOI can be created from GPS alone.
--   - loi_kind distinguishes semantically different flavours so queries can
--     filter without joining to subtype tables.
--
-- LOI flavours (loi_kind):
--   address          – a residential or commercial street address
--   park_reserve     – named park, reserve, or conservation area
--   freedom_camp     – designated or known freedom camping spot
--   poi              – generic Point of Interest (landmark, facility, etc.)
--   intersection     – named road intersection
--   ad_hoc           – created on-the-fly from a GPS fix with no known address
--   unknown          – placeholder when no location data is available
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.locations_of_interest (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id)  ON DELETE CASCADE,

  -- Human-readable identity
  name                TEXT,                                  -- optional short label
  description         TEXT,

  -- Kind / semantic flavour
  loi_kind            TEXT        NOT NULL DEFAULT 'address'
                        CHECK (loi_kind IN (
                          'address',
                          'park_reserve',
                          'freedom_camp',
                          'poi',
                          'intersection',
                          'ad_hoc',
                          'unknown'
                        )),

  -- Address components (all optional to support GPS-only records)
  address_line1       TEXT,
  address_line2       TEXT,
  suburb              TEXT,
  city                TEXT,
  region              TEXT,
  postcode            TEXT,
  country             TEXT        NOT NULL DEFAULT 'NZ',

  -- Full single-line address for display / search / geocoder round-trips
  address_full        TEXT,

  -- Geocoordinates (nullable — must be provided or resolved before routing)
  gps_lat             DOUBLE PRECISION,
  gps_lng             DOUBLE PRECISION,

  -- Optional spatial zone membership (cached — may lag behind geo_zone edits)
  -- Populated by the geo_zone polygon lookup service when available.
  geo_zone_ids        UUID[]      DEFAULT '{}',

  -- Dedup / merge support
  canonical_loi_id    UUID        REFERENCES public.locations_of_interest(id)  ON DELETE SET NULL,
  is_canonical        BOOLEAN     NOT NULL DEFAULT true,

  -- Hazards / access notes summary (detail stays in subtype tables)
  hazard_summary      TEXT,
  access_summary      TEXT,

  -- Geocoder metadata
  geocoded_at         TIMESTAMPTZ,
  geocoder_source     TEXT,       -- e.g. 'linz', 'google', 'manual', 'gps'
  geocoder_confidence NUMERIC(4,3) CHECK (geocoder_confidence BETWEEN 0 AND 1),

  -- Common flags
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_by          UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_loi_org_active
  ON public.locations_of_interest(organization_id, is_active, loi_kind);

CREATE INDEX IF NOT EXISTS idx_loi_coords
  ON public.locations_of_interest(gps_lat, gps_lng)
  WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loi_canonical
  ON public.locations_of_interest(canonical_loi_id)
  WHERE canonical_loi_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loi_address_full
  ON public.locations_of_interest USING gin(to_tsvector('english', coalesce(address_full, '')));

-- ── Updated-at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_loi_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_loi_updated_at ON public.locations_of_interest;
CREATE TRIGGER trg_loi_updated_at
  BEFORE UPDATE ON public.locations_of_interest
  FOR EACH ROW EXECUTE FUNCTION public.update_loi_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.locations_of_interest ENABLE ROW LEVEL SECURITY;

-- Org members may read LOIs in their org
CREATE POLICY "loi_select_org_members"
  ON public.locations_of_interest FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT unnest(get_user_organization_ids())
    )
  );

-- Admins/admin_officers/masters may insert, update, delete
CREATE POLICY "loi_write_admins"
  ON public.locations_of_interest FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT unnest(get_user_organization_ids())
    )
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'admin_officer', 'master')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT unnest(get_user_organization_ids())
    )
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'admin_officer', 'master')
    )
  );

-- Officers may insert LOIs (needed for ad-hoc dispatch from field)
CREATE POLICY "loi_insert_officers"
  ON public.locations_of_interest FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT unnest(get_user_organization_ids())
    )
  );

-- ── Column comments ───────────────────────────────────────────────────────────
COMMENT ON TABLE  public.locations_of_interest IS
  'Canonical point/address record. Single source of truth for any real-world '
  'location. Client sites, dispatch resources, jobs, and other entities '
  'reference LOI rather than storing duplicate address/coordinate data.';

COMMENT ON COLUMN public.locations_of_interest.loi_kind IS
  'Semantic flavour: address | park_reserve | freedom_camp | poi | intersection | ad_hoc | unknown';
COMMENT ON COLUMN public.locations_of_interest.geo_zone_ids IS
  'Cached array of geo_zone UUIDs whose polygon contains this LOI. '
  'Updated by the polygon lookup service; may be stale after zone edits.';
COMMENT ON COLUMN public.locations_of_interest.canonical_loi_id IS
  'Points to the canonical record when this LOI is a duplicate/alias. '
  'NULL means this record IS the canonical.';
COMMENT ON COLUMN public.locations_of_interest.is_canonical IS
  'FALSE when this record is a known duplicate and canonical_loi_id holds the '
  'preferred record to use.';
COMMENT ON COLUMN public.locations_of_interest.geocoder_confidence IS
  '0.0–1.0 confidence score from the geocoder (1.0 = exact match).';
