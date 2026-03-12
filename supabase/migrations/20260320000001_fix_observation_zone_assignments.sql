-- ============================================================================
-- Correct zone_id + organization_id on already-imported observations
-- Date: 2026-03-20
--
-- Background
-- ----------
-- import-historical-data previously searched for zones ONLY within the
-- importer's targetOrganizationId.  When the correct zones already existed
-- under a different council org (e.g. "Queenstown-Lakes District Council"),
-- the search missed them and created duplicate zones under the importer's org
-- (e.g. "First Security").  Result: every imported observation now has
--   zone_id         → auto-created zone in the WRONG org
--   organization_id → the WRONG org
-- so RLS hides the data from the officers who should see it.
--
-- What this migration does
-- ------------------------
-- For every active observation:
--   1. Look up the zone name via observations.zone_id → zones.name.
--   2. Find the single BEST zone with that name across ALL organisations
--      using the priority:
--        a. Prefer zones NOT auto-created by import (description doesn't
--           contain 'Auto-created from historical import').
--        b. Prefer zones with needs_admin_review = false (admin-confirmed).
--        c. Prefer the oldest zone (most established / canonical).
--        d. Tie-break deterministically by zone id.
--   3. If the best zone differs from the current one, UPDATE both
--      observations.zone_id and observations.organization_id.
--   4. Deactivate orphaned auto-created import zones that have been superseded.
--   5. Add missing schema columns (zone_type, parent_zone_id,
--      needs_admin_review, zone_name_at_import) used by the import pipeline.
-- ============================================================================

-- ── 0. Add missing schema columns ────────────────────────────────────────────

-- Zones: columns referenced by import-historical-data but never added to schema
ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS zone_type          TEXT    DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS parent_zone_id     UUID    REFERENCES public.zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS needs_admin_review BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.zones.zone_type          IS 'Classification: general, enforcement, other_location, suggested';
COMMENT ON COLUMN public.zones.parent_zone_id     IS 'Parent zone for hierarchical structures';
COMMENT ON COLUMN public.zones.needs_admin_review  IS 'TRUE when auto-created by import; admin should confirm compliance rules';

-- Observations: store the original zone text from the Excel file so we can
-- always re-derive the correct zone even after zones are reorganised.
ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS zone_name_at_import TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.observations.zone_name_at_import IS
  'Zone name exactly as it appeared in the Excel import file (Column B). '
  'Used to re-resolve zone_id if zones are later reorganised.';

COMMENT ON COLUMN public.observations.deleted_at IS
  'Soft-delete timestamp. NULL means active row.';

-- ── 1. Pre-flight diagnostic ─────────────────────────────────────────────────

DO $$
DECLARE
  v_total             bigint;
  v_no_zone           bigint;
  v_org_zone_mismatch bigint;
  v_auto_zones        bigint;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM   public.observations
  WHERE  deleted_at IS NULL;

  SELECT COUNT(*) INTO v_no_zone
  FROM   public.observations
  WHERE  deleted_at IS NULL AND zone_id IS NULL;

  SELECT COUNT(*) INTO v_org_zone_mismatch
  FROM   public.observations o
  JOIN   public.zones z ON z.id = o.zone_id
  WHERE  o.deleted_at IS NULL
    AND  o.organization_id != z.organization_id;

  SELECT COUNT(*) INTO v_auto_zones
  FROM   public.zones
  WHERE  is_active = true
    AND  COALESCE(description, '') ILIKE '%Auto-created from historical import%';

  RAISE NOTICE '══════════════════════════════════════════════════════';
  RAISE NOTICE 'PRE-FLIGHT  –  Observation Zone Correction';
  RAISE NOTICE '══════════════════════════════════════════════════════';
  RAISE NOTICE '  Active observations total:             %', v_total;
  RAISE NOTICE '  Observations with NULL zone_id:        %', v_no_zone;
  RAISE NOTICE '  Obs where org ≠ zone.org_id (wrong):   %', v_org_zone_mismatch;
  RAISE NOTICE '  Active auto-created import zones:      %', v_auto_zones;
  RAISE NOTICE '══════════════════════════════════════════════════════';
END;
$$;

