-- Ensure quick reports reliably notify admins and support authenticated in-app notification inserts

-- Officers/admins can insert notifications for users in their own organisation.
DROP POLICY IF EXISTS "notifications_insert_same_org" ON public.notifications;
CREATE POLICY "notifications_insert_same_org"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role(auth.uid()) = ANY (ARRAY['officer', 'admin', 'admin_officer', 'master', 'grand_master'])
    AND EXISTS (
      SELECT 1
      FROM public.user_profiles sender
      JOIN public.user_profiles recipient ON recipient.id = notifications.user_id
      WHERE sender.id = auth.uid()
        AND (
          get_user_role(auth.uid()) = ANY (ARRAY['master', 'grand_master'])
          OR sender.organization_id = recipient.organization_id
        )
    )
  );

-- Create admin notifications whenever a new incident is submitted.
CREATE OR REPLACE FUNCTION public.notify_admins_on_new_incident()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_zone_id uuid;
  v_reporter_id uuid;
  v_reporter_name text;
  v_severity text;
  v_incident_type text;
  v_plate text;
  v_title text;
  v_body text;
BEGIN
  v_org_id := (to_jsonb(NEW)->>'organization_id')::uuid;
  v_zone_id := (to_jsonb(NEW)->>'zone_id')::uuid;
  v_reporter_id := COALESCE(
    NULLIF(to_jsonb(NEW)->>'reported_by', '')::uuid,
    NULLIF(to_jsonb(NEW)->>'user_id', '')::uuid
  );
  v_severity := LOWER(COALESCE(NULLIF(to_jsonb(NEW)->>'severity', ''), 'medium'));
  v_incident_type := COALESCE(NULLIF(to_jsonb(NEW)->>'incident_type', ''), 'incident');
  v_plate := NULLIF(to_jsonb(NEW)->>'plate_number', '');

  SELECT COALESCE(full_name, 'Officer')
  INTO v_reporter_name
  FROM public.user_profiles
  WHERE id = v_reporter_id;

  IF v_incident_type = 'Maintenance Report' THEN
    v_title := 'New maintenance report submitted';
    v_body := format('%s submitted a maintenance report%s.',
      COALESCE(v_reporter_name, 'Officer'),
      CASE WHEN v_plate IS NOT NULL THEN format(' for plate %s', v_plate) ELSE '' END
    );
  ELSE
    v_title := 'New incident report submitted';
    v_body := format('%s submitted a %s incident%s.',
      COALESCE(v_reporter_name, 'Officer'),
      v_severity,
      CASE WHEN v_plate IS NOT NULL THEN format(' for plate %s', v_plate) ELSE '' END
    );
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data, priority)
  SELECT up.id,
         'system_alert',
         v_title,
         v_body,
         jsonb_build_object(
           'source_table', 'incidents',
           'report_id', NEW.id,
           'organization_id', v_org_id,
           'zone_id', v_zone_id,
           'severity', v_severity,
           'incident_type', v_incident_type
         ),
         CASE WHEN v_severity IN ('high', 'critical') THEN 'high' ELSE 'normal' END
  FROM public.user_profiles up
  WHERE up.is_active = true
    AND (up.role = ANY (ARRAY['admin', 'admin_officer', 'master', 'grand_master']) OR up.id = v_reporter_id)
    AND (
      up.role = ANY (ARRAY['master', 'grand_master'])
      OR up.organization_id = v_org_id
    );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_admins_on_new_incident failed for incident %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_incidents_notify_admins ON public.incidents;
CREATE TRIGGER trg_incidents_notify_admins
  AFTER INSERT ON public.incidents
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admins_on_new_incident();

-- Create admin notifications whenever a new health & safety report is submitted.
CREATE OR REPLACE FUNCTION public.notify_admins_on_new_hs_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_zone_id uuid;
  v_reporter_id uuid;
  v_reporter_name text;
  v_severity text;
  v_title text;
  v_body text;
BEGIN
  v_org_id := (to_jsonb(NEW)->>'organization_id')::uuid;
  v_zone_id := (to_jsonb(NEW)->>'zone_id')::uuid;
  v_reporter_id := NULLIF(to_jsonb(NEW)->>'reported_by', '')::uuid;
  v_severity := LOWER(COALESCE(NULLIF(to_jsonb(NEW)->>'severity', ''), 'medium'));

  SELECT COALESCE(full_name, 'Officer')
  INTO v_reporter_name
  FROM public.user_profiles
  WHERE id = v_reporter_id;

  v_title := 'New H&S report submitted';
  v_body := format('%s submitted a %s severity H&S report.',
    COALESCE(v_reporter_name, 'Officer'),
    v_severity
  );

  INSERT INTO public.notifications (user_id, type, title, body, data, priority)
  SELECT up.id,
         'system_alert',
         v_title,
         v_body,
         jsonb_build_object(
           'source_table', 'health_safety_reports',
           'report_id', NEW.id,
           'organization_id', v_org_id,
           'zone_id', v_zone_id,
           'severity', v_severity
         ),
         CASE WHEN v_severity IN ('high', 'critical') THEN 'high' ELSE 'normal' END
  FROM public.user_profiles up
  WHERE up.is_active = true
    AND (up.role = ANY (ARRAY['admin', 'admin_officer', 'master', 'grand_master']) OR up.id = v_reporter_id)
    AND (
      up.role = ANY (ARRAY['master', 'grand_master'])
      OR up.organization_id = v_org_id
    );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_admins_on_new_hs_report failed for report %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hs_reports_notify_admins ON public.health_safety_reports;
CREATE TRIGGER trg_hs_reports_notify_admins
  AFTER INSERT ON public.health_safety_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admins_on_new_hs_report();
