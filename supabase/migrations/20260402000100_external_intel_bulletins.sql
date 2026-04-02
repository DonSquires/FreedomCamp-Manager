-- External intelligence bulletin store for vetted feed ingestion.
-- Used by ops-intel-feed-sync workflow and inference-service intel harvester.

CREATE TABLE IF NOT EXISTS public.external_intel_bulletins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('law','security','jurisdiction','system','other')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_url TEXT,
  published_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_intel_org ON public.external_intel_bulletins(organization_id);
CREATE INDEX IF NOT EXISTS idx_external_intel_type ON public.external_intel_bulletins(type);
CREATE INDEX IF NOT EXISTS idx_external_intel_created_at ON public.external_intel_bulletins(created_at DESC);

ALTER TABLE public.external_intel_bulletins ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "external_intel_org_read" ON public.external_intel_bulletins;
  CREATE POLICY "external_intel_org_read"
    ON public.external_intel_bulletins FOR SELECT
    TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "external_intel_org_write" ON public.external_intel_bulletins;
  CREATE POLICY "external_intel_org_write"
    ON public.external_intel_bulletins FOR ALL
    TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM public.user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin','admin_officer','master','officer')
      )
    )
    WITH CHECK (
      organization_id IN (
        SELECT organization_id FROM public.user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin','admin_officer','master','officer')
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "service_role_all_external_intel" ON public.external_intel_bulletins;
  CREATE POLICY "service_role_all_external_intel"
    ON public.external_intel_bulletins FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

COMMENT ON TABLE public.external_intel_bulletins IS
  'Vetted external intelligence notices (law, security, jurisdiction, system) ingested by secure pipeline.';
