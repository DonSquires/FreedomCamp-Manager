-- Approval workflow for external intel + public safety alerting banners.
-- Approval actions are restricted to master / grand_master roles.

ALTER TABLE public.external_intel_bulletins
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_notes TEXT,
  ADD COLUMN IF NOT EXISTS poi_candidate JSONB,
  ADD COLUMN IF NOT EXISTS voi_candidate JSONB;

CREATE INDEX IF NOT EXISTS idx_external_intel_approval_status
  ON public.external_intel_bulletins(approval_status);

DO $$ BEGIN
  DROP POLICY IF EXISTS "external_intel_org_write" ON public.external_intel_bulletins;
  CREATE POLICY "external_intel_org_write"
    ON public.external_intel_bulletins FOR INSERT
    TO authenticated
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
  DROP POLICY IF EXISTS "external_intel_master_update" ON public.external_intel_bulletins;
  CREATE POLICY "external_intel_master_update"
    ON public.external_intel_bulletins FOR UPDATE
    TO authenticated
    USING (get_user_role(auth.uid()) IN ('master','grand_master'))
    WITH CHECK (get_user_role(auth.uid()) IN ('master','grand_master'));
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "external_intel_master_delete" ON public.external_intel_bulletins;
  CREATE POLICY "external_intel_master_delete"
    ON public.external_intel_bulletins FOR DELETE
    TO authenticated
    USING (get_user_role(auth.uid()) IN ('master','grand_master'));
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.public_safety_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  source_bulletin_id UUID REFERENCES public.external_intel_bulletins(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','resolved','rejected')),
  event_type TEXT NOT NULL DEFAULT 'other'
    CHECK (event_type IN ('amber_alert','active_shooter','national_security','civil_defense','severe_weather','emergency_alert','other')),
  severity TEXT NOT NULL DEFAULT 'high' CHECK (severity IN ('medium','high','critical')),
  scope TEXT NOT NULL DEFAULT 'regional' CHECK (scope IN ('regional','national')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target_organization_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  target_region_tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approval_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_public_safety_alerts_status ON public.public_safety_alerts(status);
CREATE INDEX IF NOT EXISTS idx_public_safety_alerts_scope ON public.public_safety_alerts(scope);
CREATE INDEX IF NOT EXISTS idx_public_safety_alerts_starts_at ON public.public_safety_alerts(starts_at DESC);

ALTER TABLE public.public_safety_alerts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "public_safety_alerts_active_read" ON public.public_safety_alerts;
  CREATE POLICY "public_safety_alerts_active_read"
    ON public.public_safety_alerts FOR SELECT
    TO authenticated
    USING (
      status = 'active'
      AND (
        scope = 'national'
        OR get_user_role(auth.uid()) IN ('master', 'grand_master')
        OR EXISTS (
          SELECT 1
          FROM unnest(target_organization_ids) target_org_id
          WHERE target_org_id = ANY(get_user_organization_ids())
        )
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "public_safety_alerts_master_all" ON public.public_safety_alerts;
  CREATE POLICY "public_safety_alerts_master_all"
    ON public.public_safety_alerts FOR ALL
    TO authenticated
    USING (get_user_role(auth.uid()) IN ('master', 'grand_master'))
    WITH CHECK (get_user_role(auth.uid()) IN ('master', 'grand_master'));
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "service_role_all_public_safety_alerts" ON public.public_safety_alerts;
  CREATE POLICY "service_role_all_public_safety_alerts"
    ON public.public_safety_alerts FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.trg_public_safety_alerts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_public_safety_alerts_updated_at ON public.public_safety_alerts;
CREATE TRIGGER set_public_safety_alerts_updated_at
  BEFORE UPDATE ON public.public_safety_alerts
  FOR EACH ROW EXECUTE FUNCTION public.trg_public_safety_alerts_updated_at();

CREATE TABLE IF NOT EXISTS public.public_safety_alert_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES public.public_safety_alerts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(alert_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_public_safety_ack_alert_id
  ON public.public_safety_alert_acknowledgements(alert_id);

ALTER TABLE public.public_safety_alert_acknowledgements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "public_safety_ack_self" ON public.public_safety_alert_acknowledgements;
  CREATE POLICY "public_safety_ack_self"
    ON public.public_safety_alert_acknowledgements FOR ALL
    TO authenticated
    USING (user_id = auth.uid() OR get_user_role(auth.uid()) IN ('master', 'grand_master'))
    WITH CHECK (user_id = auth.uid() OR get_user_role(auth.uid()) IN ('master', 'grand_master'));
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "service_role_all_public_safety_ack" ON public.public_safety_alert_acknowledgements;
  CREATE POLICY "service_role_all_public_safety_ack"
    ON public.public_safety_alert_acknowledgements FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.approve_public_safety_alert(
  p_alert_id UUID,
  p_decision TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS public.public_safety_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_status TEXT;
  v_row public.public_safety_alerts;
BEGIN
  v_role := get_user_role(auth.uid());
  IF v_role NOT IN ('master', 'grand_master') THEN
    RAISE EXCEPTION 'Only master or grand_master can approve safety alerts';
  END IF;

  v_status := CASE
    WHEN lower(p_decision) IN ('approve', 'approved', 'activate') THEN 'active'
    WHEN lower(p_decision) IN ('reject', 'rejected', 'deny') THEN 'rejected'
    ELSE NULL
  END;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Invalid decision. Use approve|reject';
  END IF;

  UPDATE public.public_safety_alerts
  SET status = v_status,
      approved_by = auth.uid(),
      approved_at = now(),
      approval_notes = p_note
  WHERE id = p_alert_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Alert not found: %', p_alert_id;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_public_safety_alert(UUID, TEXT, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_external_intel_bulletin(
  p_bulletin_id UUID,
  p_decision TEXT,
  p_note TEXT DEFAULT NULL,
  p_promote_poi_voi BOOLEAN DEFAULT true,
  p_global_poi_voi BOOLEAN DEFAULT true
)
RETURNS public.external_intel_bulletins
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_status TEXT;
  v_row public.external_intel_bulletins;
  v_name TEXT;
  v_plate TEXT;
BEGIN
  v_role := get_user_role(auth.uid());
  IF v_role NOT IN ('master', 'grand_master') THEN
    RAISE EXCEPTION 'Only master or grand_master can approve external intel bulletins';
  END IF;

  v_status := CASE
    WHEN lower(p_decision) IN ('approve', 'approved') THEN 'approved'
    WHEN lower(p_decision) IN ('reject', 'rejected', 'deny') THEN 'rejected'
    ELSE NULL
  END;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Invalid decision. Use approve|reject';
  END IF;

  UPDATE public.external_intel_bulletins
  SET approval_status = v_status,
      approved_by = auth.uid(),
      approved_at = now(),
      approval_notes = p_note
  WHERE id = p_bulletin_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Bulletin not found: %', p_bulletin_id;
  END IF;

  IF v_status = 'approved' AND p_promote_poi_voi THEN
    v_name := COALESCE(v_row.poi_candidate->>'full_name', NULL);
    v_plate := COALESCE(v_row.voi_candidate->>'plate_number', NULL);

    IF v_name IS NOT NULL THEN
      IF p_global_poi_voi THEN
        INSERT INTO public.persons_of_interest (organization_id, full_name, status, reason, notes, active, created_by)
        SELECT o.id, v_name, 'poi', v_row.title, v_row.summary, true, auth.uid()
        FROM public.organizations o
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.persons_of_interest p
          WHERE p.organization_id = o.id
            AND lower(p.full_name) = lower(v_name)
            AND p.active = true
        );
      ELSE
        INSERT INTO public.persons_of_interest (organization_id, full_name, status, reason, notes, active, created_by)
        VALUES (v_row.organization_id, v_name, 'poi', v_row.title, v_row.summary, true, auth.uid());
      END IF;
    END IF;

    IF v_plate IS NOT NULL THEN
      IF p_global_poi_voi THEN
        INSERT INTO public.vehicles_of_interest (organization_id, plate_number, status, reason, notes, active, created_by)
        SELECT o.id, v_plate, 'voi', v_row.title, v_row.summary, true, auth.uid()
        FROM public.organizations o
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.vehicles_of_interest v
          WHERE v.organization_id = o.id
            AND upper(v.plate_number) = upper(v_plate)
            AND v.active = true
        );
      ELSE
        INSERT INTO public.vehicles_of_interest (organization_id, plate_number, status, reason, notes, active, created_by)
        VALUES (v_row.organization_id, v_plate, 'voi', v_row.title, v_row.summary, true, auth.uid());
      END IF;
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_external_intel_bulletin(UUID, TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated, service_role;

COMMENT ON TABLE public.public_safety_alerts IS
  'Location-aware public safety alerts requiring acknowledgment in UI banners.';
