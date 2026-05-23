-- ============================================================
-- Service agreement obligations + client access policy
-- Grounded in the 2026-05-17 service-provider corpus review.
-- Extends the existing service_agreements table instead of creating
-- a disconnected parallel contract model.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.service_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  reference_number TEXT,
  agreement_type TEXT NOT NULL DEFAULT 'other',
  status TEXT DEFAULT 'active',
  allows_client_submission BOOLEAN NOT NULL DEFAULT false,
  allows_auto_dispatch BOOLEAN NOT NULL DEFAULT false,
  default_sla_minutes INTEGER NOT NULL DEFAULT 60,
  default_priority TEXT NOT NULL DEFAULT 'normal',
  active_from DATE,
  active_to DATE,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.service_agreements
  ADD COLUMN IF NOT EXISTS client_portal_access_mode TEXT
    DEFAULT 'transparency_only'
    CHECK (client_portal_access_mode IN ('full_modules', 'transparency_only')),
  ADD COLUMN IF NOT EXISTS client_portal_reports_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS client_portal_finance_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contract_profile_code TEXT,
  ADD COLUMN IF NOT EXISTS monthly_report_template_code TEXT;

COMMENT ON COLUMN public.service_agreements.client_portal_access_mode IS
  'Controls whether the client is given a full operational module shell or a reduced transparency-only shell.';

COMMENT ON COLUMN public.service_agreements.client_portal_reports_enabled IS
  'Whether the client organisation may generate reports for this agreement.';

COMMENT ON COLUMN public.service_agreements.client_portal_finance_enabled IS
  'Whether the client organisation may access invoice and billing visibility for this agreement.';

COMMENT ON COLUMN public.service_agreements.contract_profile_code IS
  'Council or contract profile code used to apply imported obligation rules, e.g. ncc_facilities_2025.';

COMMENT ON COLUMN public.service_agreements.monthly_report_template_code IS
  'Template code for fixed-format contract reporting packs.';

CREATE TABLE IF NOT EXISTS public.service_agreement_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  service_agreement_id UUID NOT NULL REFERENCES public.service_agreements(id) ON DELETE CASCADE,
  client_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  obligation_code TEXT NOT NULL,
  obligation_kind TEXT NOT NULL DEFAULT 'other'
    CHECK (obligation_kind IN (
      'response_sla',
      'reporting',
      'attendance',
      'proof',
      'frequency',
      'consent',
      'closure',
      'other'
    )),
  target_minutes INTEGER,
  escalation_minutes INTEGER,
  proof_artifact_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  report_template_code TEXT,
  rule_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_service_agreement_obligation_code UNIQUE (service_agreement_id, obligation_code),
  CONSTRAINT chk_service_agreement_obligation_minutes CHECK (
    target_minutes IS NULL OR target_minutes >= 0
  ),
  CONSTRAINT chk_service_agreement_obligation_escalation CHECK (
    escalation_minutes IS NULL OR escalation_minutes >= 0
  )
);

COMMENT ON TABLE public.service_agreement_obligations IS
  'Normalized contractual obligations linked to service_agreements, including SLA clocks, reporting templates, proof requirements, and bylaw exceptions.';

COMMENT ON COLUMN public.service_agreement_obligations.rule_payload IS
  'Structured obligation settings such as frequency templates, 500m repeat-stay rules, closure metadata, or consent lead times.';

ALTER TABLE public.service_agreement_obligations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_agreement_obligations_org_policy" ON public.service_agreement_obligations;
CREATE POLICY "service_agreement_obligations_org_policy" ON public.service_agreement_obligations
  FOR ALL TO authenticated
  USING (
    organization_id = (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id = (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_service_agreement_obligations_agreement
  ON public.service_agreement_obligations(service_agreement_id, is_active);

CREATE INDEX IF NOT EXISTS idx_service_agreement_obligations_org_kind
  ON public.service_agreement_obligations(organization_id, obligation_kind, is_active);

CREATE INDEX IF NOT EXISTS idx_service_agreement_obligations_client
  ON public.service_agreement_obligations(client_org_id)
  WHERE client_org_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_service_agreement_obligations_updated_at ON public.service_agreement_obligations;
CREATE TRIGGER set_service_agreement_obligations_updated_at
  BEFORE UPDATE ON public.service_agreement_obligations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_agreement_obligations TO authenticated;