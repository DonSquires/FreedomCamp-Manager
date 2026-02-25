-- ============================================================================
-- HOW TO RUN THIS FILE (no terminal needed)
-- ============================================================================
--
-- 1. Go to https://supabase.com/dashboard → your project
-- 2. Left sidebar → "Table Editor" → "SQL Editor"  (or click "SQL" icon)
-- 3. Click "New query" (top-left + button)
-- 4. Copy and paste THIS ENTIRE FILE into the editor
-- 5. Click "Run" (or Ctrl+Enter / Cmd+Enter)
-- 6. Scroll down — you should see green ✅ NOTICE messages at the bottom.
--    If you see a red error, copy it and share with the team.
--
-- WHAT THIS DOES:
--   • Enables the pgvector extension (needed for AI vehicle embeddings)
--   • Adds new columns to observations, canonical_vehicles, and zones
--   • Creates the match_vehicle(), get_zones_with_activity(), and
--     get_admin_dashboard_stats() database functions used by the admin UI
--   • Adds ParkPow integration columns
--   • All changes are SAFE TO RUN MULTIPLE TIMES (idempotent)
--
-- BEFORE YOU RUN:
--   Go to Supabase Dashboard → Settings → Extensions.
--   Search for "vector" and make sure it is ENABLED (green toggle).
--   Then come back here and run this file.
-- ============================================================================

-- ============================================================================
-- STEP 1: Enable pgvector extension
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- STEP 2: Add new columns to observations
-- ============================================================================

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS vehicle_embedding        vector(384),
  ADD COLUMN IF NOT EXISTS embedding_quality        real,
  ADD COLUMN IF NOT EXISTS embedding_model_version  text,
  ADD COLUMN IF NOT EXISTS embedding_created_at     timestamptz,
  ADD COLUMN IF NOT EXISTS vehicle_year             integer,
  ADD COLUMN IF NOT EXISTS deleted_at               timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS parkpow_session_id       integer     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS parkpow_violation_id     integer     DEFAULT NULL;

COMMENT ON COLUMN public.observations.vehicle_embedding       IS '384-D MobileNetV3 feature vector from Railway ORC/AI inference service';
COMMENT ON COLUMN public.observations.embedding_quality       IS 'L2-norm-derived quality score 0–1';
COMMENT ON COLUMN public.observations.embedding_model_version IS 'e.g. yolov8n_mobilenetv3_v1.0';
COMMENT ON COLUMN public.observations.embedding_created_at    IS 'When the embedding was generated';
COMMENT ON COLUMN public.observations.vehicle_year            IS 'Approximate vehicle year from OpenAI Vision (optional)';
COMMENT ON COLUMN public.observations.deleted_at              IS 'Soft-delete timestamp. NULL = active record.';
COMMENT ON COLUMN public.observations.parkpow_session_id      IS 'ParkPow session ID for this observation (set by orc-ingest).';
COMMENT ON COLUMN public.observations.parkpow_violation_id    IS 'ParkPow violation ID if a breach was raised (set by orc-ingest or parkpow-sync).';

-- ============================================================================
-- STEP 3: Add new columns to canonical_vehicles
-- ============================================================================

ALTER TABLE public.canonical_vehicles
  ADD COLUMN IF NOT EXISTS parkpow_vehicle_id  integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_exempt           boolean NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.canonical_vehicles.parkpow_vehicle_id IS 'ParkPow vehicle list entry ID (set by parkpow-sync?action=sync-watchlist).';
COMMENT ON COLUMN public.canonical_vehicles.is_exempt          IS 'True when this vehicle has an active ParkPow permit or manual compliance exemption.';

-- ============================================================================
-- STEP 4: Add new columns to zones
-- ============================================================================

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS parkpow_lot_id  integer DEFAULT NULL;

COMMENT ON COLUMN public.zones.parkpow_lot_id IS 'ParkPow lot ID for this zone (set by parkpow-sync?action=sync-lots).';

