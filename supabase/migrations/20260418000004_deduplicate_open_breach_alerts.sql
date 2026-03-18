-- ============================================================================
-- Deduplicate unresolved breach_alerts by observation linkage
-- Date: 2026-04-18
--
-- Why:
--   Historical recalculation runs created multiple unresolved alerts for the
--   same observation. This inflated Active Breaches KPIs.
--
-- What this does:
--   - Finds unresolved alerts (pending / acknowledged / enforcement_started)
--     that point to the same observation (via observation_id or
--     breach_details->>'observation_id').
--   - Keeps the newest unresolved alert in each duplicate group.
--   - Marks older unresolved alerts as dismissed with an audit note.
--
-- Safety:
--   - Does not delete rows.
--   - Does not touch already resolved/dismissed alerts.
-- ============================================================================

BEGIN;

WITH unresolved AS (
  SELECT
    ba.id,
    ba.organization_id,
    COALESCE(ba.observation_id::text, ba.breach_details ->> 'observation_id') AS observation_key,
    ba.created_at,
    ba.updated_at
  FROM public.breach_alerts ba
  WHERE ba.status IN ('pending', 'acknowledged', 'enforcement_started')
),
ranked AS (
  SELECT
    u.id,
    u.organization_id,
    u.observation_key,
    ROW_NUMBER() OVER (
      PARTITION BY u.organization_id, u.observation_key
      ORDER BY
        COALESCE(u.created_at, u.updated_at, now()) DESC,
        u.updated_at DESC NULLS LAST,
        u.id DESC
    ) AS row_num,
    COUNT(*) OVER (
      PARTITION BY u.organization_id, u.observation_key
    ) AS group_size
  FROM unresolved u
  WHERE u.observation_key IS NOT NULL
    AND u.observation_key <> ''
),
to_dismiss AS (
  SELECT r.id
  FROM ranked r
  WHERE r.group_size > 1
    AND r.row_num > 1
)
UPDATE public.breach_alerts ba
SET
  status = 'dismissed',
  resolved_at = COALESCE(ba.resolved_at, now()),
  resolution_notes = CASE
    WHEN ba.resolution_notes IS NULL OR btrim(ba.resolution_notes) = ''
      THEN 'Auto-dismissed by migration 20260418000004: duplicate unresolved breach for same observation.'
    ELSE ba.resolution_notes || E'\n\n' ||
      'Auto-dismissed by migration 20260418000004: duplicate unresolved breach for same observation.'
  END,
  updated_at = now()
WHERE ba.id IN (SELECT id FROM to_dismiss);

DO $$
DECLARE
  v_remaining_unresolved bigint := 0;
  v_remaining_duplicate_groups bigint := 0;
BEGIN
  SELECT COUNT(*)
    INTO v_remaining_unresolved
  FROM public.breach_alerts
  WHERE status IN ('pending', 'acknowledged', 'enforcement_started');

  WITH unresolved AS (
    SELECT
      organization_id,
      COALESCE(observation_id::text, breach_details ->> 'observation_id') AS observation_key
    FROM public.breach_alerts
    WHERE status IN ('pending', 'acknowledged', 'enforcement_started')
  )
  SELECT COUNT(*)
    INTO v_remaining_duplicate_groups
  FROM (
    SELECT organization_id, observation_key
    FROM unresolved
    WHERE observation_key IS NOT NULL
      AND observation_key <> ''
    GROUP BY organization_id, observation_key
    HAVING COUNT(*) > 1
  ) s;

  RAISE NOTICE 'Remaining unresolved breach_alerts: %', v_remaining_unresolved;
  RAISE NOTICE 'Remaining duplicate unresolved observation groups: %', v_remaining_duplicate_groups;
END
$$;

COMMIT;
