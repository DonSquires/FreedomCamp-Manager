-- ============================================================
-- Geo Tenant Access + Contextual Handshake Extensions
-- ============================================================
-- Adds contractor_jurisdictions for explicit provider->client geo delegation
-- and a compatibility function get_active_context(...) for context switching.
--
-- This migration is additive and designed to work alongside
-- resolve_hybrid_workspace_handshake(...).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contractor_jurisdictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id UUID,
  access_level TEXT NOT NULL CHECK (access_level IN ('read', 'enforce', 'admin')),
  ptt_bridge_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, client_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_contractor_jurisdictions_provider ON public.contractor_jurisdictions(provider_id);
CREATE INDEX IF NOT EXISTS idx_contractor_jurisdictions_client ON public.contractor_jurisdictions(client_id);
CREATE INDEX IF NOT EXISTS idx_contractor_jurisdictions_branch ON public.contractor_jurisdictions(branch_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'branches'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'contractor_jurisdictions_branch_id_fkey'
    ) THEN
      EXECUTE 'ALTER TABLE public.contractor_jurisdictions ADD CONSTRAINT contractor_jurisdictions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE';
    END IF;
  END IF;
END
$$;

ALTER TABLE public.contractor_jurisdictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contractor_jurisdictions_select" ON public.contractor_jurisdictions;
CREATE POLICY "contractor_jurisdictions_select"
ON public.contractor_jurisdictions
FOR SELECT
TO authenticated
USING (
  provider_id = public.get_user_organization_id(auth.uid())
  OR client_id = public.get_user_organization_id(auth.uid())
  OR public.get_user_role(auth.uid()) IN ('master', 'grand_master')
);

DROP POLICY IF EXISTS "contractor_jurisdictions_manage" ON public.contractor_jurisdictions;
CREATE POLICY "contractor_jurisdictions_manage"
ON public.contractor_jurisdictions
FOR ALL
TO authenticated
USING (
  public.get_user_role(auth.uid()) IN ('admin', 'master', 'grand_master')
)
WITH CHECK (
  public.get_user_role(auth.uid()) IN ('admin', 'master', 'grand_master')
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'branches'
      AND column_name = 'geom'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_branches_geom ON public.branches USING GIST (geom)';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.get_active_context(
  officer_lat DOUBLE PRECISION,
  officer_lng DOUBLE PRECISION,
  provider_id UUID
)
RETURNS TABLE(
  workspace_name TEXT,
  bylaws JSONB,
  ptt_id TEXT,
  client_org_id UUID,
  branch_id UUID,
  translation_language TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx JSONB;
BEGIN
  v_ctx := public.resolve_hybrid_workspace_handshake(
    provider_id,
    officer_lng,
    officer_lat,
    NULL,
    auth.uid(),
    'hi-IN'
  );

  IF COALESCE((v_ctx->>'handshake_active')::BOOLEAN, FALSE) = FALSE THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(v_ctx->>'workspace_name', 'Operational Workspace') AS workspace_name,
    COALESCE(v_ctx->'workspace_bylaw_config', '{}'::jsonb) AS bylaws,
    COALESCE(
      v_ctx->>'ptt_channel_id',
      v_ctx->'workspace_bylaw_config'->>'ptt_channel_id',
      'default'
    ) AS ptt_id,
    NULLIF(v_ctx->>'client_org_id', '')::UUID AS client_org_id,
    NULLIF(v_ctx->>'branch_id', '')::UUID AS branch_id,
    COALESCE(v_ctx->>'target_translation_language', 'hi-IN') AS translation_language;
END;
$$;

COMMENT ON FUNCTION public.get_active_context(DOUBLE PRECISION, DOUBLE PRECISION, UUID)
IS 'Returns active workspace context for a provider based on officer GPS using hybrid handshake resolver.';

GRANT EXECUTE ON FUNCTION public.get_active_context(DOUBLE PRECISION, DOUBLE PRECISION, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_context(DOUBLE PRECISION, DOUBLE PRECISION, UUID) TO service_role;
