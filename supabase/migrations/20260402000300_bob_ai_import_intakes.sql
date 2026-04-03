CREATE TABLE IF NOT EXISTS public.ai_import_intakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  assistant_name TEXT NOT NULL DEFAULT 'Bob',
  purpose TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_kind TEXT NOT NULL,
  mime_type TEXT,
  storage_bucket TEXT,
  storage_path TEXT,
  file_public_url TEXT,
  source_system TEXT,
  date_range TEXT,
  operator_notes TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_text TEXT,
  extracted_headers TEXT[] NOT NULL DEFAULT '{}'::text[],
  assistant_brief TEXT,
  recommended_table TEXT,
  recommendation_score INTEGER,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'staged'
    CHECK (status IN ('draft','staged','historical_started','imported','review_pending','actioned','failed')),
  action_target_table TEXT,
  action_target_id UUID,
  action_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_import_intakes_org_created
  ON public.ai_import_intakes(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_import_intakes_status
  ON public.ai_import_intakes(status);

ALTER TABLE public.ai_import_intakes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "ai_import_intakes_org_read" ON public.ai_import_intakes;
  CREATE POLICY "ai_import_intakes_org_read"
    ON public.ai_import_intakes FOR SELECT
    TO authenticated
    USING (
      organization_id = ANY(get_user_organization_ids(auth.uid()))
      OR get_user_role(auth.uid()) IN ('master', 'grand_master')
    );
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "ai_import_intakes_org_write" ON public.ai_import_intakes;
  CREATE POLICY "ai_import_intakes_org_write"
    ON public.ai_import_intakes FOR INSERT
    TO authenticated
    WITH CHECK (
      organization_id = ANY(get_user_organization_ids(auth.uid()))
      OR get_user_role(auth.uid()) IN ('master', 'grand_master')
    );
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "ai_import_intakes_org_update" ON public.ai_import_intakes;
  CREATE POLICY "ai_import_intakes_org_update"
    ON public.ai_import_intakes FOR UPDATE
    TO authenticated
    USING (
      organization_id = ANY(get_user_organization_ids(auth.uid()))
      OR get_user_role(auth.uid()) IN ('master', 'grand_master')
    )
    WITH CHECK (
      organization_id = ANY(get_user_organization_ids(auth.uid()))
      OR get_user_role(auth.uid()) IN ('master', 'grand_master')
    );
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "service_role_all_ai_import_intakes" ON public.ai_import_intakes;
  CREATE POLICY "service_role_all_ai_import_intakes"
    ON public.ai_import_intakes FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.trg_ai_import_intakes_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_ai_import_intakes_updated_at ON public.ai_import_intakes;
CREATE TRIGGER set_ai_import_intakes_updated_at
  BEFORE UPDATE ON public.ai_import_intakes
  FOR EACH ROW EXECUTE FUNCTION public.trg_ai_import_intakes_updated_at();

COMMENT ON TABLE public.ai_import_intakes IS
  'Bob AI-guided import intake records, recommendations, extracted text, and downstream action state.';