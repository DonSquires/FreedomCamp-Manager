-- Usage logs for AI cost governance and per-organization billing
-- Tracks AI workload usage across Bob chat, translation, and inference calls.

CREATE TABLE IF NOT EXISTS public.usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL,
  workload_type TEXT NOT NULL,
  provider TEXT,
  model_used TEXT,
  request_id TEXT,
  input_units INTEGER,
  output_units INTEGER,
  estimated_cost_nzd NUMERIC(12, 6),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_org_created ON public.usage_logs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_service_created ON public.usage_logs (service_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_created ON public.usage_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_request_id ON public.usage_logs (request_id) WHERE request_id IS NOT NULL;

ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usage_logs_select_org_scoped" ON public.usage_logs;
CREATE POLICY "usage_logs_select_org_scoped"
  ON public.usage_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND (
          up.role IN ('master', 'grand_master')
          OR up.organization_id = usage_logs.organization_id
          OR usage_logs.organization_id = ANY(COALESCE(up.extra_organization_ids, ARRAY[]::uuid[]))
        )
    )
  );

DROP POLICY IF EXISTS "usage_logs_insert_org_scoped" ON public.usage_logs;
CREATE POLICY "usage_logs_insert_org_scoped"
  ON public.usage_logs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND (
          up.role IN ('master', 'grand_master')
          OR up.organization_id = usage_logs.organization_id
          OR usage_logs.organization_id = ANY(COALESCE(up.extra_organization_ids, ARRAY[]::uuid[]))
        )
    )
  );

COMMENT ON TABLE public.usage_logs IS
  'Per-organization AI usage events for cost governance, chargeback, and audit.';