-- ── 2. Backfill zone_name_at_import from current zone name ───────────────────
-- For rows imported before this column existed, populate it from the zones
-- table (the zone name in the DB is the same text that was in the Excel file).

UPDATE public.observations o
SET    zone_name_at_import = z.name
FROM   public.zones z
WHERE  z.id = o.zone_id
  AND  o.zone_name_at_import IS NULL
  AND  o.deleted_at IS NULL;

-- ── 3. Build best-zone lookup (one row per distinct normalised zone name) ─────
--
-- We use a CTE inside the UPDATE so there are no temp-table scope issues.

WITH
-- Step A: for every distinct zone name that appears in active observations,
--         find the single best canonical zone across ALL organisations.
best_zone AS (
  SELECT DISTINCT ON (lower(trim(z_all.name)))
    lower(trim(z_all.name))  AS norm_name,
    z_all.id                 AS best_zone_id,
    z_all.organization_id    AS best_org_id
  FROM   public.zones z_all
  WHERE  z_all.is_active = true
    AND  lower(trim(z_all.name)) IN (
           -- Only consider names that actually appear in observations
           SELECT lower(trim(z2.name))
           FROM   public.observations o2
           JOIN   public.zones z2 ON z2.id = o2.zone_id
           WHERE  o2.deleted_at IS NULL
         )
  ORDER BY
    lower(trim(z_all.name)),
    -- Prefer admin-created (non-import) zones
    (CASE WHEN COALESCE(z_all.description,'') ILIKE '%Auto-created from historical import%'
          THEN 1 ELSE 0 END),
    -- Prefer zones already confirmed by an admin
    (CASE WHEN COALESCE(z_all.needs_admin_review, false) THEN 1 ELSE 0 END),
    -- Oldest zone wins (most established)
    z_all.created_at ASC,
    z_all.id          ASC   -- deterministic tie-break
),

-- Step B: identify every observation row that needs changing
to_update AS (
  SELECT
    o.ctid              AS obs_tid,
    bz.best_zone_id     AS new_zone_id,
    bz.best_org_id      AS new_org_id
  FROM   public.observations o
  JOIN   public.zones z_cur ON z_cur.id = o.zone_id
  JOIN   best_zone bz       ON bz.norm_name = lower(trim(z_cur.name))
  WHERE  o.deleted_at IS NULL
    AND  (o.zone_id != bz.best_zone_id OR o.organization_id != bz.best_org_id)
)

-- Step C: apply the fix
UPDATE public.observations o
SET
  zone_id         = upd.new_zone_id,
  organization_id = upd.new_org_id,
  updated_at      = now()
FROM to_update upd
WHERE o.ctid = upd.obs_tid;

-- ── 4. Deactivate superseded auto-created import zones ───────────────────────
-- A zone is superseded when a DIFFERENT active zone now has the same name
-- AND was not auto-created.

UPDATE public.zones z_auto
SET
  is_active   = false,
  description = COALESCE(description, '') ||
                E'\n[Superseded: replaced by canonical zone during 20260320 zone-fix migration]'
WHERE z_auto.is_active = true
  AND COALESCE(z_auto.description, '') ILIKE '%Auto-created from historical import%'
  AND EXISTS (
    SELECT 1
    FROM   public.zones z_canon
    WHERE  lower(trim(z_canon.name)) = lower(trim(z_auto.name))
      AND  z_canon.id               != z_auto.id
      AND  z_canon.is_active         = true
      AND  COALESCE(z_canon.description, '') NOT ILIKE '%Auto-created from historical import%'
  );

-- ── 5. Audit / preview view (self-contained – no temp table dependency) ──────
--
-- After running this migration, query:
--   SELECT * FROM public.v_observation_zone_audit ORDER BY zone_changed DESC;
-- to see what was changed.

