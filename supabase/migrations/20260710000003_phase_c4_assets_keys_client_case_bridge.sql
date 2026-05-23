-- ============================================================================
-- Phase C4: Assets / Keys / Client / Service Agreements — Case Bridge
-- Date: 2026-05-08
--
-- Extends operational_cases with client_request type; adds case_assets_used
-- and case_keys_used junction tables; creates service_agreements table.
-- ============================================================================

-- ── 1. Extend operational_cases CHECK constraints ────────────────────────────

ALTER TABLE public.operational_cases
  DROP CONSTRAINT IF EXISTS operational_cases_case_type_check;

ALTER TABLE public.operational_cases
  ADD CONSTRAINT operational_cases_case_type_check
  CHECK (case_type IN (
    'dispatch', 'patrol', 'enforcement', 'investigation', 'audit',
    'site_guard', 'access_control', 'identity_check',
    'poi_alert', 'voi_alert', 'evidence_capture',
    'client_request'
  ));

ALTER TABLE public.operational_cases
  DROP CONSTRAINT IF EXISTS operational_cases_created_from_check;

ALTER TABLE public.operational_cases
  ADD CONSTRAINT operational_cases_created_from_check
  CHECK (created_from IN (
    'dispatch', 'patrol', 'breach', 'observation', 'manual',
    'site_guard', 'access_control', 'identity_check',
    'poi_match', 'voi_match', 'evidence',
    'client_request'
  ));

-- ── 2. case_assets_used ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.case_assets_used (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id          UUID        NOT NULL REFERENCES public.operational_cases(id) ON DELETE CASCADE,
  officer_asset_id UUID        NOT NULL REFERENCES public.officer_assets(id) ON DELETE CASCADE,
  officer_id       UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  assigned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_at      TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.case_assets_used ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "case_assets_used_org_policy" ON public.case_assets_used;
CREATE POLICY "case_assets_used_org_policy" ON public.case_assets_used
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_case_assets_used_case
  ON public.case_assets_used(case_id);

CREATE INDEX IF NOT EXISTS idx_case_assets_used_org
  ON public.case_assets_used(organization_id, assigned_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.case_assets_used TO authenticated;

-- ── 3. case_keys_used ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.case_keys_used (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id         UUID        NOT NULL REFERENCES public.operational_cases(id) ON DELETE CASCADE,
  key_custody_id  UUID        NOT NULL REFERENCES public.key_custody(id) ON DELETE CASCADE,
  officer_id      UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  linked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.case_keys_used ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "case_keys_used_org_policy" ON public.case_keys_used;
CREATE POLICY "case_keys_used_org_policy" ON public.case_keys_used
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_case_keys_used_case
  ON public.case_keys_used(case_id);

CREATE INDEX IF NOT EXISTS idx_case_keys_used_org
  ON public.case_keys_used(organization_id, linked_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.case_keys_used TO authenticated;

-- ── 4. service_agreements ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.service_agreements (
  id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_org_id           UUID    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_site_id          UUID    REFERENCES public.client_sites(id) ON DELETE SET NULL,
  agreement_number        TEXT    NOT NULL,
  service_type            TEXT    NOT NULL
    CHECK (service_type IN (
      'guarding', 'patrol', 'freedom_camping', 'parking', 'noise_control',
      'biosecurity', 'ems', 'event_security', 'access_control', 'other'
    )),
  start_date              DATE    NOT NULL,
  end_date                DATE,
  auto_renew              BOOLEAN NOT NULL DEFAULT false,
  renewal_notice_days     INTEGER NOT NULL DEFAULT 30,
  response_time_minutes   INTEGER,
  patrol_frequency_hours  DECIMAL(5,2),
  min_officers            INTEGER NOT NULL DEFAULT 1,
  status                  TEXT    NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'suspended', 'expired', 'cancelled')),
  notes                   TEXT,
  created_by              UUID    REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Compatibility backfill for environments where service_agreements
-- was introduced earlier with a different column set.
ALTER TABLE IF EXISTS public.service_agreements
  ADD COLUMN IF NOT EXISTS client_site_id UUID REFERENCES public.client_sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agreement_number TEXT,
  ADD COLUMN IF NOT EXISTS service_type TEXT,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE,
  ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS renewal_notice_days INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS response_time_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS patrol_frequency_hours DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS min_officers INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE public.service_agreements
SET agreement_number = COALESCE(NULLIF(agreement_number, ''), 'AG-' || LEFT(id::text, 8))
WHERE agreement_number IS NULL;

ALTER TABLE public.service_agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_agreements_org_policy" ON public.service_agreements;
CREATE POLICY "service_agreements_org_policy" ON public.service_agreements
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_agreement_number
  ON public.service_agreements(organization_id, agreement_number);

CREATE INDEX IF NOT EXISTS idx_service_agreements_client
  ON public.service_agreements(client_org_id, status);

GRANT SELECT, INSERT, UPDATE ON public.service_agreements TO authenticated;
