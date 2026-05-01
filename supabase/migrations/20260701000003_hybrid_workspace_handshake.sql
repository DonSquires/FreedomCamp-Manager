-- ============================================================
-- Hybrid Workspace Handshake
-- ============================================================
-- Adds workspace ownership + provider access handshake so a service provider
-- can tunnel into a client-owned workspace when geofence + contract rules pass.
--
-- This extends the existing GPS resolver:
--   resolve_geofence_operational_context(...)
--
-- Resulting function:
--   resolve_hybrid_workspace_handshake(...)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_name TEXT NOT NULL,
  bylaw_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_client_owned BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_org_id, workspace_name)
);

CREATE TABLE IF NOT EXISTS public.contractor_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contract_id UUID REFERENCES public.crm_contracts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'suspended')),
  can_use_ptt_bridge BOOLEAN NOT NULL DEFAULT true,
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  notes TEXT,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_org_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_org ON public.workspaces(owner_org_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_active ON public.workspaces(is_active);
CREATE INDEX IF NOT EXISTS idx_contractor_access_provider ON public.contractor_access(provider_org_id);
CREATE INDEX IF NOT EXISTS idx_contractor_access_workspace ON public.contractor_access(workspace_id);
CREATE INDEX IF NOT EXISTS idx_contractor_access_contract ON public.contractor_access(contract_id);

CREATE OR REPLACE FUNCTION public.update_workspace_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspaces_updated_at ON public.workspaces;
CREATE TRIGGER trg_workspaces_updated_at
BEFORE UPDATE ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.update_workspace_updated_at();

CREATE OR REPLACE FUNCTION public.update_contractor_access_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contractor_access_updated_at ON public.contractor_access;
CREATE TRIGGER trg_contractor_access_updated_at
BEFORE UPDATE ON public.contractor_access
FOR EACH ROW EXECUTE FUNCTION public.update_contractor_access_updated_at();

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspaces_select" ON public.workspaces;
CREATE POLICY "workspaces_select"
ON public.workspaces
FOR SELECT
TO authenticated
USING (
  owner_org_id = public.get_user_organization_id(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.contractor_access ca
    WHERE ca.workspace_id = workspaces.id
      AND ca.provider_org_id = public.get_user_organization_id(auth.uid())
      AND ca.status = 'active'
      AND ca.valid_from <= CURRENT_DATE
      AND (ca.valid_to IS NULL OR ca.valid_to >= CURRENT_DATE)
  )
  OR public.get_user_role(auth.uid()) IN ('master', 'grand_master')
);

DROP POLICY IF EXISTS "workspaces_manage" ON public.workspaces;
CREATE POLICY "workspaces_manage"
ON public.workspaces
FOR ALL
TO authenticated
USING (
  public.get_user_role(auth.uid()) IN ('admin', 'master', 'grand_master')
  AND (
    owner_org_id = public.get_user_organization_id(auth.uid())
    OR public.get_user_role(auth.uid()) IN ('master', 'grand_master')
  )
)
WITH CHECK (
  public.get_user_role(auth.uid()) IN ('admin', 'master', 'grand_master')
  AND (
    owner_org_id = public.get_user_organization_id(auth.uid())
    OR public.get_user_role(auth.uid()) IN ('master', 'grand_master')
  )
);

DROP POLICY IF EXISTS "contractor_access_select" ON public.contractor_access;
CREATE POLICY "contractor_access_select"
ON public.contractor_access
FOR SELECT
TO authenticated
USING (
  provider_org_id = public.get_user_organization_id(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.id = contractor_access.workspace_id
      AND w.owner_org_id = public.get_user_organization_id(auth.uid())
  )
  OR public.get_user_role(auth.uid()) IN ('master', 'grand_master')
);

DROP POLICY IF EXISTS "contractor_access_manage" ON public.contractor_access;
CREATE POLICY "contractor_access_manage"
ON public.contractor_access
FOR ALL
TO authenticated
USING (
  public.get_user_role(auth.uid()) IN ('admin', 'master', 'grand_master')
  AND (
    provider_org_id = public.get_user_organization_id(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = contractor_access.workspace_id
        AND w.owner_org_id = public.get_user_organization_id(auth.uid())
    )
    OR public.get_user_role(auth.uid()) IN ('master', 'grand_master')
  )
)
WITH CHECK (
  public.get_user_role(auth.uid()) IN ('admin', 'master', 'grand_master')
  AND (
    provider_org_id = public.get_user_organization_id(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = contractor_access.workspace_id
        AND w.owner_org_id = public.get_user_organization_id(auth.uid())
    )
    OR public.get_user_role(auth.uid()) IN ('master', 'grand_master')
  )
);

CREATE OR REPLACE FUNCTION public.resolve_hybrid_workspace_handshake(
  p_provider_org_id UUID,
  p_longitude DOUBLE PRECISION,
  p_latitude DOUBLE PRECISION,
  p_preferred_client_org_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT auth.uid(),
  p_default_translation_lang TEXT DEFAULT 'hi-IN'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base JSONB;
  v_client_org_id UUID;
  v_contract_id UUID;
  v_workspace RECORD;
  v_access RECORD;
BEGIN
  v_base := public.resolve_geofence_operational_context(
    p_provider_org_id,
    p_longitude,
    p_latitude,
    p_preferred_client_org_id,
    p_user_id,
    p_default_translation_lang
  );

  IF COALESCE((v_base->>'matched')::BOOLEAN, FALSE) = FALSE THEN
    RETURN v_base || jsonb_build_object(
      'handshake_active', false,
      'handshake_reason', 'no_operational_match'
    );
  END IF;

  IF COALESCE((v_base->>'conflict')::BOOLEAN, FALSE) = TRUE THEN
    RETURN v_base || jsonb_build_object(
      'handshake_active', false,
      'handshake_reason', 'jurisdiction_conflict'
    );
  END IF;

  v_client_org_id := NULLIF(v_base->>'client_org_id', '')::UUID;
  v_contract_id := NULLIF(v_base->>'contract_id', '')::UUID;

  IF v_client_org_id IS NULL THEN
    RETURN v_base || jsonb_build_object(
      'handshake_active', false,
      'handshake_reason', 'missing_client_org'
    );
  END IF;

  SELECT w.* INTO v_workspace
  FROM public.workspaces w
  WHERE w.owner_org_id = v_client_org_id
    AND w.is_active = TRUE
  ORDER BY w.is_client_owned DESC, w.created_at ASC
  LIMIT 1;

  IF v_workspace IS NULL THEN
    RETURN v_base || jsonb_build_object(
      'handshake_active', false,
      'handshake_reason', 'workspace_not_configured',
      'workspace_owner_org_id', v_client_org_id
    );
  END IF;

  SELECT ca.* INTO v_access
  FROM public.contractor_access ca
  WHERE ca.workspace_id = v_workspace.id
    AND ca.provider_org_id = p_provider_org_id
    AND ca.status = 'active'
    AND ca.valid_from <= CURRENT_DATE
    AND (ca.valid_to IS NULL OR ca.valid_to >= CURRENT_DATE)
    AND (ca.contract_id IS NULL OR ca.contract_id = v_contract_id)
  ORDER BY ca.created_at DESC
  LIMIT 1;

  IF v_access IS NULL THEN
    RETURN v_base || jsonb_build_object(
      'handshake_active', false,
      'handshake_reason', 'provider_not_authorized_for_workspace',
      'workspace_id', v_workspace.id,
      'workspace_name', v_workspace.workspace_name,
      'workspace_owner_org_id', v_workspace.owner_org_id
    );
  END IF;

  RETURN v_base || jsonb_build_object(
    'handshake_active', true,
    'handshake_reason', 'workspace_tunnel_authorized',
    'workspace_id', v_workspace.id,
    'workspace_name', v_workspace.workspace_name,
    'workspace_owner_org_id', v_workspace.owner_org_id,
    'is_client_owned_workspace', v_workspace.is_client_owned,
    'workspace_bylaw_config', v_workspace.bylaw_config,
    'contractor_access_id', v_access.id,
    'can_use_ptt_bridge', v_access.can_use_ptt_bridge,
    'workspace_mode', CASE
      WHEN v_workspace.owner_org_id = p_provider_org_id THEN 'provider_workspace'
      ELSE 'client_workspace_tunnel'
    END,
    'jurisdiction_banner', CASE
      WHEN v_workspace.owner_org_id = p_provider_org_id THEN 'Standard Patrol Mode'
      ELSE 'Client Jurisdiction Active - Translation Available'
    END
  );
END;
$$;

COMMENT ON FUNCTION public.resolve_hybrid_workspace_handshake(UUID, DOUBLE PRECISION, DOUBLE PRECISION, UUID, UUID, TEXT)
IS 'Extends geofence operational context with workspace ownership + contractor access handshake for provider-to-client tunnel workflows.';

GRANT EXECUTE ON FUNCTION public.resolve_hybrid_workspace_handshake(UUID, DOUBLE PRECISION, DOUBLE PRECISION, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_hybrid_workspace_handshake(UUID, DOUBLE PRECISION, DOUBLE PRECISION, UUID, UUID, TEXT) TO service_role;
