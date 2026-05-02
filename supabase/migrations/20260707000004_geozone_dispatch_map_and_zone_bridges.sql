-- =============================================================================
-- Migration: GeoZone-DispatchResource Mapping + Zone Compatibility Bridges
-- Date: 2026-07-07
-- =============================================================================
--
-- Part A: geo_zone_dispatch_map
--   Routes job types / contract time-windows to dispatch resources.
--   A geo_zone can have multiple dispatch resources covering it (different job
--   types, different time windows, or assist/overflow assignments).
--
-- Part B: Zone compatibility bridges
--   Adds additive columns to the existing `zones` table so each record can
--   declare its "kind" and optionally point to the new structured tables:
--     zones.zone_kind     – 'geo' | 'dispatch' | 'both' | 'location_group'
--     zones.geo_zone_id   – FK to geo_zones (when zone acts as a polygon area)
--     zones.dispatch_resource_id – FK to dispatch_resources (when zone acts as a run)
--
--   This enables a gradual, backwards-compatible decomposition:
--     Phase 1 (this PR): add fields, populate via admin tooling / backfill scripts
--     Phase 2 (future):  migrate reads to the new tables, keep zones as legacy view
--     Phase 3 (future):  deprecate zones; replace with geo_zones + dispatch_resources
--
-- Part C: dispatch_jobs LOI integration
--   Adds loi_id (nullable) to dispatch_jobs so jobs can reference a canonical
--   location without requiring a client_site_id.
--   Conservative backfill: only sets loi_id when address data is unambiguous.
-- =============================================================================

-- =============================================================================
-- PART A: GeoZone → DispatchResource Mapping
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.geo_zone_dispatch_map (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- The polygon area
  geo_zone_id           UUID        NOT NULL REFERENCES public.geo_zones(id)          ON DELETE CASCADE,

  -- The dispatch resource covering this area
  dispatch_resource_id  UUID        NOT NULL REFERENCES public.dispatch_resources(id) ON DELETE CASCADE,

  -- Scope: which job types this mapping applies to (empty = all types)
  job_types             TEXT[]      DEFAULT '{}',

  -- Scope: which contract/payer (NULL = all contracts)
  contract_org_id       UUID        REFERENCES public.organizations(id) ON DELETE SET NULL,

  -- Time window constraints (ISO weekday 1=Mon–7=Sun, local NZ time)
  active_days           INTEGER[]   DEFAULT '{1,2,3,4,5,6,7}',
  window_start_time     TIME,
  window_end_time       TIME,

  -- Priority for overlap resolution (lower = preferred)
  priority              INTEGER     NOT NULL DEFAULT 10,

  -- Assignment mode
  assignment_mode       TEXT        NOT NULL DEFAULT 'primary'
                          CHECK (assignment_mode IN (
                            'primary',   -- default assigned run for the zone+type+window
                            'assist',    -- secondary run added for overflow / cross-boundary
                            'overflow'   -- used when primary is unavailable
                          )),

  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_by            UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (geo_zone_id, dispatch_resource_id, assignment_mode)
);