CREATE OR REPLACE VIEW public.v_observation_zone_audit AS
WITH best_zone AS (
  SELECT DISTINCT ON (lower(trim(z_all.name)))
    lower(trim(z_all.name))  AS norm_name,
    z_all.id                 AS best_zone_id,
    z_all.organization_id    AS best_org_id,
    z_all.name               AS best_zone_name
  FROM   public.zones z_all
  WHERE  z_all.is_active = true
  ORDER BY
    lower(trim(z_all.name)),
    (CASE WHEN COALESCE(z_all.description,'') ILIKE '%Auto-created from historical import%' THEN 1 ELSE 0 END),
    (CASE WHEN COALESCE(z_all.needs_admin_review, false) THEN 1 ELSE 0 END),
    z_all.created_at ASC,
    z_all.id ASC
)
SELECT
  o.ctid::text                                      AS observation_id,
  o.plate_number,
  o.recorded_at::date                               AS observed_date,
  o.zone_name_at_import,
  z_cur.name                                        AS current_zone_name,
  o.zone_id                                         AS current_zone_id,
  o.organization_id                                 AS current_org_id,
  cur_org.name                                      AS current_org_name,
  bz.best_zone_name                                 AS canonical_zone_name,
  bz.best_zone_id                                   AS canonical_zone_id,
  bz.best_org_id                                    AS canonical_org_id,
  canon_org.name                                    AS canonical_org_name,
  (o.zone_id = bz.best_zone_id
   AND o.organization_id = bz.best_org_id)          AS is_correctly_assigned,
  o.is_legacy_import,
  o.legacy_source_tag
FROM   public.observations o
JOIN   public.zones z_cur      ON z_cur.id = o.zone_id
JOIN   best_zone bz            ON bz.norm_name = lower(trim(z_cur.name))
LEFT JOIN public.organizations cur_org   ON cur_org.id   = o.organization_id
LEFT JOIN public.organizations canon_org ON canon_org.id = bz.best_org_id
WHERE  o.deleted_at IS NULL
ORDER BY is_correctly_assigned ASC, o.recorded_at DESC;

COMMENT ON VIEW public.v_observation_zone_audit IS
  'Shows the canonical zone assignment for every active observation. '
  'is_correctly_assigned=false rows still need correction '
  '(e.g. the canonical zone was not found because no non-import zone exists with that name). '
  'Re-run the UPDATE block in 20260320_fix_observation_zone_assignments.sql after '
  'creating the correct zones manually for any remaining unmatched names.';

-- ── 6. Post-flight summary ────────────────────────────────────────────────────

DO $$
DECLARE
  v_still_wrong  bigint;
  v_now_correct  bigint;
  v_deactivated  bigint;
BEGIN
  SELECT COUNT(*) INTO v_still_wrong
  FROM   public.observations o
  JOIN   public.zones z ON z.id = o.zone_id
  WHERE  o.deleted_at IS NULL
    AND  o.organization_id != z.organization_id;

  SELECT COUNT(*) INTO v_now_correct
  FROM   public.observations o
  JOIN   public.zones z ON z.id = o.zone_id
  WHERE  o.deleted_at IS NULL
    AND  o.organization_id = z.organization_id;

  SELECT COUNT(*) INTO v_deactivated
  FROM   public.zones
  WHERE  is_active  = false
    AND  description ILIKE '%Superseded%zone-fix migration%';

  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════';
  RAISE NOTICE 'POST-FIX SUMMARY';
  RAISE NOTICE '══════════════════════════════════════════════════════';
  RAISE NOTICE '  Observations now correctly assigned:   %', v_now_correct;
  RAISE NOTICE '  Observations still on wrong org:       %', v_still_wrong;
  IF v_still_wrong > 0 THEN
    RAISE NOTICE '  ⚠️  Remaining mismatches = only auto-created zones exist';
    RAISE NOTICE '     for those zone names.  Create canonical zones manually,';
    RAISE NOTICE '     then re-run the UPDATE block.';
  END IF;
  RAISE NOTICE '  Orphaned auto-created zones deactivated: %', v_deactivated;
  RAISE NOTICE '';
  RAISE NOTICE '  Audit query:';
  RAISE NOTICE '    SELECT * FROM v_observation_zone_audit';
  RAISE NOTICE '    WHERE is_correctly_assigned = false;';
  RAISE NOTICE '';
  RAISE NOTICE '  After verifying, run recalculate-compliance to refresh';
  RAISE NOTICE '  is_compliant / breach fields for the corrected observations.';
  RAISE NOTICE '══════════════════════════════════════════════════════';
END;
$$;
