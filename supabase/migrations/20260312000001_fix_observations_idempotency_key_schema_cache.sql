-- Ensure observations.idempotency_key exists and PostgREST schema cache is refreshed
-- Date: 2026-03-12

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS idempotency_key text;

COMMENT ON COLUMN public.observations.idempotency_key IS
  'Offline deduplication key from client capture flow (deviceId:localCaptureId).';

-- Keep deduplication strict when key is supplied, while allowing NULL for legacy rows.
DROP INDEX IF EXISTS public.idx_obs_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_idempotency_notnull
  ON public.observations (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Refresh PostgREST schema cache so Edge Functions can immediately query new columns.
NOTIFY pgrst, 'reload schema';
