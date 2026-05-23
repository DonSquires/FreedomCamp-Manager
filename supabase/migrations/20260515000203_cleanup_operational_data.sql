-- =============================================================================
-- Cleanup Migration: Clear Operational Data (keep users + storage buckets)
-- Date: 2026-05-15
-- 
-- Truncates/deletes all operational records (zones, incidents, patrols, etc.)
-- while preserving:
--   - All users, user_profiles, auth data
--   - All storage bucket files and references
--   - All organization definitions (for fresh seeding)
-- =============================================================================

BEGIN;

-- Temporarily disable foreign key constraints to allow clean truncation
SET session_replication_role = 'replica';

CREATE TABLE IF NOT EXISTS public.geo_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  short_code TEXT,
  description TEXT,
  geometry_geojson JSONB,
  geom geography(POLYGON, 4326),
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
  radius_meters INTEGER NOT NULL DEFAULT 500,
  land_managing_agency TEXT,
  jurisdiction_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  bylaw_reference TEXT,
  legal_description TEXT,
  task_types TEXT[] DEFAULT '{}',
  seasonal_open_month SMALLINT,
  seasonal_close_month SMALLINT,
  color TEXT DEFAULT '#3B82F6',
  icon TEXT DEFAULT 'map-pin',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

-- Delete operational data (defensive: only if tables exist)
DO $$
BEGIN
  DELETE FROM public.observations;
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  DELETE FROM public.incident_media;
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  DELETE FROM public.incident_notes;
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DELETE FROM public.incidents;
DELETE FROM public.breach_alerts;

DO $$
BEGIN
  DELETE FROM public.patrol_media;
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  DELETE FROM public.patrol_notes;
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DELETE FROM public.patrols;

DO $$
BEGIN
  DELETE FROM public.patrol_checkpoints;
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DELETE FROM public.client_sites;
DELETE FROM public.geo_zones;
DELETE FROM public.zones;

-- Optional: Clear org-scoped transactional data if they exist
DO $$
BEGIN
  DELETE FROM public.telemetry_events WHERE event_type IN ('breach_detected', 'zone_entered', 'patrol_started');
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$
BEGIN
  DELETE FROM public.audit_logs WHERE resource_type IN ('incident', 'patrol', 'zone', 'geo_zone');
  EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Re-enable foreign key constraints
SET session_replication_role = 'origin';

-- Log the cleanup completion
DO $$
BEGIN
  RAISE NOTICE 'Operational data cleanup complete. Users, storage buckets, and organizations preserved.';
END $$;

COMMIT;
