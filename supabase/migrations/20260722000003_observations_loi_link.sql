-- =============================================================================
-- Migration: Add loi_id to observations + canonical_vehicle_id linkage
--
-- Observations now link directly to their Location of Interest (LOI) rather
-- than indirectly via zones.loi_id. This maintains a canonical record:
--
--   observations → loi_id → locations_of_interest  (where it happened)
--   observations → plate_number → canonical_vehicles  (what vehicle)
--
-- Zones remain a routing/dispatch concept. All "where" data lives in LOI.
-- =============================================================================

-- ── 1. Add loi_id column to observations ─────────────────────────────────────

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS loi_id UUID REFERENCES public.locations_of_interest(id) ON DELETE SET NULL;

-- Index for fast LOI-scoped queries (e.g. breach counts per freedom camp zone)
CREATE INDEX IF NOT EXISTS idx_observations_loi_id
  ON public.observations(loi_id)
  WHERE loi_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_observations_loi_org
  ON public.observations(organization_id, loi_id, recorded_at DESC)
  WHERE loi_id IS NOT NULL;

-- ── 2. Auto-populate loi_id from zone.loi_id on insert/update ────────────────

CREATE OR REPLACE FUNCTION public.fn_observations_populate_loi_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_loi_id UUID;
BEGIN
  -- Only derive if loi_id is not explicitly provided and zone_id is present
  IF NEW.loi_id IS NULL AND NEW.zone_id IS NOT NULL THEN
    SELECT z.loi_id INTO v_loi_id
    FROM public.zones z
    WHERE z.id = NEW.zone_id
    LIMIT 1;

    NEW.loi_id := v_loi_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_observations_populate_loi_id ON public.observations;
CREATE TRIGGER trg_observations_populate_loi_id
  BEFORE INSERT OR UPDATE OF zone_id ON public.observations
  FOR EACH ROW EXECUTE FUNCTION public.fn_observations_populate_loi_id();

-- ── 3. Backfill existing observations with loi_id from their zone ─────────────

UPDATE public.observations o
SET loi_id = z.loi_id
FROM public.zones z
WHERE o.zone_id = z.id
  AND z.loi_id IS NOT NULL
  AND o.loi_id IS NULL;

-- ── 4. Add canonical_vehicle_id to observations (optional FK to canonical_vehicles)
-- Allows direct join to canonical vehicle record without going via plate_number string
-- plate_number remains the primary join key; this is a convenience FK.

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS canonical_vehicle_plate TEXT REFERENCES public.canonical_vehicles(plate_number) ON DELETE SET NULL;

-- Auto-populate canonical_vehicle_plate from plate_number on insert
CREATE OR REPLACE FUNCTION public.fn_observations_link_canonical_vehicle()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Sync canonical_vehicle_plate with plate_number when plate is resolved
  IF NEW.plate_number IS NOT NULL
     AND NEW.plate_number NOT LIKE 'PROCESSING%'
     AND NEW.plate_number != 'MANUAL_REQUIRED'
     AND NEW.canonical_vehicle_plate IS DISTINCT FROM NEW.plate_number THEN

    -- Ensure canonical_vehicles row exists (minimal upsert, full data comes from NZSCV)
    INSERT INTO public.canonical_vehicles (plate_number, first_seen_at, last_seen_at)
    VALUES (NEW.plate_number, COALESCE(NEW.recorded_at, now()), COALESCE(NEW.recorded_at, now()))
    ON CONFLICT (plate_number) DO UPDATE
      SET last_seen_at = GREATEST(canonical_vehicles.last_seen_at, EXCLUDED.last_seen_at),
          total_observations = canonical_vehicles.total_observations + 1,
          updated_at = now();

    NEW.canonical_vehicle_plate := NEW.plate_number;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_observations_link_canonical_vehicle ON public.observations;
CREATE TRIGGER trg_observations_link_canonical_vehicle
  BEFORE INSERT OR UPDATE OF plate_number ON public.observations
  FOR EACH ROW EXECUTE FUNCTION public.fn_observations_link_canonical_vehicle();

-- Backfill canonical_vehicle_plate for existing resolved observations
UPDATE public.observations
SET canonical_vehicle_plate = plate_number
WHERE plate_number IS NOT NULL
  AND plate_number NOT LIKE 'PROCESSING%'
  AND plate_number != 'MANUAL_REQUIRED'
  AND canonical_vehicle_plate IS NULL;

-- Ensure canonical_vehicles rows exist for all backfilled plates
INSERT INTO public.canonical_vehicles (plate_number, first_seen_at, last_seen_at)
SELECT
  o.plate_number,
  MIN(o.recorded_at),
  MAX(o.recorded_at)
FROM public.observations o
WHERE o.plate_number IS NOT NULL
  AND o.plate_number NOT LIKE 'PROCESSING%'
  AND o.plate_number != 'MANUAL_REQUIRED'
GROUP BY o.plate_number
ON CONFLICT (plate_number) DO UPDATE
  SET last_seen_at = GREATEST(canonical_vehicles.last_seen_at, EXCLUDED.last_seen_at),
      updated_at = now();

-- ── 5. Comments ───────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.observations.loi_id IS
  'Direct FK to locations_of_interest — the canonical "where" for this observation. '
  'Auto-populated from zones.loi_id on insert if zone_id is present. '
  'Freedom camping, patrol, alarm and static site zones all live in LOI.';

COMMENT ON COLUMN public.observations.canonical_vehicle_plate IS
  'FK to canonical_vehicles — the canonical plate-keyed vehicle record. '
  'Auto-populated and auto-upserts canonical_vehicles when plate_number is resolved. '
  'NZSCV and ALPR data fill the canonical_vehicles row via process-officer-scan.';
