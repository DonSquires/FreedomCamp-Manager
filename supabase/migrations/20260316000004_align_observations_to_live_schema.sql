-- Align fresh and recovered environments with the verified live observations schema.
-- Live schema source: docs/LIVE_SCHEMA.md and src/types/database.ts

-- The live database does not expose these legacy columns/triggers on public.observations.
-- Keep the cleanup idempotent so it is safe on environments that already match production.

DROP TRIGGER IF EXISTS trigger_populate_compliance_summary ON public.observations;

DROP INDEX IF EXISTS public.idx_observations_compliance_summary;
DROP INDEX IF EXISTS public.idx_observations_weather_conditions;

ALTER TABLE public.observations
  DROP COLUMN IF EXISTS compliance_summary,
  DROP COLUMN IF EXISTS weather_conditions;
