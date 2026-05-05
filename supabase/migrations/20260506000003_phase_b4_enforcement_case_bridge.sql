-- Phase B4: Freedom Camping Enforcement — Case Model Bridge
-- Links breach_alerts to operational_cases so the enforcement timeline
-- can surface on the shared case backbone.

-- Add case_id back-reference to breach_alerts so an enforcement officer
-- can navigate directly from a breach to its linked operational case.
ALTER TABLE IF EXISTS public.breach_alerts
  ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES public.operational_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_breach_alerts_case_id
  ON public.breach_alerts(case_id)
  WHERE case_id IS NOT NULL;

-- Helper function: create an operational case from a breach alert.
-- Records the initial enforcement_initiated event automatically.
CREATE OR REPLACE FUNCTION public.create_case_from_breach_alert(
  p_breach_alert_id UUID,
  p_officer_id      UUID DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_case_id        UUID;
  v_org_id         UUID;
  v_plate          TEXT;
  v_zone_name      TEXT;
  v_officer_id     UUID;
BEGIN
  SELECT ba.organization_id, ba.plate_number, z.name
    INTO v_org_id, v_plate, v_zone_name
    FROM public.breach_alerts ba
    LEFT JOIN public.zones z ON z.id = ba.zone_id
   WHERE ba.id = p_breach_alert_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Breach alert % not found', p_breach_alert_id;
  END IF;

  -- Use explicit officer_id when provided (e.g. from service-role admin context),
  -- otherwise fall back to the calling user's auth.uid().
  v_officer_id := COALESCE(p_officer_id, auth.uid());

  -- Create the operational case
  INSERT INTO public.operational_cases (
    organization_id,
    case_type,
    created_from,
    title,
    created_by
  ) VALUES (
    v_org_id,
    'enforcement',
    'breach',
    'Enforcement: ' || COALESCE(v_plate, 'unknown') || ' — ' || COALESCE(v_zone_name, 'unknown zone'),
    v_officer_id
  )
  RETURNING id INTO v_case_id;

  -- Back-link the breach to the new case
  UPDATE public.breach_alerts
     SET case_id = v_case_id
   WHERE id = p_breach_alert_id;

  -- Create initial enforcement event
  INSERT INTO public.enforcement_events (
    organization_id,
    case_id,
    event_type,
    officer_id,
    subject_type,
    subject_identifier,
    created_by
  ) VALUES (
    v_org_id,
    v_case_id,
    'enforcement_initiated',
    v_officer_id,
    'vehicle',
    v_plate,
    v_officer_id
  );

  RETURN v_case_id;
END; $$;

COMMENT ON FUNCTION public.create_case_from_breach_alert(UUID, UUID) IS
  'Phase B4: Create operational case from breach alert and record initial enforcement event';
