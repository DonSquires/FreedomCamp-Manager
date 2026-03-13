-- ============================================================================
-- Fix get_zone_compliance_breakdown: use observation_id (NOT NULL PK) instead
-- of the nullable id column for COUNT aggregations.
--
-- The observations table has observation_id as the NOT NULL primary key and id
-- as a nullable secondary column.  COUNT(obs.id) silently undercounts rows
-- where id IS NULL.  All counts must use observation_id.
-- ============================================================================

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
  compliance_pct          NUMERIC    -- e.g. 96 for 96%
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
    )                                                                                  AS compliance_pct
  FROM zones z
  LEFT JOIN organizations org ON org.id = z.organization_id
  LEFT JOIN observations obs
    ON obs.zone_id = z.id
    AND obs.recorded_at BETWEEN p_start AND p_end
  WHERE (p_organization_id IS NULL OR z.organization_id = p_organization_id)
  GROUP BY
    z.id, z.name, org.name,
    z.is_active, z.nights_per_month, z.max_consecutive_nights,
    z.self_contained_required, z.day_visit_only
  ORDER BY breach_count DESC, obs_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_zone_compliance_breakdown TO authenticated;
COMMENT ON FUNCTION public.get_zone_compliance_breakdown IS
  'Returns per-zone compliance stats for CompliancePage ZonesTab. '
  'Uses observation_id (NOT NULL PK) for all COUNT aggregations. '
  'Replaces client-side GROUP BY aggregation — no 1000-row client limit.';

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');
