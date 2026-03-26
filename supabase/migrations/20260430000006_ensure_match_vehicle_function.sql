-- =============================================================================
-- Ensure match_vehicle function exists with correct parameter names
--
-- Schema Extract #2 confirmed this function is not present in the live database
-- (absent from generated TypeScript types).  It was defined in the
-- run_in_sql_editor manual migration (20260225000003) which may not have been
-- applied via the standard migration chain.
--
-- The function requires pgvector (CREATE EXTENSION IF NOT EXISTS vector is
-- in 20260225000003 which is a prerequisite).  If pgvector is not available
-- the CREATE EXTENSION guard below will raise a warning and the function
-- will not be created (the orc-ingest non-fatal error path handles this).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

DROP FUNCTION IF EXISTS public.match_vehicle(uuid, int, timestamptz, uuid, uuid, real);

CREATE OR REPLACE FUNCTION public.match_vehicle(
  p_obs_id      uuid,
  p_k           int          DEFAULT 5,
  p_since       timestamptz  DEFAULT now() - interval '90 days',
  p_org_id      uuid         DEFAULT NULL,
  p_zone_id     uuid         DEFAULT NULL,
  p_min_quality real         DEFAULT 0.3
)
RETURNS TABLE (
  match_observation_id  uuid,
  plate_number          text,
  similarity            real,
  recorded_at           timestamptz,
  zone_id               uuid,
  is_compliant          boolean,
  photo_url             text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH query_vec AS (
    SELECT vehicle_embedding AS emb
    FROM   public.observations
    WHERE  id = p_obs_id
      AND  vehicle_embedding IS NOT NULL
  )
  SELECT
    o.id,
    o.plate_number,
    (1.0 - (o.vehicle_embedding <=> q.emb))::real  AS similarity,
    o.recorded_at,
    o.zone_id,
    o.is_compliant,
    o.photo_url
  FROM   public.observations o, query_vec q
  WHERE  o.id <> p_obs_id
    AND  o.vehicle_embedding IS NOT NULL
    AND  o.embedding_quality >= p_min_quality
    AND  o.recorded_at >= p_since
    AND  (p_org_id  IS NULL OR o.organization_id = p_org_id)
    AND  (p_zone_id IS NULL OR o.zone_id = p_zone_id)
    AND  o.deleted_at IS NULL
  ORDER BY o.vehicle_embedding <=> q.emb ASC
  LIMIT p_k;
$$;

GRANT EXECUTE ON FUNCTION public.match_vehicle(uuid, int, timestamptz, uuid, uuid, real) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_vehicle(uuid, int, timestamptz, uuid, uuid, real) TO service_role;

COMMENT ON FUNCTION public.match_vehicle IS
  'Returns top-K most visually similar observations using cosine distance on 384-D MobileNetV3 embeddings. Args: p_obs_id (query observation), p_k (max results), p_since (lookback window), p_org_id (org scope), p_zone_id (zone scope), p_min_quality (embedding quality threshold).';
