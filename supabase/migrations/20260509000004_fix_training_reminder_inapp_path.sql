-- Fix in-app reminder path by correcting notifications table INSERT
-- The notifications table does not have an organization_id column

CREATE OR REPLACE FUNCTION public.send_training_assignment_reminder(
  p_assignment_id UUID,
  p_reminder_type TEXT DEFAULT 'in_app',
  p_message TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT auth.uid()
)
RETURNS TABLE(
  reminder_id UUID,
  assignment_id UUID,
  officer_id UUID,
  reminder_type TEXT,
  message TEXT,
  sent_at TIMESTAMPTZ,
  delivery_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_org UUID;
  v_actor_role TEXT;
  v_assignment RECORD;
  v_reminder_type TEXT;
  v_message TEXT;
  v_delivery_status TEXT := 'queued';
  v_delivery_provider TEXT := NULL;
  v_reminder_id UUID;
  v_sent_at TIMESTAMPTZ;
  v_dispatch_url TEXT;
  v_dispatch_headers JSONB;
  v_dispatch_body JSONB;
BEGIN
  SELECT up.organization_id, up.role
  INTO v_actor_org, v_actor_role
  FROM public.user_profiles up
  WHERE up.id = p_actor_id;

  IF v_actor_org IS NULL THEN
    RAISE EXCEPTION 'Actor user profile not found';
  END IF;

  SELECT ta.*
  INTO v_assignment
  FROM public.training_assignments ta
  WHERE ta.id = p_assignment_id
    AND ta.organization_id = v_actor_org;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Training assignment not found for this organization';
  END IF;

  IF v_actor_role NOT IN ('admin', 'admin_officer', 'master', 'grand_master') THEN
    RAISE EXCEPTION 'Not allowed to send assignment reminders';
  END IF;

  v_reminder_type := lower(COALESCE(NULLIF(btrim(p_reminder_type), ''), 'in_app'));
  IF v_reminder_type NOT IN ('in_app', 'email', 'sms', 'escalation') THEN
    v_reminder_type := 'in_app';
  END IF;

  v_message := NULLIF(btrim(COALESCE(p_message, '')), '');
  IF v_message IS NULL THEN
    v_message := format(
      'Training reminder: complete "%s"%s.',
      COALESCE(v_assignment.title, 'assigned training'),
      CASE
        WHEN v_assignment.due_at IS NOT NULL THEN format(' by %s', to_char(v_assignment.due_at AT TIME ZONE 'Pacific/Auckland', 'DD Mon YYYY HH24:MI NZST'))
        ELSE ''
      END
    );
  END IF;

  IF v_reminder_type = 'in_app' THEN
    v_delivery_status := 'sent';
    v_delivery_provider := 'in_app';
  ELSIF v_reminder_type = 'email' THEN
    v_delivery_provider := 'smtp';
  ELSIF v_reminder_type = 'sms' THEN
    v_delivery_provider := 'sms_webhook';
  ELSE
    v_delivery_provider := 'escalation';
  END IF;

  INSERT INTO public.training_assignment_reminders (
    organization_id,
    assignment_id,
    officer_id,
    reminder_type,
    message,
    delivery_status,
    delivery_provider,
    sent_by,
    sent_at,
    delivered_at
  ) VALUES (
    v_actor_org,
    v_assignment.id,
    v_assignment.officer_id,
    v_reminder_type,
    v_message,
    v_delivery_status,
    v_delivery_provider,
    p_actor_id,
    now(),
    CASE WHEN v_delivery_status = 'sent' THEN now() ELSE NULL END
  )
  RETURNING id, training_assignment_reminders.sent_at
  INTO v_reminder_id, v_sent_at;

  IF v_reminder_type <> 'in_app' THEN
    v_dispatch_url := current_setting('app.supabase_url', true);

    IF v_dispatch_url IS NOT NULL AND btrim(v_dispatch_url) <> '' THEN
      v_dispatch_headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)
      );

      v_dispatch_body := jsonb_build_object(
        'reminder_id', v_reminder_id,
        'organization_id', v_actor_org,
        'assignment_id', v_assignment.id,
        'officer_id', v_assignment.officer_id,
        'channel', v_reminder_type,
        'message', v_message,
        'sent_by', p_actor_id,
        'sent_at', v_sent_at
      );

      PERFORM net.http_post(
        url := v_dispatch_url || '/functions/v1/dispatch-training-reminder',
        headers := v_dispatch_headers,
        body := v_dispatch_body
      );
    END IF;
  ELSE
    INSERT INTO public.notifications (
      user_id,
      type,
      title,
      body,
      priority,
      data,
      delivered,
      delivered_at,
      read,
      read_at,
      created_at
    ) VALUES (
      v_assignment.officer_id,
      'system_alert',
      'Training Reminder',
      v_message,
      CASE WHEN v_assignment.status = 'overdue' THEN 'high' ELSE 'normal' END,
      jsonb_build_object(
        'source', 'training_assignment_reminder',
        'assignment_id', v_assignment.id,
        'reminder_id', v_reminder_id,
        'reminder_type', v_reminder_type
      ),
      true,
      now(),
      false,
      NULL,
      now()
    );
  END IF;

  reminder_id := v_reminder_id;
  assignment_id := v_assignment.id;
  officer_id := v_assignment.officer_id;
  reminder_type := v_reminder_type;
  message := v_message;
  sent_at := v_sent_at;
  delivery_status := v_delivery_status;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.send_training_assignment_reminder(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_training_assignment_reminder(UUID, TEXT, TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION public.send_training_assignment_reminder(UUID, TEXT, TEXT, UUID) IS
  'Creates an auditable reminder record for a training assignment and dispatches in-app/email/sms reminder delivery.';
