-- ============================================================================
-- ORC/AI: Add vehicle embeddings to observations table
-- Migration: 20260225_orc_ai_observations.sql
-- ============================================================================
-- Adds 384-dimensional vector columns to the observations table so the
-- Railway ORC/AI inference service (YOLOv8n + MobileNetV3) can store vehicle
-- fingerprints alongside plate/compliance data.
--
-- Also adds:
--   match_vehicle()  RPC  — top-K cosine similarity lookup
--   get_zones_with_activity()  RPC  — replaces broken view reference in
--                                     AdminPortal.tsx
-- ============================================================================

-- ── 1. Enable pgvector (safe to run multiple times) ───────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

-- ── 2. Add embedding columns to observations ─────────────────────────────

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS vehicle_embedding        vector(384),
  ADD COLUMN IF NOT EXISTS embedding_quality        real,
  ADD COLUMN IF NOT EXISTS embedding_model_version  text,
  ADD COLUMN IF NOT EXISTS embedding_created_at     timestamptz,
  ADD COLUMN IF NOT EXISTS vehicle_year             integer;

COMMENT ON COLUMN public.observations.vehicle_embedding        IS '384-D MobileNetV3 feature vector from Railway ORC/AI inference service';
COMMENT ON COLUMN public.observations.embedding_quality        IS 'L2-norm-derived quality score 0–1';
COMMENT ON COLUMN public.observations.embedding_model_version  IS 'e.g. yolov8n_mobilenetv3_v1.0';
COMMENT ON COLUMN public.observations.embedding_created_at     IS 'When the embedding was generated';
COMMENT ON COLUMN public.observations.vehicle_year             IS 'Approximate vehicle year from OpenAI Vision (optional)';

-- ── 3. IVFFlat index for fast top-K similarity ───────────────────────────
-- Run AFTER the table has meaningful data; safe to run on empty table.

CREATE INDEX IF NOT EXISTS idx_observations_embedding_ivfflat
  ON public.observations
  USING ivfflat (vehicle_embedding vector_cosine_ops)
  WITH (lists = 100)
  WHERE vehicle_embedding IS NOT NULL;

-- Standard index for embedding presence checks
CREATE INDEX IF NOT EXISTS idx_observations_has_embedding
  ON public.observations (id)
  WHERE vehicle_embedding IS NOT NULL;

-- ── 4. match_vehicle() — top-K cosine similarity ─────────────────────────
-- Drop first so PostgreSQL can change the return-type safely (42P13)
DROP FUNCTION IF EXISTS public.match_vehicle(uuid, integer, timestamp with time zone, uuid, uuid, real);

