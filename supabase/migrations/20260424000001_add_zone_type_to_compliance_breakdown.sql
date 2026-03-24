-- ============================================================================
-- Add zone_type and parent_zone_id to get_zone_compliance_breakdown return type
-- so the frontend can separate jurisdiction-level zones from specific zones.
--
-- The Jurisdiction tab should only show zones where parent_zone_id IS NULL
-- (i.e. top-level jurisdiction zones), while "By Zone" shows child zones.
-- ============================================================================

-- DROP first: PostgreSQL does not allow CREATE OR REPLACE to change a
-- function's return type, and this migration adds zone_type + parent_zone_id
-- to the RETURNS TABLE, which is a breaking change to the row-type signature.
DROP FUNCTION IF EXISTS public.get_zone_compliance_breakdown(TIMESTAMPTZ, TIMESTAMPTZ, UUID);

CREATE OR REPLACE FUNCTION public.get_zone_compliance_breakdown(
  p_start            TIMESTAMPTZ,
  p_end              TIMESTAMPTZ,
  p_organization_id  UUID DEFAULT NULL
)
RETURNS TABLE (
  zone_id                 UUID,
  zone_name               TEXT,
  organization_name       TEXT,
  is_active               BOOLEAN,
  nights_per_month        INTEGER,
  max_consecutive_nights  INTEGER,
  self_contained_required BOOLEAN,
  day_visit_only          BOOLEAN,
  obs_count               BIGINT,
  breach_count            BIGINT,
  compliance_pct          NUMERIC,
  zone_type               TEXT,
  parent_zone_id          UUID
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    z.id                      AS zone_id,
    z.name                    AS zone_name,
    org.name                  AS organization_name,
    z.is_active,
    z.nights_per_month,
    z.max_consecutive_nights,
    z.self_contained_required,
    z.day_visit_only,
    COUNT(obs.observation_id)                                                          AS obs_count,
    COUNT(obs.observation_id) FILTER (WHERE obs.is_compliant = FALSE)                 AS breach_count,
    COALESCE(
      ROUND(
        100.0 * COUNT(obs.observation_id) FILTER (WHERE obs.is_compliant = TRUE)
        / NULLIF(COUNT(obs.observation_id), 0)
      ),
      100
    )                                                                                  AS compliance_pct,
    z.zone_type,
    z.parent_zone_id
  FROM zones z
  LEFT JOIN organizations org ON org.id = z.organization_id
  LEFT JOIN observations obs
    ON obs.zone_id = z.id
    AND obs.recorded_at BETWEEN p_start AND p_end
  WHERE (p_organization_id IS NULL OR z.organization_id = p_organization_id)
  GROUP BY
    z.id, z.name, org.name,
    z.is_active, z.nights_per_month, z.max_consecutive_nights,
    z.self_contained_required, z.day_visit_only,
    z.zone_type, z.parent_zone_id
  ORDER BY breach_count DESC, obs_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_zone_compliance_breakdown TO authenticated;
COMMENT ON FUNCTION public.get_zone_compliance_breakdown IS
  'Returns per-zone compliance stats for CompliancePage ZonesTab and JurisdictionTab. '
  'Includes zone_type and parent_zone_id so the frontend can filter jurisdiction vs specific zones. '
  'Uses observation_id (NOT NULL PK) for all COUNT aggregations.';

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');