CREATE INDEX IF NOT EXISTS idx_gzdm_org_active
  ON public.geo_zone_dispatch_map(organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_gzdm_geo_zone
  ON public.geo_zone_dispatch_map(geo_zone_id, is_active, priority);

CREATE INDEX IF NOT EXISTS idx_gzdm_dispatch_resource
  ON public.geo_zone_dispatch_map(dispatch_resource_id);

CREATE INDEX IF NOT EXISTS idx_gzdm_job_types
  ON public.geo_zone_dispatch_map USING gin(job_types);

CREATE OR REPLACE FUNCTION public.update_geo_zone_dispatch_map_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_gzdm_updated_at ON public.geo_zone_dispatch_map;
CREATE TRIGGER trg_gzdm_updated_at
  BEFORE UPDATE ON public.geo_zone_dispatch_map
  FOR EACH ROW EXECUTE FUNCTION public.update_geo_zone_dispatch_map_updated_at();

ALTER TABLE public.geo_zone_dispatch_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gzdm_select_org_members"
  ON public.geo_zone_dispatch_map FOR SELECT TO authenticated
  USING (organization_id IN (SELECT unnest(get_user_organization_ids())));

CREATE POLICY "gzdm_write_admins"
  ON public.geo_zone_dispatch_map FOR ALL TO authenticated
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

COMMENT ON TABLE  public.geo_zone_dispatch_map IS
  'Routes job types / time windows within a geo_zone to the responsible '
  'dispatch_resource. Enables polygon-based auto-assignment.';
COMMENT ON COLUMN public.geo_zone_dispatch_map.job_types IS
  'Empty array = applies to all job types. Otherwise restrict to listed types.';
COMMENT ON COLUMN public.geo_zone_dispatch_map.assignment_mode IS
  'primary = default run; assist = secondary / overflow support; overflow = fallback.';

-- =============================================================================
-- PART B: Zone compatibility bridges
-- =============================================================================
-- Add zone_kind and FK bridges to the existing zones table.
-- All new columns are additive (nullable / have defaults) — no existing data
-- is modified, no existing constraints are changed.

ALTER TABLE public.zones
  -- Semantic kind: tells callers how to interpret this zone record
  ADD COLUMN IF NOT EXISTS zone_kind TEXT
    DEFAULT 'geo'
    CHECK (zone_kind IN (
      'geo',             -- polygon / geofence area only
      'dispatch',        -- patrol run / callsign only
      'both',            -- currently mixing both (legacy — should be split)
      'location_group'   -- wide operational area (mall, static guarding footprint)
    )),

  -- Bridge FK to geo_zones (populate when zone_kind IN ('geo', 'both'))
  ADD COLUMN IF NOT EXISTS geo_zone_id UUID
    REFERENCES public.geo_zones(id) ON DELETE SET NULL,

  -- Bridge FK to dispatch_resources (populate when zone_kind IN ('dispatch', 'both'))
  ADD COLUMN IF NOT EXISTS dispatch_resource_id UUID
    REFERENCES public.dispatch_resources(id) ON DELETE SET NULL;

-- Sparse indexes on the bridge columns
CREATE INDEX IF NOT EXISTS idx_zones_geo_zone_id
  ON public.zones(geo_zone_id)        WHERE geo_zone_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_zones_dispatch_resource_id
  ON public.zones(dispatch_resource_id) WHERE dispatch_resource_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_zones_zone_kind
  ON public.zones(organization_id, zone_kind) WHERE zone_kind IS NOT NULL;

COMMENT ON COLUMN public.zones.zone_kind IS
  'Compatibility bridge: geo=polygon area, dispatch=patrol run/callsign, '
  'both=legacy mixed record, location_group=wide operational area like a mall. '
  'Use geo_zones or dispatch_resources directly for new code.';
COMMENT ON COLUMN public.zones.geo_zone_id IS
  'Optional FK to geo_zones when this zone record represents a polygon area. '
  'Populated by admin tooling or backfill script; NULL means not yet migrated.';
COMMENT ON COLUMN public.zones.dispatch_resource_id IS
  'Optional FK to dispatch_resources when this zone record represents a patrol run. '
  'Populated by admin tooling or backfill script; NULL means not yet migrated.';

-- =============================================================================
-- PART C: dispatch_jobs — add loi_id (nullable, backwards compatible)
-- =============================================================================
-- Jobs can now reference a canonical LOI even when no client_site_id exists.
-- client_site_id remains nullable and is not removed.

ALTER TABLE public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS loi_id UUID
    REFERENCES public.locations_of_interest(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_loi
  ON public.dispatch_jobs(loi_id) WHERE loi_id IS NOT NULL;

-- Also add assigned_run_id so jobs can reference their dispatch resource
ALTER TABLE public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS assigned_run_id UUID
    REFERENCES public.dispatch_resources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_assigned_run
  ON public.dispatch_jobs(assigned_run_id) WHERE assigned_run_id IS NOT NULL;

COMMENT ON COLUMN public.dispatch_jobs.loi_id IS
  'Canonical location for this job (locations_of_interest). '
  'Required for noise/community jobs where no client_site_id exists. '
  'If NULL and address fields are present, a backfill script can create the LOI '
  '(see docs/DOMAIN_MODEL.md §LOI Backfill Strategy).';
COMMENT ON COLUMN public.dispatch_jobs.assigned_run_id IS
  'The dispatch_resource (patrol run/callsign) responsible for this job. '
  'Replaces the informal zone_id→callsign lookup.';

-- =============================================================================
-- PART D: Conservative LOI backfill
-- =============================================================================
-- Creates LOI records from dispatch_jobs where:
--   1. loi_id IS NULL (not yet linked)
--   2. address IS NOT NULL AND trim(address) != ''
--   3. gps_lat IS NOT NULL AND gps_lng IS NOT NULL (coordinates known)
--
-- This is the safest subset — we have both address text AND coordinates.
-- Jobs with address-only or coordinates-only are intentionally skipped
-- (would require geocoder round-trip or fuzzy matching — do separately).
-- A TODO comment is added at the end for the address-only backfill path.

DO $$
DECLARE
  r RECORD;
  new_loi_id UUID;
BEGIN
  FOR r IN
    SELECT id, organization_id, address, gps_lat, gps_lng, created_by
    FROM public.dispatch_jobs
    WHERE loi_id IS NULL
      AND address IS NOT NULL AND trim(address) <> ''
      AND gps_lat IS NOT NULL AND gps_lng IS NOT NULL
  LOOP
    BEGIN
      INSERT INTO public.locations_of_interest (
        organization_id,
        loi_kind,
        address_full,
        gps_lat,
        gps_lng,
        geocoder_source,
        geocoder_confidence,
        created_by
      ) VALUES (
        r.organization_id,
        'address',
        r.address,
        r.gps_lat,
        r.gps_lng,
        'backfill_dispatch_jobs',
        -- 0.6 = moderate confidence: we have both address text AND GPS coordinates
        -- but the address was free-text (not geocoder-normalised), so we cannot
        -- guarantee the text exactly matches the coordinates.  A geocoder round-trip
        -- would be needed to push confidence to 0.9+.
        0.6,
        r.created_by
      )
      RETURNING id INTO new_loi_id;

      UPDATE public.dispatch_jobs
        SET loi_id = new_loi_id
      WHERE id = r.id;

    EXCEPTION WHEN OTHERS THEN
      -- Skip rows that fail (e.g. FK violations) — backfill is best-effort
      RAISE NOTICE 'LOI backfill skipped for dispatch_jobs.id=%: %', r.id, SQLERRM;
    END;
  END LOOP;
END $$;

-- TODO (future migration): backfill LOI for dispatch_jobs where address IS NOT NULL
--   but gps_lat/gps_lng IS NULL — requires geocoder round-trip (LINZ AddressFinder
--   or Google Maps). Implement in a separate migration once the geocoder service
--   is wired in. Keep loi_id NULL until then.

-- TODO (future migration): backfill loi_id for dispatch_jobs linked to client_sites
--   that already have an address/GPS — create or reuse LOI from client_sites.address.
