-- ============================================================================
-- Backfill parent_zone_id for orphaned child zones
-- ============================================================================
-- Child zones (zone_type = 'specific') that are missing parent_zone_id
-- should be linked to the organisation's jurisdiction (general) zone.
-- This ensures the zone hierarchy is correctly maintained so that
-- zone recalculation and observation recording prefer child zones
-- over parent jurisdiction zones.
-- ============================================================================

-- For each child zone missing parent_zone_id, find the organisation's
-- jurisdiction zone (zone_type = 'general', parent_zone_id IS NULL)
-- and link them.
UPDATE public.zones AS child
SET    parent_zone_id = parent.id
FROM   public.zones AS parent
WHERE  child.zone_type     = 'specific'
  AND  child.parent_zone_id IS NULL
  AND  child.is_active     = true
  AND  parent.organization_id = child.organization_id
  AND  parent.zone_type    = 'general'
  AND  parent.parent_zone_id IS NULL
  AND  parent.is_active    = true
  -- If multiple general zones exist for the same org, pick the oldest
  AND  parent.id = (
    SELECT p2.id
    FROM   public.zones p2
    WHERE  p2.organization_id  = child.organization_id
      AND  p2.zone_type        = 'general'
      AND  p2.parent_zone_id   IS NULL
      AND  p2.is_active        = true
    ORDER  BY p2.created_at ASC
    LIMIT  1
  );
