-- Ensure observations has the minimum column set required by scan ingest/fallback
-- and refresh PostgREST schema cache.
-- Date: 2026-03-12

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS photo_hash text,
  ADD COLUMN IF NOT EXISTS recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS gps_latitude numeric(10,8),
  ADD COLUMN IF NOT EXISTS gps_longitude numeric(11,8),
  ADD COLUMN IF NOT EXISTS gps_accuracy numeric(10,2),
  ADD COLUMN IF NOT EXISTS officer_notes text,
  ADD COLUMN IF NOT EXISTS weather_conditions text,
  ADD COLUMN IF NOT EXISTS vehicle_make text,
  ADD COLUMN IF NOT EXISTS vehicle_model text,
  ADD COLUMN IF NOT EXISTS vehicle_year integer,
  ADD COLUMN IF NOT EXISTS vehicle_color text,
  ADD COLUMN IF NOT EXISTS self_contained boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS self_contained_expiry date,
  ADD COLUMN IF NOT EXISTS is_compliant boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS breach_type text,
  ADD COLUMN IF NOT EXISTS breach_reason text,
  ADD COLUMN IF NOT EXISTS nights_stayed_this_month integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_nights integer DEFAULT 0;

-- Keep idempotency duplicate protection when available.
DROP INDEX IF EXISTS public.idx_obs_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_idempotency_notnull
  ON public.observations (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Refresh PostgREST schema cache so newly added/existing columns are queryable.
NOTIFY pgrst, 'reload schema';