CREATE OR REPLACE FUNCTION public.match_vehicle(
  p_obs_id        uuid,
  p_k             int          DEFAULT 5,
  p_since         timestamptz  DEFAULT now() - interval '90 days',
  p_org_id        uuid         DEFAULT NULL,
  p_zone_id       uuid         DEFAULT NULL,
  p_min_quality   real         DEFAULT 0.3
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
  ORDER BY o.vehicle_embedding <=> q.emb ASC
  LIMIT p_k;
$$;

GRANT EXECUTE ON FUNCTION public.match_vehicle TO authenticated;

COMMENT ON FUNCTION public.match_vehicle IS
  'Returns the top-K most visually similar observations using cosine distance on 384-D MobileNetV3 embeddings.';

-- ── 5. get_zones_with_activity() — replaces broken dashboard view ─────────
-- AdminPortal.tsx calls supabase.rpc("get_zones_with_activity", {...}).
-- The old view referenced non-existent columns; this RPC queries observations
-- directly against the current schema.

DROP FUNCTION IF EXISTS public.get_zones_with_activity(uuid, timestamp with time zone, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.get_zones_with_activity(
  p_organization_id  uuid        DEFAULT NULL,
  p_start_date       timestamptz DEFAULT now() - interval '7 days',
  p_end_date         timestamptz DEFAULT now()
)
RETURNS TABLE (
  zone_id           uuid,
  zone_name         text,
  observation_count bigint,
  breach_count      bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    z.id                                AS zone_id,
    z.name                              AS zone_name,
    COUNT(o.id)                         AS observation_count,
    COUNT(o.id) FILTER (WHERE NOT o.is_compliant) AS breach_count
  FROM public.zones z
  LEFT JOIN public.observations o
    ON  o.zone_id = z.id
    AND o.recorded_at BETWEEN p_start_date AND p_end_date
    AND (p_organization_id IS NULL OR o.organization_id = p_organization_id)
  WHERE z.is_active = true
    AND (p_organization_id IS NULL OR z.organization_id = p_organization_id)
  GROUP BY z.id, z.name
  HAVING COUNT(o.id) > 0
  ORDER BY observation_count DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_zones_with_activity TO authenticated;

COMMENT ON FUNCTION public.get_zones_with_activity IS
  'Returns zones with observation and breach counts for the admin dashboard. Used by AdminPortal.tsx KPI drilldown.';

-- ── 6. Rebuild get_admin_dashboard_stats with correct column names ─────────
-- canonical_vehicles uses homeless_status TEXT ('none'|'claimed'|'confirmed'),
-- NOT a boolean is_homeless column.  Fix accordingly.

DROP FUNCTION IF EXISTS public.get_admin_dashboard_stats(timestamp with time zone, timestamp with time zone, uuid);

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats(
  p_start_date       timestamptz,
  p_end_date         timestamptz,
  p_organization_id  uuid DEFAULT NULL
)
RETURNS TABLE(
  total_observations  bigint,
  total_breaches      bigint,
  pending_breaches    bigint,
  active_investigations bigint,
  active_officers     bigint,
  zones_with_activity bigint,
  total_vehicles      bigint,
  flagged_vehicles    bigint,
  homeless_vehicles   bigint,
  homeless_exempt     bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    -- Observations in range
    (SELECT COUNT(*) FROM public.observations
     WHERE recorded_at BETWEEN p_start_date AND p_end_date
       AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    ) AS total_observations,

    -- Breaches in range
    (SELECT COUNT(*) FROM public.observations
     WHERE recorded_at BETWEEN p_start_date AND p_end_date
       AND is_compliant = FALSE
       AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    ) AS total_breaches,

    -- Pending breach alerts (table may not exist — return 0 safely)
    (SELECT COUNT(*) FROM public.observations
     WHERE is_compliant = FALSE
       AND recorded_at BETWEEN p_start_date AND p_end_date
       AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    ) AS pending_breaches,

    -- Active investigations (table may not exist — return 0)
    0::bigint AS active_investigations,

    -- Active officers
    (SELECT COUNT(DISTINCT recorded_by) FROM public.observations
     WHERE recorded_at BETWEEN p_start_date AND p_end_date
       AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    ) AS active_officers,

    -- Zones with activity
    (SELECT COUNT(DISTINCT zone_id) FROM public.observations
     WHERE recorded_at BETWEEN p_start_date AND p_end_date
       AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    ) AS zones_with_activity,

    -- Total canonical vehicles
    (SELECT COUNT(*) FROM public.canonical_vehicles) AS total_vehicles,

    -- Flagged vehicles  
    (SELECT COUNT(*) FROM public.canonical_vehicles WHERE is_flagged = TRUE) AS flagged_vehicles,

    -- Homeless vehicles  (homeless_status is TEXT: 'none'|'claimed'|'confirmed')
    (SELECT COUNT(*) FROM public.canonical_vehicles WHERE homeless_status IN ('claimed','confirmed')) AS homeless_vehicles,

    -- Homeless exempt today
    (SELECT COUNT(DISTINCT plate_number) FROM public.observations
     WHERE DATE(recorded_at AT TIME ZONE 'Pacific/Auckland') = CURRENT_DATE
       AND is_compliant = TRUE
       AND self_contained = TRUE
       AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    ) AS homeless_exempt;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats TO authenticated;

COMMENT ON FUNCTION public.get_admin_dashboard_stats IS
  'KPI stats for admin dashboard. Uses homeless_status IN clause (not is_homeless column).';

-- ── 7. Soft-delete column (observations referenced deleted_at in old views) ─

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.observations.deleted_at IS 'Soft-delete timestamp. NULL = active record.';

CREATE INDEX IF NOT EXISTS idx_observations_not_deleted
  ON public.observations (recorded_at DESC)
  WHERE deleted_at IS NULL;

-- ── Verification ──────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '✅ ORC/AI migration complete';
  RAISE NOTICE '   + vector extension enabled';
  RAISE NOTICE '   + observations.vehicle_embedding vector(384)';
  RAISE NOTICE '   + observations.vehicle_year integer';
  RAISE NOTICE '   + observations.deleted_at timestamptz';
  RAISE NOTICE '   + IVFFlat index on vehicle_embedding';
  RAISE NOTICE '   + match_vehicle() RPC';
  RAISE NOTICE '   + get_zones_with_activity() RPC';
  RAISE NOTICE '   + get_admin_dashboard_stats() fixed (homeless_status IN clause)';
END;
$$;