-- ============================================================================
-- STEP 5: Create indexes
-- ============================================================================

-- Embedding similarity (IVFFlat — safe on empty table, fast with data)
CREATE INDEX IF NOT EXISTS idx_observations_embedding_ivfflat
  ON public.observations
  USING ivfflat (vehicle_embedding vector_cosine_ops)
  WITH (lists = 100)
  WHERE vehicle_embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_observations_has_embedding
  ON public.observations (id)
  WHERE vehicle_embedding IS NOT NULL;

-- Soft-delete: fast queries for active records
CREATE INDEX IF NOT EXISTS idx_observations_not_deleted
  ON public.observations (recorded_at DESC)
  WHERE deleted_at IS NULL;

-- ParkPow linkage
CREATE INDEX IF NOT EXISTS idx_observations_parkpow_session_id
  ON public.observations (parkpow_session_id)
  WHERE parkpow_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_observations_parkpow_violation_id
  ON public.observations (parkpow_violation_id)
  WHERE parkpow_violation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_observations_unpushed_violations
  ON public.observations (id, parkpow_session_id)
  WHERE is_compliant = FALSE
    AND parkpow_session_id IS NOT NULL
    AND parkpow_violation_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_zones_parkpow_lot_id
  ON public.zones (parkpow_lot_id)
  WHERE parkpow_lot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_parkpow_vehicle_id
  ON public.canonical_vehicles (parkpow_vehicle_id)
  WHERE parkpow_vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_is_exempt
  ON public.canonical_vehicles (is_exempt)
  WHERE is_exempt = TRUE;

-- ============================================================================
-- STEP 6: match_vehicle() RPC — top-K visual similarity search
-- ============================================================================

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
    AND  o.deleted_at IS NULL
  ORDER BY o.vehicle_embedding <=> q.emb ASC
  LIMIT p_k;
$$;

GRANT EXECUTE ON FUNCTION public.match_vehicle TO authenticated;
COMMENT ON FUNCTION public.match_vehicle IS
  'Returns top-K most visually similar observations using cosine distance on 384-D MobileNetV3 embeddings.';

