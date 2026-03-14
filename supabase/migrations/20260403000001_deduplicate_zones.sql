-- ============================================================================
-- Migration: Deduplicate zones
-- Problem:   Multiple zones with the same (organization_id, name) exist,
--            causing duplicates to appear on the Zone Management page.
-- Solution:  1. Identify duplicate groups.
--            2. Keep the zone with the most observations (ties → oldest).
--            3. Re-point all FK references to the keeper.
--            4. Delete duplicate rows.
--            5. Add a partial unique index to prevent future duplicates.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1 & 2: Build a temp table of (keeper_id, duplicate_id) pairs.
--
-- Within each (organization_id, lower(trim(name))) group that has > 1 row,
-- rank zones by:  observation count DESC, created_at ASC, id ASC.
-- Rank-1 = keeper; all others are duplicates.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _zone_dups AS
WITH obs_counts AS (
  SELECT zone_id, COUNT(*) AS obs_cnt
  FROM   public.observations
  WHERE  zone_id IS NOT NULL
  GROUP  BY zone_id
),
ranked AS (
  SELECT
    z.id,
    z.organization_id,
    lower(trim(z.name))                                           AS norm_name,
    ROW_NUMBER() OVER (
      PARTITION BY z.organization_id, lower(trim(z.name))
      ORDER BY COALESCE(oc.obs_cnt, 0) DESC,
               z.created_at ASC,
               z.id ASC
    ) AS rn
  FROM   public.zones z
  LEFT   JOIN obs_counts oc ON oc.zone_id = z.id
  -- Exclude system-protected zones; "Other Location" has a BEFORE DELETE trigger
  -- that raises an exception and must never be treated as a duplicate.
  WHERE  lower(trim(z.name)) != 'other location'
)
SELECT
  keeper.id  AS keeper_id,
  dup.id     AS dup_id
FROM ranked dup
JOIN ranked keeper
  ON  keeper.organization_id = dup.organization_id
  AND keeper.norm_name       = dup.norm_name
  AND keeper.rn              = 1
WHERE dup.rn > 1;

-- If nothing to do, the rest is a no-op.

-- ---------------------------------------------------------------------------
-- Step 3: Re-point FK references from duplicate zone IDs to the keeper.
-- Each UPDATE is wrapped in a sub-block so a missing table/column
-- doesn't abort the whole migration.
-- ---------------------------------------------------------------------------

-- 3a. observations.zone_id
DO $$ BEGIN
  UPDATE public.observations o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3b. breach_alerts.zone_id
DO $$ BEGIN
  UPDATE public.breach_alerts o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3c. patrols.zone_id
DO $$ BEGIN
  UPDATE public.patrols o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3d. patrol_checkpoints.zone_id
DO $$ BEGIN
  UPDATE public.patrol_checkpoints o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3e. zone_compliance_matrix.zone_id
DO $$ BEGIN
  -- Delete duplicate matrix rows that would conflict, keep one per keeper
  DELETE FROM public.zone_compliance_matrix zcm
  USING  _zone_dups d
  WHERE  zcm.zone_id = d.dup_id
  AND    EXISTS (
    SELECT 1 FROM public.zone_compliance_matrix k
    WHERE  k.zone_id = d.keeper_id
  );

  -- Move any remaining (where keeper has none)
  UPDATE public.zone_compliance_matrix o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3f. enforcement_actions.zone_id
DO $$ BEGIN
  UPDATE public.enforcement_actions o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3g. health_safety_reports.zone_id
DO $$ BEGIN
  UPDATE public.health_safety_reports o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3h. incidents.zone_id
DO $$ BEGIN
  UPDATE public.incidents o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3i. compliance_results.zone_id
DO $$ BEGIN
  UPDATE public.compliance_results o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3j. investigation_jobs.zone_id
DO $$ BEGIN
  UPDATE public.investigation_jobs o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3k. drift_events.zone_id
DO $$ BEGIN
  UPDATE public.drift_events o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3l. plate_scans.zone_id
DO $$ BEGIN
  UPDATE public.plate_scans o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3m. zone_legal_config.zone_id
DO $$ BEGIN
  UPDATE public.zone_legal_config o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3n. notices_to_vacate.zone_id
DO $$ BEGIN
  UPDATE public.notices_to_vacate o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3o. person_observations.zone_id
DO $$ BEGIN
  UPDATE public.person_observations o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3p. infringement_notices.zone_id
DO $$ BEGIN
  UPDATE public.infringement_notices o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3q. vehicle_observations.zone_id
DO $$ BEGIN
  UPDATE public.vehicle_observations o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3r. vehicle_records.zone_id
DO $$ BEGIN
  UPDATE public.vehicle_records o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- 3s. zones.parent_zone_id (self-reference)
DO $$ BEGIN
  UPDATE public.zones z
  SET    parent_zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  z.parent_zone_id = d.dup_id;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

-- 3t. person_records.zone_id (legacy)
DO $$ BEGIN
  UPDATE public.person_records o
  SET    zone_id = d.keeper_id
  FROM   _zone_dups d
  WHERE  o.zone_id = d.dup_id;
EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Step 4: Delete the duplicate zone rows.
-- System-protected zones (e.g. "Other Location") are excluded from _zone_dups
-- above, but the extra filter here ensures the trigger cannot fire even if
-- the CTE logic were ever changed.
-- ---------------------------------------------------------------------------
DELETE FROM public.zones
WHERE  id IN (SELECT dup_id FROM _zone_dups)
AND    lower(trim(name)) != 'other location';

DROP TABLE _zone_dups;

-- ---------------------------------------------------------------------------
-- Step 5: Add a partial unique index on (organization_id, name) for active
--         zones to prevent future duplicates.
--         Using lower(trim(name)) for case/whitespace-insensitive matching.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_zones_unique_org_name_active
  ON public.zones (organization_id, lower(trim(name)))
  WHERE is_active = true;

COMMIT;
