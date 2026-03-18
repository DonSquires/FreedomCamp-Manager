-- ============================================================================
-- Align breach_alerts.created_at with original observation recorded_at
-- Date: 2026-03-18
--
-- Why:
--   Some breach alerts created during reingest used created_at = now(), which
--   made historical breaches appear as if they occurred on reingest day.
--
-- What this does:
--   1) Backfill breach_alerts.created_at from observations.recorded_at when an
--      observation link is available and timestamps differ.
--   2) Also backfill rows linked via breach_details.observation_id where the
--      direct FK column is null.
-- ============================================================================

BEGIN;

-- Backfill rows with direct observation_id linkage.
WITH linked AS (
  SELECT
    ba.id,
    o.recorded_at AS target_created_at
  FROM public.breach_alerts ba
  JOIN public.observations o
    ON o.observation_id = ba.observation_id
  WHERE o.recorded_at IS NOT NULL
    AND (
      ba.created_at IS NULL
      OR ABS(EXTRACT(EPOCH FROM (ba.created_at - o.recorded_at))) > 300
    )
)
UPDATE public.breach_alerts ba
SET created_at = linked.target_created_at
FROM linked
WHERE ba.id = linked.id;

-- Backfill rows linked only via breach_details.observation_id.
WITH linked_via_details AS (
  SELECT
    ba.id,
    o.recorded_at AS target_created_at
  FROM public.breach_alerts ba
  JOIN public.observations o
    ON o.observation_id::text = (ba.breach_details ->> 'observation_id')
  WHERE ba.observation_id IS NULL
    AND o.recorded_at IS NOT NULL
    AND (
      ba.created_at IS NULL
      OR ABS(EXTRACT(EPOCH FROM (ba.created_at - o.recorded_at))) > 300
    )
)
UPDATE public.breach_alerts ba
SET created_at = linked_via_details.target_created_at
FROM linked_via_details
WHERE ba.id = linked_via_details.id;

COMMIT;
