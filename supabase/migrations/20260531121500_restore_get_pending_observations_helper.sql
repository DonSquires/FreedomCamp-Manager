-- Restore queue helper function expected by operational scripts and diagnostics.
--
-- Why:
-- - docs/INSTRUCTION_MANUAL.md section 8.3 references get_pending_observations
-- - live RPC call returned PGRST202 (function not in schema cache)
--
-- Safety:
-- - idempotent CREATE OR REPLACE
-- - no table data mutation
-- - keeps the canonical signature: get_pending_observations(limit_count integer)
-- - returns only actionable pending rows that have a non-empty photo_url

CREATE OR REPLACE FUNCTION public.get_pending_observations(limit_count integer DEFAULT 10)
RETURNS TABLE (
  id uuid,
  photo_url text,
  photo_hash text,
  recorded_by uuid,
  organization_id uuid,
  zone_id uuid,
  gps_latitude numeric,
  gps_longitude numeric,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.photo_url,
    o.photo_hash,
    o.recorded_by,
    o.organization_id,
    o.zone_id,
    o.gps_latitude,
    o.gps_longitude,
    o.created_at
  FROM public.observations o
  WHERE o.processing_status = 'pending'
    AND COALESCE(o.photo_url, '') <> ''
    AND o.created_at > NOW() - INTERVAL '24 hours'
  ORDER BY o.created_at ASC
  LIMIT GREATEST(1, LEAST(COALESCE(limit_count, 10), 500));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_observations(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_observations(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_pending_observations(integer) TO service_role;

COMMENT ON FUNCTION public.get_pending_observations(integer)
IS 'Returns actionable pending observations for background processing (pending + non-empty photo_url, last 24h).';
