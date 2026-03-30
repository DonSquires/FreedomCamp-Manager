-- =====================================================
-- GEOFENCE MISSING COLUMNS
-- =====================================================
-- Adds columns referenced by src/lib/geofence.ts that were
-- never added to the live schema, causing PostgreSQL error 42703
-- (column not found) when officers start a shift.
-- =====================================================

-- zones.radius_meters – used in geofence.ts zone queries
ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS radius_meters INTEGER DEFAULT 500;

-- patrols check-in tracking – used in geofence.ts auto check-in logic
ALTER TABLE public.patrols
  ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS check_in_location_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS check_in_location_lng NUMERIC,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.zones.radius_meters IS 'Override geofence radius in metres (default 500)';
COMMENT ON COLUMN public.patrols.checked_in_at IS 'Timestamp officer checked in via geofence or manual';
COMMENT ON COLUMN public.patrols.check_in_location_lat IS 'GPS latitude at check-in';
COMMENT ON COLUMN public.patrols.check_in_location_lng IS 'GPS longitude at check-in';
COMMENT ON COLUMN public.patrols.completed_at IS 'Timestamp patrol was completed';
