-- Ensure quick reports reliably notify admins and support authenticated in-app notification inserts

-- Notifications table is required by incident/report triggers and in-app notification UI.
CREATE TABLE IF NOT EXISTS public.notifications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  type          text        NOT NULL
                            CHECK (type IN (
                              'breach_alert',
                              'investigation_assigned',
                              'flagged_vehicle',
                              'welfare_alert',
                              'system_alert'
                            )),
  title         text        NOT NULL,
  body          text        NOT NULL,
  data          jsonb,
  priority      text        NOT NULL DEFAULT 'normal'
                            CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  read          boolean     NOT NULL DEFAULT false,
  read_at       timestamptz,
  delivered     boolean     NOT NULL DEFAULT false,
  delivered_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notifications IS
  'In-app and push notification records, one row per notification per user.';

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications (user_id, read)
  WHERE read = false;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
CREATE POLICY "notifications_delete_own"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_service_role_all" ON public.notifications;
CREATE POLICY "notifications_service_role_all"
  ON public.notifications FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "notifications_admins_select_org" ON public.notifications;
CREATE POLICY "notifications_admins_select_org"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = notifications.user_id
          AND up.organization_id = get_user_organization_id(auth.uid())
      )
    )
  );

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
