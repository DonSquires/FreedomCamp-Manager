-- ============================================================================
-- Create missing utility RPCs
-- Date: 2026-04-18
--
-- These functions are referenced in the frontend
-- (OrganizationBoundaryEditor.tsx, SpatialComplianceMap.tsx,
--  DataCleanupUtility.tsx, lib/testUtils.ts) but had no migration file.
-- They may already exist on some DB instances from direct SQL execution;
-- CREATE OR REPLACE makes this safe to re-run in either case.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. set_org_geometry
--    Called by OrganizationBoundaryEditor to persist a GeoJSON polygon as the
--    org boundary.  Requires PostGIS.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_org_geometry(
  org_id  UUID,
  geojson JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_geom geometry;
BEGIN
  BEGIN
    v_geom := ST_SetSRID(
                ST_GeomFromGeoJSON(geojson::text),
                4326
              );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid GeoJSON: %', SQLERRM;
  END;

  UPDATE public.organizations
  SET    boundary          = v_geom,
         updated_at        = now()
  WHERE  id                = org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization % not found', org_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_org_geometry(UUID, JSONB) TO authenticated;

COMMENT ON FUNCTION public.set_org_geometry IS
  'Persist a GeoJSON polygon as the org boundary geometry (PostGIS).';

-- ---------------------------------------------------------------------------
-- 2. check_compliance
--    Called by SpatialComplianceMap to check whether a plate is compliant
--    in a given zone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_compliance(
  p_plate_number TEXT,
  p_zone_id      UUID,
  p_recorded_at  TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone_rules   RECORD;
  v_nights_this_month INTEGER := 0;
  v_consecutive_nights INTEGER := 0;
  v_month_start  TIMESTAMPTZ;
  v_result       JSONB;
BEGIN
  -- Get zone compliance rules
  SELECT
    z.id               AS zone_id,
    z.name             AS zone_name,
    cr.max_stay_nights,
    cr.max_consecutive_nights,
    cr.self_contained_required,
    cr.day_visit_only
  INTO v_zone_rules
  FROM   public.zones z
  LEFT JOIN public.compliance_rules cr ON cr.zone_id = z.id AND cr.is_active = TRUE
  WHERE  z.id = p_zone_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_compliant', TRUE, 'reason', 'Zone not found');
  END IF;

  -- Day-visit-only shortcut
  IF v_zone_rules.day_visit_only THEN
    RETURN jsonb_build_object(
      'is_compliant', FALSE,
      'breach_type', 'day_visit_violation',
      'reason', 'Day-visit-only zone'
    );
  END IF;

  -- Count nights stayed this calendar month
  v_month_start := date_trunc('month', p_recorded_at AT TIME ZONE 'Pacific/Auckland')
                     AT TIME ZONE 'Pacific/Auckland';

  SELECT COUNT(DISTINCT (recorded_at AT TIME ZONE 'Pacific/Auckland')::date)
  INTO   v_nights_this_month
  FROM   public.observations
  WHERE  plate_number  = p_plate_number
    AND  zone_id       = p_zone_id
    AND  recorded_at  >= v_month_start
    AND  recorded_at  <= p_recorded_at;

  -- Monthly limit check
  IF v_zone_rules.max_stay_nights IS NOT NULL
     AND v_nights_this_month >= v_zone_rules.max_stay_nights THEN
    RETURN jsonb_build_object(
      'is_compliant', FALSE,
      'breach_type', 'monthly_limit',
      'nights_this_month', v_nights_this_month,
      'max_stay_nights', v_zone_rules.max_stay_nights
    );
  END IF;

  -- Consecutive nights check
  IF v_zone_rules.max_consecutive_nights IS NOT NULL THEN
    WITH daily AS (
      SELECT DISTINCT (recorded_at AT TIME ZONE 'Pacific/Auckland')::date AS d
      FROM   public.observations
      WHERE  plate_number = p_plate_number
        AND  zone_id      = p_zone_id
        AND  recorded_at <= p_recorded_at
      ORDER  BY d DESC
      LIMIT  (v_zone_rules.max_consecutive_nights + 1)
    ),
    streak AS (
      SELECT d,
             d - ROW_NUMBER() OVER (ORDER BY d)::integer AS grp
      FROM   daily
    )
    SELECT COALESCE(MAX(cnt), 0)
    INTO   v_consecutive_nights
    FROM  (
      SELECT COUNT(*) AS cnt
      FROM   streak
      GROUP  BY grp
    ) s;

    IF v_consecutive_nights >= v_zone_rules.max_consecutive_nights THEN
      RETURN jsonb_build_object(
        'is_compliant', FALSE,
        'breach_type', 'consecutive_nights',
        'consecutive_nights', v_consecutive_nights,
        'max_consecutive_nights', v_zone_rules.max_consecutive_nights
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('is_compliant', TRUE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_compliance(TEXT, UUID, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION public.check_compliance IS
  'Returns a JSONB compliance result for a plate/zone pair at a given timestamp.';

-- ---------------------------------------------------------------------------
-- 3. get_duplicate_observations
--    Returns groups of duplicate observations (same plate + zone + date)
--    used by DataCleanupUtility and lib/testUtils.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_duplicate_observations(
  p_organization_id UUID  DEFAULT NULL,
  p_limit           INT   DEFAULT 100
)
RETURNS TABLE (
  plate_number     TEXT,
  zone_id          UUID,
  zone_name        TEXT,
  observation_ids  UUID[],
  count            BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.plate_number,
    o.zone_id,
    z.name   AS zone_name,
    array_agg(o.observation_id ORDER BY o.recorded_at DESC) AS observation_ids,
    COUNT(*) AS count
  FROM public.observations o
  LEFT JOIN public.zones z ON z.id = o.zone_id
  WHERE (p_organization_id IS NULL OR o.organization_id = p_organization_id)
    AND o.plate_number IS NOT NULL
    AND o.zone_id IS NOT NULL
  GROUP BY
    o.plate_number,
    o.zone_id,
    z.name,
    (o.recorded_at AT TIME ZONE 'Pacific/Auckland')::date
  HAVING COUNT(*) > 1
  ORDER BY count DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_duplicate_observations(UUID, INT) TO authenticated;

COMMENT ON FUNCTION public.get_duplicate_observations IS
  'Returns groups of duplicate observations (same plate + zone + NZ date).';

-- ---------------------------------------------------------------------------
-- 4. check_duplicate_observations
--    Scalar summary used by lib/testUtils (no args).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_duplicate_observations()
RETURNS TABLE (
  plate_number     TEXT,
  zone_id          UUID,
  observation_ids  UUID[],
  count            BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.plate_number,
    o.zone_id,
    array_agg(o.observation_id ORDER BY o.recorded_at DESC),
    COUNT(*)
  FROM public.observations o
  WHERE o.plate_number IS NOT NULL
    AND o.zone_id IS NOT NULL
  GROUP BY
    o.plate_number,
    o.zone_id,
    (o.recorded_at AT TIME ZONE 'Pacific/Auckland')::date
  HAVING COUNT(*) > 1
  ORDER BY COUNT(*) DESC
  LIMIT 200;
$$;

GRANT EXECUTE ON FUNCTION public.check_duplicate_observations() TO authenticated;

COMMENT ON FUNCTION public.check_duplicate_observations IS
  'Returns duplicate observation groups (no-arg variant used by testUtils).';
