-- =============================================================================
-- VOI Zone Visibility Backfill
-- Ensures vehicles_of_interest can display associated zones (incl. freedom camping)
-- =============================================================================

ALTER TABLE public.vehicles_of_interest
  ADD COLUMN IF NOT EXISTS primary_zone_id UUID REFERENCES public.zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS zone_last_observed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_voi_primary_zone_id
  ON public.vehicles_of_interest(primary_zone_id)
  WHERE primary_zone_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_voi_plate_org
  ON public.vehicles_of_interest(organization_id, upper(plate_number));

-- Backfill from observations, preferring freedom-camping zones where available.
WITH ranked_zone AS (
  SELECT
    v.id AS voi_id,
    o.zone_id,
    o.recorded_at,
    ROW_NUMBER() OVER (
      PARTITION BY v.id
      ORDER BY
        CASE
          WHEN lower(coalesce(z.zone_type, '')) IN (
            'freedom_camp',
            'freedom_camping',
            'freedom_camping_zone',
            'camping'
          ) THEN 0
          ELSE 1
        END,
        o.recorded_at DESC
    ) AS rn
  FROM public.vehicles_of_interest v
  JOIN public.observations o
    ON o.organization_id = v.organization_id
   AND upper(o.plate_number) = upper(v.plate_number)
  JOIN public.zones z
    ON z.id = o.zone_id
   AND z.organization_id = v.organization_id
  WHERE v.primary_zone_id IS NULL
    AND o.zone_id IS NOT NULL
),
selected_zone AS (
  SELECT voi_id, zone_id, recorded_at
  FROM ranked_zone
  WHERE rn = 1
)
UPDATE public.vehicles_of_interest v
SET
  primary_zone_id = s.zone_id,
  zone_last_observed_at = s.recorded_at
FROM selected_zone s
WHERE v.id = s.voi_id
  AND (v.primary_zone_id IS NULL OR v.zone_last_observed_at IS NULL);

COMMENT ON COLUMN public.vehicles_of_interest.primary_zone_id IS
  'Most relevant zone for the vehicle (derived from observations, preferring freedom-camping zones).';

COMMENT ON COLUMN public.vehicles_of_interest.zone_last_observed_at IS
  'Timestamp of the observation used to derive primary_zone_id.';
