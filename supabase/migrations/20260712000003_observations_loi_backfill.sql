-- =============================================================================
-- Observations -> LOI Linkage Backfill
-- Date: 2026-07-12
-- =============================================================================
-- Purpose
--   Add loi_id to observations, backfill from zones.loi_id, and keep it aligned
--   for future inserts/updates. This is a compatibility bridge while legacy
--   zone_id references are still in active use.
-- =============================================================================

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS loi_id UUID
    REFERENCES public.locations_of_interest(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_observations_loi_id
  ON public.observations(loi_id)
  WHERE loi_id IS NOT NULL;

COMMENT ON COLUMN public.observations.loi_id IS
  'Canonical location for this observation. Backfilled from zones.loi_id for compatibility.';

-- Backfill from linked zone where available.
UPDATE public.observations o
SET loi_id = z.loi_id
FROM public.zones z
WHERE o.loi_id IS NULL
  AND o.zone_id = z.id
  AND z.loi_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_observation_loi_from_zone()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_loi_id UUID;
BEGIN
  IF NEW.loi_id IS NULL AND NEW.zone_id IS NOT NULL THEN
    SELECT loi_id INTO v_loi_id
    FROM public.zones
    WHERE id = NEW.zone_id
    LIMIT 1;

    NEW.loi_id := v_loi_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_observations_sync_loi_from_zone ON public.observations;
CREATE TRIGGER trg_observations_sync_loi_from_zone
  BEFORE INSERT OR UPDATE OF zone_id, loi_id
  ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_observation_loi_from_zone();
