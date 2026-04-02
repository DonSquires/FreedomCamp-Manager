CREATE TABLE IF NOT EXISTS public.ops_live_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  crm_document_id UUID REFERENCES public.crm_documents(id) ON DELETE SET NULL,

  plan_type TEXT NOT NULL CHECK (
    plan_type IN (
      'sop',
      'assignment_instructions',
      'risk_assessment',
      'hs_plan',
      'evacuation_plan',
      'active_offender_procedure',
      'crowded_places_action_plan'
    )
  ),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),

  assignment_scope TEXT NOT NULL DEFAULT 'organization' CHECK (
    assignment_scope IN ('organization', 'zone', 'client_site', 'service_provider_office')
  ),
  zone_id UUID REFERENCES public.zones(id) ON DELETE SET NULL,
  client_site_id UUID REFERENCES public.client_sites(id) ON DELETE SET NULL,
  service_provider_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  service_provider_office_id UUID REFERENCES public.office_locations(id) ON DELETE SET NULL,

  field_staff_can_view BOOLEAN NOT NULL DEFAULT true,

  review_on_incident BOOLEAN NOT NULL DEFAULT true,
  review_on_hs_report BOOLEAN NOT NULL DEFAULT true,
  review_on_poi_report BOOLEAN NOT NULL DEFAULT true,
  review_on_voi_report BOOLEAN NOT NULL DEFAULT true,

  weather_conditions TEXT,
  extreme_weather_protocol TEXT,
  environmental_hazards TEXT,
  biological_hazards TEXT,
  hazard_controls TEXT,

  plan_body TEXT NOT NULL,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_context JSONB NOT NULL DEFAULT '{}'::jsonb,

  last_reviewed_at TIMESTAMPTZ,
  next_review_due_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_live_plans_org_created
  ON public.ops_live_plans(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_live_plans_scope
  ON public.ops_live_plans(assignment_scope, zone_id, client_site_id);

CREATE INDEX IF NOT EXISTS idx_ops_live_plans_status
  ON public.ops_live_plans(status);

CREATE TABLE IF NOT EXISTS public.ops_live_plan_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.ops_live_plans(id) ON DELETE CASCADE,

  source_type TEXT NOT NULL CHECK (source_type IN ('incident', 'hs_report', 'poi_report', 'voi_report')),
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,

  zone_id UUID REFERENCES public.zones(id) ON DELETE SET NULL,
  client_site_id UUID REFERENCES public.client_sites(id) ON DELETE SET NULL,

  event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'completed')),
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_ops_live_plan_reviews_org_status
  ON public.ops_live_plan_reviews(organization_id, status, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_live_plan_reviews_plan
  ON public.ops_live_plan_reviews(plan_id, event_at DESC);

ALTER TABLE public.ops_live_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_live_plan_reviews ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "ops_live_plans_org_read" ON public.ops_live_plans;
  CREATE POLICY "ops_live_plans_org_read"
    ON public.ops_live_plans FOR SELECT
    TO authenticated
    USING (
      organization_id = ANY(get_user_organization_ids())
      AND (
        field_staff_can_view
        OR get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
      )
    );
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "ops_live_plans_org_write" ON public.ops_live_plans;
  CREATE POLICY "ops_live_plans_org_write"
    ON public.ops_live_plans FOR ALL
    TO authenticated
    USING (
      organization_id = ANY(get_user_organization_ids())
      AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
    )
    WITH CHECK (
      organization_id = ANY(get_user_organization_ids())
      AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
    );
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "ops_live_plan_reviews_org_read" ON public.ops_live_plan_reviews;
  CREATE POLICY "ops_live_plan_reviews_org_read"
    ON public.ops_live_plan_reviews FOR SELECT
    TO authenticated
    USING (
      organization_id = ANY(get_user_organization_ids())
    );
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "ops_live_plan_reviews_org_update" ON public.ops_live_plan_reviews;
  CREATE POLICY "ops_live_plan_reviews_org_update"
    ON public.ops_live_plan_reviews FOR UPDATE
    TO authenticated
    USING (
      organization_id = ANY(get_user_organization_ids())
      AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
    )
    WITH CHECK (
      organization_id = ANY(get_user_organization_ids())
      AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
    );
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "service_role_all_ops_live_plans" ON public.ops_live_plans;
  CREATE POLICY "service_role_all_ops_live_plans"
    ON public.ops_live_plans FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "service_role_all_ops_live_plan_reviews" ON public.ops_live_plan_reviews;
  CREATE POLICY "service_role_all_ops_live_plan_reviews"
    ON public.ops_live_plan_reviews FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.trg_ops_live_plans_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_ops_live_plans_updated_at ON public.ops_live_plans;
CREATE TRIGGER set_ops_live_plans_updated_at
  BEFORE UPDATE ON public.ops_live_plans
  FOR EACH ROW EXECUTE FUNCTION public.trg_ops_live_plans_updated_at();

CREATE OR REPLACE FUNCTION public.create_ops_live_plan_review_event(
  p_organization_id UUID,
  p_source_type TEXT,
  p_source_table TEXT,
  p_source_id UUID,
  p_zone_id UUID DEFAULT NULL,
  p_client_site_id UUID DEFAULT NULL,
  p_event_at TIMESTAMPTZ DEFAULT now()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INTEGER := 0;
BEGIN
  INSERT INTO public.ops_live_plan_reviews (
    organization_id,
    plan_id,
    source_type,
    source_table,
    source_id,
    zone_id,
    client_site_id,
    event_at,
    status
  )
  SELECT
    p_organization_id,
    p.id,
    p_source_type,
    p_source_table,
    p_source_id,
    p_zone_id,
    p_client_site_id,
    p_event_at,
    'pending'
  FROM public.ops_live_plans p
  WHERE p.organization_id = p_organization_id
    AND p.status = 'active'
    AND (
      p.assignment_scope = 'organization'
      OR (p.assignment_scope = 'zone' AND p_zone_id IS NOT NULL AND p.zone_id = p_zone_id)
      OR (p.assignment_scope = 'client_site' AND p_client_site_id IS NOT NULL AND p.client_site_id = p_client_site_id)
      OR (p.assignment_scope = 'service_provider_office' AND p.service_provider_org_id = p_organization_id)
    )
    AND (
      (p_source_type = 'incident' AND p.review_on_incident)
      OR (p_source_type = 'hs_report' AND p.review_on_hs_report)
      OR (p_source_type = 'poi_report' AND p.review_on_poi_report)
      OR (p_source_type = 'voi_report' AND p.review_on_voi_report)
    )
  ON CONFLICT (plan_id, source_type, source_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_ops_live_plan_review_event(UUID, TEXT, TEXT, UUID, UUID, UUID, TIMESTAMPTZ) TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_incidents'
  ) THEN
    EXECUTE $SQL$
      CREATE OR REPLACE FUNCTION public.trg_ops_review_from_site_incidents()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $FN$
      BEGIN
        IF NEW.status IN ('submitted', 'reviewed', 'closed') THEN
          PERFORM public.create_ops_live_plan_review_event(
            NEW.organization_id,
            'incident',
            'site_incidents',
            NEW.id,
            NULL,
            NEW.client_site_id,
            NEW.updated_at
          );
        END IF;
        RETURN NEW;
      END;
      $FN$;
    $SQL$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_ops_review_site_incidents ON public.site_incidents';
    EXECUTE 'CREATE TRIGGER trg_ops_review_site_incidents AFTER INSERT OR UPDATE OF status ON public.site_incidents FOR EACH ROW EXECUTE FUNCTION public.trg_ops_review_from_site_incidents()';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'site_risk_assessments'
  ) THEN
    EXECUTE $SQL$
      CREATE OR REPLACE FUNCTION public.trg_ops_review_from_site_risk_assessments()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $FN$
      BEGIN
        IF NEW.status IN ('submitted', 'reviewed', 'archived') THEN
          PERFORM public.create_ops_live_plan_review_event(
            NEW.organization_id,
            'hs_report',
            'site_risk_assessments',
            NEW.id,
            NEW.zone_id,
            NULL,
            NEW.updated_at
          );
        END IF;
        RETURN NEW;
      END;
      $FN$;
    $SQL$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_ops_review_site_risk_assessments ON public.site_risk_assessments';
    EXECUTE 'CREATE TRIGGER trg_ops_review_site_risk_assessments AFTER INSERT OR UPDATE OF status ON public.site_risk_assessments FOR EACH ROW EXECUTE FUNCTION public.trg_ops_review_from_site_risk_assessments()';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'persons_of_interest'
  ) THEN
    EXECUTE $SQL$
      CREATE OR REPLACE FUNCTION public.trg_ops_review_from_poi()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $FN$
      BEGIN
        PERFORM public.create_ops_live_plan_review_event(
          NEW.organization_id,
          'poi_report',
          'persons_of_interest',
          NEW.id,
          NULL,
          NEW.client_site_id,
          NEW.created_at
        );
        RETURN NEW;
      END;
      $FN$;
    $SQL$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_ops_review_poi ON public.persons_of_interest';
    EXECUTE 'CREATE TRIGGER trg_ops_review_poi AFTER INSERT ON public.persons_of_interest FOR EACH ROW EXECUTE FUNCTION public.trg_ops_review_from_poi()';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vehicles_of_interest'
  ) THEN
    EXECUTE $SQL$
      CREATE OR REPLACE FUNCTION public.trg_ops_review_from_voi()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $FN$
      BEGIN
        PERFORM public.create_ops_live_plan_review_event(
          NEW.organization_id,
          'voi_report',
          'vehicles_of_interest',
          NEW.id,
          NULL,
          NULL,
          NEW.created_at
        );
        RETURN NEW;
      END;
      $FN$;
    $SQL$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_ops_review_voi ON public.vehicles_of_interest';
    EXECUTE 'CREATE TRIGGER trg_ops_review_voi AFTER INSERT ON public.vehicles_of_interest FOR EACH ROW EXECUTE FUNCTION public.trg_ops_review_from_voi()';
  END IF;
END $$;

COMMENT ON TABLE public.ops_live_plans IS
  'Live operational plans generated by Bob, assigned to organization/zone/site/office with field-staff visibility controls and review rules.';

COMMENT ON TABLE public.ops_live_plan_reviews IS
  'Auto-raised review events for live plans when incident, H&S, POI, or VOI activity is recorded by zone/location.';