-- ============================================================================
-- STEP 7: get_zones_with_activity() RPC — zone KPI drilldown for Admin Portal
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_zones_with_activity(
  p_organization_id  uuid        DEFAULT NULL,
  p_start_date       timestamptz DEFAULT now() - interval '7 days',
  p_end_date         timestamptz DEFAULT now()
)
RETURNS TABLE (
  zone_id            uuid,
  zone_name          text,
  observation_count  bigint,
  breach_count       bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    z.id                                                            AS zone_id,
    z.name                                                         AS zone_name,
    COUNT(o.id)                                                    AS observation_count,
    COUNT(o.id) FILTER (WHERE o.is_compliant = FALSE)              AS breach_count
  FROM public.zones z
  LEFT JOIN public.observations o
    ON  o.zone_id = z.id
    AND o.deleted_at IS NULL
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
  'Zone observation + breach counts for admin dashboard KPI drilldown.';

-- ============================================================================
-- STEP 8: get_admin_dashboard_stats() RPC — top-level KPIs for Admin Portal
-- ============================================================================
-- NOTE: canonical_vehicles.homeless_status is TEXT ('none'|'claimed'|'confirmed')
--       There is NO boolean is_homeless column — the comparison below is correct.

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats(
  p_start_date       timestamptz,
  p_end_date         timestamptz,
  p_organization_id  uuid DEFAULT NULL
)
RETURNS TABLE (
  total_observations    bigint,
  total_breaches        bigint,
  pending_breaches      bigint,
  active_investigations bigint,
  active_officers       bigint,
  zones_with_activity   bigint,
  total_vehicles        bigint,
  flagged_vehicles      bigint,
  homeless_vehicles     bigint,
  homeless_exempt       bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    -- Total observations in date range
    (SELECT COUNT(*)
       FROM public.observations
      WHERE recorded_at BETWEEN p_start_date AND p_end_date
        AND deleted_at IS NULL
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    )::bigint AS total_observations,

    -- Total breaches in date range
    (SELECT COUNT(*)
       FROM public.observations
      WHERE recorded_at BETWEEN p_start_date AND p_end_date
        AND is_compliant = FALSE
        AND deleted_at IS NULL
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    )::bigint AS total_breaches,

    -- Pending breaches (no ParkPow violation pushed yet)
    (SELECT COUNT(*)
       FROM public.observations
      WHERE recorded_at BETWEEN p_start_date AND p_end_date
        AND is_compliant = FALSE
        AND deleted_at IS NULL
        AND parkpow_violation_id IS NULL
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    )::bigint AS pending_breaches,

    -- Active investigations (placeholder — table may be rebuilt)
    0::bigint AS active_investigations,

    -- Distinct officers active in period
    (SELECT COUNT(DISTINCT recorded_by)
       FROM public.observations
      WHERE recorded_at BETWEEN p_start_date AND p_end_date
        AND deleted_at IS NULL
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    )::bigint AS active_officers,

    -- Zones with at least one observation
    (SELECT COUNT(DISTINCT zone_id)
       FROM public.observations
      WHERE recorded_at BETWEEN p_start_date AND p_end_date
        AND deleted_at IS NULL
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    )::bigint AS zones_with_activity,

    -- Total canonical vehicles
    (SELECT COUNT(*) FROM public.canonical_vehicles)::bigint AS total_vehicles,

    -- Flagged vehicles
    (SELECT COUNT(*) FROM public.canonical_vehicles WHERE is_flagged = TRUE)::bigint AS flagged_vehicles,

    -- Homeless vehicles: homeless_status is TEXT not boolean
    (SELECT COUNT(*) FROM public.canonical_vehicles
      WHERE homeless_status IN ('claimed', 'confirmed')
    )::bigint AS homeless_vehicles,

    -- Homeless/exempt vehicles observed today (self-contained + compliant)
    (SELECT COUNT(DISTINCT plate_number)
       FROM public.observations
      WHERE DATE(recorded_at AT TIME ZONE 'Pacific/Auckland') = CURRENT_DATE
        AND is_compliant = TRUE
        AND self_contained = TRUE
        AND deleted_at IS NULL
        AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    )::bigint AS homeless_exempt;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats TO authenticated;
COMMENT ON FUNCTION public.get_admin_dashboard_stats IS
  'Top-level KPI stats for admin dashboard. Uses observations table directly.';

-- ============================================================================
-- STEP 9: Confirmation — you should see these NOTICE lines after running
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✅  FreedomCamp migration complete!';
  RAISE NOTICE '    Step 1: pgvector extension enabled';
  RAISE NOTICE '    Step 2: observations — vehicle_embedding, embedding_*, vehicle_year, deleted_at, parkpow_* columns added';
  RAISE NOTICE '    Step 3: canonical_vehicles — parkpow_vehicle_id, is_exempt columns added';
  RAISE NOTICE '    Step 4: zones — parkpow_lot_id column added';
  RAISE NOTICE '    Step 5: Indexes created (IVFFlat, soft-delete, ParkPow)';
  RAISE NOTICE '    Step 6: match_vehicle() RPC created';
  RAISE NOTICE '    Step 7: get_zones_with_activity() RPC created';
  RAISE NOTICE '    Step 8: get_admin_dashboard_stats() RPC created (homeless_status fix applied)';
  RAISE NOTICE '';
  RAISE NOTICE '    ➡  Next: deploy Supabase edge functions via GitHub Actions';
  RAISE NOTICE '       Go to GitHub → Actions → "Deploy Edge Functions" → Run workflow';
END;
$$;
