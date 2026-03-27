-- =============================================================================
-- Fix indexes — identified via Database Schema Extract run #1 (2026-03-26)
--
-- Problems fixed:
--   1. idx_zones_geometry: zones.geometry is stored as JSONB (GeoJSON), not a
--      PostGIS geometry type.  GiST requires PostGIS; GIN is the correct access
--      method for JSONB columns.  The old GIN index is dropped and recreated
--      under the same name so no application code needs updating.
--
--   2. canonical_vehicles_vehicle_id_key is a duplicate unique constraint
--      for the same column already covered by idx_canonical_vehicles_vehicle_id.
--      Duplicate unique constraints add write overhead with no query benefit.
--
--   3. idx_canonical_vehicles_updated_at — 1.7 MB, 0 scans since creation.
--
--   4. Missing FK support indexes on dispatch_jobs: client_site_id, zone_id,
--      breach_alert_id, investigation_job_id.  These are nullable FK columns
--      used in JOIN / filter queries and cascade DELETEs.
-- =============================================================================

-- ── 1. Recreate GIN geometry index (zones.geometry is JSONB, not PostGIS) ────
DROP INDEX IF EXISTS public.idx_zones_geometry;

-- Re-use the original name so no application code needs updating.
-- NOTE: CONCURRENTLY cannot be used inside a transaction / migration pipeline.
CREATE INDEX IF NOT EXISTS idx_zones_geometry
  ON public.zones USING gin (geometry);

-- ── 2. Drop duplicate unique constraint on canonical_vehicles.vehicle_id ──────
-- The partial unique index idx_canonical_vehicles_vehicle_id already enforces
-- uniqueness; this btree duplicate adds ~3.8 MB of write overhead for nothing.
ALTER TABLE public.canonical_vehicles
  DROP CONSTRAINT IF EXISTS canonical_vehicles_vehicle_id_key;

-- ── 3. Drop stale index on canonical_vehicles.updated_at ─────────────────────
DROP INDEX IF EXISTS public.idx_canonical_vehicles_updated_at;

-- ── 4. Add missing FK support indexes on dispatch_jobs ───────────────────────
CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_client_site
  ON public.dispatch_jobs (client_site_id)
  WHERE client_site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_zone
  ON public.dispatch_jobs (zone_id)
  WHERE zone_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_breach_alert
  ON public.dispatch_jobs (breach_alert_id)
  WHERE breach_alert_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_investigation_job
  ON public.dispatch_jobs (investigation_job_id)
  WHERE investigation_job_id IS NOT NULL;
