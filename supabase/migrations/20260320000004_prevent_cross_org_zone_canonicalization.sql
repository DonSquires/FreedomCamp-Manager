-- ============================================================================
-- Prevent cross-organisation zone canonicalisation
-- Date: 2026-03-20
--
-- Why:
--   Earlier audit / reassignment logic matched zones by normalised zone name
--   across ALL organisations. Generic names such as "Jurisdiction" therefore
--   resolved to whichever organisation's zone ranked best globally, which could
--   make Nelson or Downer/LINZ observations appear to belong to councils the
--   system has never operated in.
--
-- Fix:
--   1) Rebuild reassign_observations_to_current_zones() so it only resolves
--      replacement zones within the observation's current organisation.
--   2) Rebuild v_observation_zone_audit so its canonical_* fields are also
--      organisation-scoped and never suggest cross-org moves.
--
-- Outcome:
--   Generic zone names can still exist in multiple organisations, but audit and
--   repair workflows will not move or suggest moving observations across org
--   boundaries unless a human does so explicitly.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reassign_observations_to_current_zones(
  p_apply boolean DEFAULT false,
  p_legacy_only boolean DEFAULT true,
  p_limit integer DEFAULT NULL,
  p_update_recorded_by boolean DEFAULT false,
  p_recorded_by uuid DEFAULT NULL
)
RETURNS TABLE (
  scanned bigint,
  candidates bigint,
  updatable bigint,
  updated bigint,
  unresolved bigint,
  cross_org_moves bigint,
  recorded_by_updates bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scanned bigint := 0;
  v_candidates bigint := 0;
  v_updatable bigint := 0;
  v_updated bigint := 0;
  v_unresolved bigint := 0;
  v_cross_org_moves bigint := 0;
  v_recorded_by_updates bigint := 0;
  v_recorded_by_exists boolean := false;
BEGIN
  IF p_update_recorded_by THEN
    IF p_recorded_by IS NULL THEN
      RAISE EXCEPTION 'p_recorded_by must be provided when p_update_recorded_by=true';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = p_recorded_by
    )
    INTO v_recorded_by_exists;

    IF NOT v_recorded_by_exists THEN
      RAISE EXCEPTION 'p_recorded_by % does not exist in public.user_profiles', p_recorded_by;
    END IF;
  END IF;

  UPDATE public.observations o
  SET zone_name_at_import = z.name
  FROM public.zones z
  WHERE z.id = o.zone_id
    AND o.deleted_at IS NULL
    AND o.zone_name_at_import IS NULL
    AND (NOT p_legacy_only OR COALESCE(o.is_legacy_import, false) = true);

  WITH scope_rows AS (
    SELECT
      o.id,
      o.zone_id,
      o.organization_id,
      lower(trim(COALESCE(NULLIF(o.zone_name_at_import, ''), z_cur.name))) AS norm_zone_name
    FROM public.observations o
    LEFT JOIN public.zones z_cur ON z_cur.id = o.zone_id
    WHERE o.deleted_at IS NULL
      AND (NOT p_legacy_only OR COALESCE(o.is_legacy_import, false) = true)
    ORDER BY o.recorded_at, o.id
    LIMIT COALESCE(p_limit, 2147483647)
  ),
  matched AS (
    SELECT
      s.id,
      s.zone_id AS old_zone_id,
      s.organization_id AS old_org_id,
      s.norm_zone_name,
      bz.id AS new_zone_id,
      bz.organization_id AS new_org_id
    FROM scope_rows s
    LEFT JOIN LATERAL (
      SELECT
        z.id,
        z.organization_id,
        z.created_at,
        z.description,
        z.needs_admin_review
      FROM public.zones z
      WHERE z.is_active = true
        AND z.organization_id = s.organization_id
        AND lower(trim(z.name)) = s.norm_zone_name
      ORDER BY
        CASE WHEN COALESCE(z.description, '') ILIKE '%Auto-created from historical import%' THEN 1 ELSE 0 END,
        CASE WHEN COALESCE(z.needs_admin_review, false) THEN 1 ELSE 0 END,
        z.created_at ASC,
        z.id ASC
      LIMIT 1
    ) bz ON true
  ),
  to_update AS (
    SELECT
      m.id,
      m.old_zone_id,
      m.old_org_id,
      m.new_zone_id,
      m.new_org_id,
      o.recorded_by AS old_recorded_by,
      CASE
        WHEN p_update_recorded_by THEN p_recorded_by
        ELSE o.recorded_by
      END AS new_recorded_by
    FROM matched m
    JOIN public.observations o ON o.id = m.id
    WHERE m.new_zone_id IS NOT NULL
      AND (
        m.old_zone_id IS DISTINCT FROM m.new_zone_id
        OR (p_update_recorded_by AND o.recorded_by IS DISTINCT FROM p_recorded_by)
      )
  ),
  applied AS (
    UPDATE public.observations o
    SET
      zone_id = u.new_zone_id,
      organization_id = u.old_org_id,
      recorded_by = u.new_recorded_by,
      updated_at = now()
    FROM to_update u
    WHERE p_apply = true
      AND o.id = u.id
    RETURNING o.id
  )
  SELECT
    (SELECT COUNT(*) FROM scope_rows),
    (SELECT COUNT(*) FROM matched WHERE norm_zone_name IS NOT NULL),
    (SELECT COUNT(*) FROM to_update),
    (SELECT COUNT(*) FROM applied),
    (SELECT COUNT(*) FROM matched WHERE norm_zone_name IS NULL OR new_zone_id IS NULL),
    0,
    (SELECT COUNT(*) FROM to_update WHERE old_recorded_by IS DISTINCT FROM new_recorded_by)
  INTO
    v_scanned,
    v_candidates,
    v_updatable,
    v_updated,
    v_unresolved,
    v_cross_org_moves,
    v_recorded_by_updates;

  RETURN QUERY
  SELECT
    v_scanned,
    v_candidates,
    v_updatable,
    v_updated,
    v_unresolved,
    v_cross_org_moves,
    v_recorded_by_updates;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reassign_observations_to_current_zones(boolean, boolean, integer, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_observations_to_current_zones(boolean, boolean, integer, boolean, uuid) TO service_role;

COMMENT ON FUNCTION public.reassign_observations_to_current_zones(boolean, boolean, integer, boolean, uuid) IS
  'Safely reassigns observations to best active zones by normalized zone name within the same organization only; dry-run via p_apply=false. Defaults to legacy-import rows only. Can optionally rewrite recorded_by when explicitly enabled.';

CREATE OR REPLACE VIEW public.v_observation_zone_audit AS
WITH best_zone AS (
  SELECT DISTINCT ON (o.id)
    o.id AS observation_row_id,
    z_all.id AS best_zone_id,
    z_all.organization_id AS best_org_id,
    z_all.name AS best_zone_name
  FROM public.observations o
  JOIN public.zones z_cur ON z_cur.id = o.zone_id
  LEFT JOIN public.zones z_all
    ON z_all.is_active = true
   AND z_all.organization_id = o.organization_id
   AND lower(trim(z_all.name)) = lower(trim(COALESCE(NULLIF(o.zone_name_at_import, ''), z_cur.name)))
  WHERE o.deleted_at IS NULL
  ORDER BY
    o.id,
    CASE WHEN COALESCE(z_all.description, '') ILIKE '%Auto-created from historical import%' THEN 1 ELSE 0 END,
    CASE WHEN COALESCE(z_all.needs_admin_review, false) THEN 1 ELSE 0 END,
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
  (
    bz.best_zone_id IS NOT NULL
    AND o.zone_id = bz.best_zone_id
    AND o.organization_id = bz.best_org_id
  )                                                 AS is_correctly_assigned,
  o.is_legacy_import,
  o.legacy_source_tag
FROM public.observations o
JOIN public.zones z_cur ON z_cur.id = o.zone_id
LEFT JOIN best_zone bz ON bz.observation_row_id = o.id
LEFT JOIN public.organizations cur_org ON cur_org.id = o.organization_id
LEFT JOIN public.organizations canon_org ON canon_org.id = bz.best_org_id
WHERE o.deleted_at IS NULL
ORDER BY is_correctly_assigned ASC, o.recorded_at DESC;

COMMENT ON VIEW public.v_observation_zone_audit IS
  'Shows the best same-organization zone assignment for every active observation. canonical_* values are organization-scoped only; cross-organization canonicalization is intentionally disabled.';

COMMIT;
