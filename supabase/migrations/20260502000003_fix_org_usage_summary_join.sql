-- ─────────────────────────────────────────────────────────────────────────────
-- Fix get_org_usage_summary: join on observations.organization_id not obs.org_id
--
-- The original migration 20260424000002 used obs.org_id but the observations
-- table column is organization_id, causing the LEFT JOIN to never match and
-- returning 0 scans/breaches for every org.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_org_usage_summary(
  p_from TIMESTAMPTZ DEFAULT date_trunc('month', now()),
  p_to   TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  organization_id    UUID,
  organization_name  TEXT,
  is_active          BOOLEAN,
  officer_count      BIGINT,
  scan_count         BIGINT,
  breach_count       BIGINT,
  notice_count       BIGINT,
  infringement_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only grand_master can call this
  IF get_user_role(auth.uid()) != 'grand_master' THEN
    RAISE EXCEPTION 'Access denied: grand_master role required';
  END IF;

  RETURN QUERY
  SELECT
    o.id                                                                          AS organization_id,
    o.name                                                                        AS organization_name,
    o.is_active,
    COUNT(DISTINCT up.id) FILTER (WHERE up.role = 'officer' AND up.is_active = true) AS officer_count,
    COUNT(DISTINCT obs.observation_id)                                            AS scan_count,
    COUNT(DISTINCT obs.observation_id) FILTER (WHERE obs.is_compliant = false)   AS breach_count,
    COUNT(DISTINCT ntv.id)                                                        AS notice_count,
    COUNT(DISTINCT inf.id)                                                        AS infringement_count
  FROM organizations o
  LEFT JOIN user_profiles up
    ON up.organization_id = o.id
  LEFT JOIN observations obs
    ON obs.organization_id = o.id                        -- fixed: was obs.org_id
    AND obs.recorded_at BETWEEN p_from AND p_to
  LEFT JOIN notices_to_vacate ntv
    ON ntv.organization_id = o.id
    AND ntv.created_at BETWEEN p_from AND p_to
  LEFT JOIN infringement_notices inf
    ON inf.organization_id = o.id
    AND inf.created_at BETWEEN p_from AND p_to
  GROUP BY o.id, o.name, o.is_active
  ORDER BY scan_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_usage_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION public.get_org_usage_summary IS
  'Per-org usage metrics for grand_master billing and activity monitoring. Fixed join on observations.organization_id.';

NOTIFY pgrst, 'reload schema';
