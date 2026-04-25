-- ============================================================================
-- Add missing tables and columns identified during Supabase DB push audit
-- Date: 2026-03-15
--
-- Changes:
--   1. user_profiles  – add bio, emergency_contact_name, emergency_contact_phone,
--                       profile_photo_url
--   2. notifications  – in-app / push notification records
--   3. user_sessions  – active session tracking (Profile page)
--   4. restrictions   – spatial compliance restriction zones (GeoJSON upload)
-- ============================================================================

-- ── 1. user_profiles – additional profile columns ───────────────────────────

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS bio                     TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS profile_photo_url       TEXT;

COMMENT ON COLUMN public.user_profiles.bio                     IS 'Optional short biography or role description for the officer';
COMMENT ON COLUMN public.user_profiles.emergency_contact_name  IS 'Name of emergency contact person';
COMMENT ON COLUMN public.user_profiles.emergency_contact_phone IS 'Phone number of emergency contact person';
COMMENT ON COLUMN public.user_profiles.profile_photo_url       IS 'URL to the user profile photo in storage';

-- ── 2. notifications table ───────────────────────────────────────────────────

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
  'In-app and push notification records, one row per notification per user. '
  'Consumed by useNotifications hook and the send-push-notification Edge Function.';

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications (user_id, read)
  WHERE read = false;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can update (mark read) their own notifications
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- Users can delete their own notifications
DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
CREATE POLICY "notifications_delete_own"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Service role can insert and manage all notifications (Edge Functions)
DROP POLICY IF EXISTS "notifications_service_role_all" ON public.notifications;
CREATE POLICY "notifications_service_role_all"
  ON public.notifications FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Admins can view notifications within their organization
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

-- ── 3. user_sessions table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  device_name      text,
  device_platform  text,
  ip_address       text,
  last_seen_at     timestamptz DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_sessions IS
  'Active session records for users. Displayed in the Profile page under '
  '"Active Sessions". Updated by the client on each authenticated request.';

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
  ON public.user_sessions (user_id, last_seen_at DESC);

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- Users can read their own sessions
DROP POLICY IF EXISTS "user_sessions_select_own" ON public.user_sessions;
CREATE POLICY "user_sessions_select_own"
  ON public.user_sessions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can insert their own sessions
DROP POLICY IF EXISTS "user_sessions_insert_own" ON public.user_sessions;
CREATE POLICY "user_sessions_insert_own"
  ON public.user_sessions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can update their own sessions (e.g. last_seen_at)
DROP POLICY IF EXISTS "user_sessions_update_own" ON public.user_sessions;
CREATE POLICY "user_sessions_update_own"
  ON public.user_sessions FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- Users can delete (revoke) their own sessions
DROP POLICY IF EXISTS "user_sessions_delete_own" ON public.user_sessions;
CREATE POLICY "user_sessions_delete_own"
  ON public.user_sessions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Service role full access
DROP POLICY IF EXISTS "user_sessions_service_role_all" ON public.user_sessions;
CREATE POLICY "user_sessions_service_role_all"
  ON public.user_sessions FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ── 4. restrictions table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.restrictions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  restriction_type text        NOT NULL DEFAULT 'prohibited'
                               CHECK (restriction_type IN (
                                 'prohibited',
                                 'self_contained',
                                 'day_use',
                                 'permit_required'
                               )),
  geom             geometry(GEOMETRY, 4326),
  meta_data        jsonb       NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.restrictions IS
  'Spatial compliance restriction zones uploaded via GeoJSON. '
  'restriction_type controls what type of freedom camping restriction applies. '
  'geom stores the PostGIS polygon/multipolygon for geospatial queries.';

COMMENT ON COLUMN public.restrictions.restriction_type IS
  'prohibited=no freedom camping; self_contained=self-contained vehicles only; '
  'day_use=day use only (no overnight); permit_required=permit needed';

CREATE INDEX IF NOT EXISTS idx_restrictions_organization_id
  ON public.restrictions (organization_id);

CREATE INDEX IF NOT EXISTS idx_restrictions_geom
  ON public.restrictions USING GIST (geom);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.trg_fn_restrictions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_restrictions_updated_at ON public.restrictions;
CREATE TRIGGER trg_restrictions_updated_at
  BEFORE UPDATE ON public.restrictions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_restrictions_updated_at();

ALTER TABLE public.restrictions ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read restrictions (needed for map display)
DROP POLICY IF EXISTS "restrictions_select_authenticated" ON public.restrictions;
CREATE POLICY "restrictions_select_authenticated"
  ON public.restrictions FOR SELECT
  TO authenticated
  USING (true);

-- Admins and above can insert restrictions
DROP POLICY IF EXISTS "restrictions_insert_admins" ON public.restrictions;
CREATE POLICY "restrictions_insert_admins"
  ON public.restrictions FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- Admins and above can update restrictions within their org
DROP POLICY IF EXISTS "restrictions_update_admins" ON public.restrictions;
CREATE POLICY "restrictions_update_admins"
  ON public.restrictions FOR UPDATE
  TO authenticated
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- Admins and above can delete restrictions within their org
DROP POLICY IF EXISTS "restrictions_delete_admins" ON public.restrictions;
CREATE POLICY "restrictions_delete_admins"
  ON public.restrictions FOR DELETE
  TO authenticated
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = get_user_organization_id(auth.uid())
    )
  );

-- Service role full access
DROP POLICY IF EXISTS "restrictions_service_role_all" ON public.restrictions;
CREATE POLICY "restrictions_service_role_all"
  ON public.restrictions FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ── 5. Verification ──────────────────────────────────────────────────────────

DO $$
DECLARE
  v_col_count    integer;
  v_notif_count  integer;
  v_sess_count   integer;
  v_restr_count  integer;
BEGIN
  -- Check user_profiles extra columns
  SELECT count(*) INTO v_col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'user_profiles'
    AND column_name  IN ('bio', 'emergency_contact_name', 'emergency_contact_phone', 'profile_photo_url');

  -- Check table existence
  SELECT count(*) INTO v_notif_count
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'notifications';

  SELECT count(*) INTO v_sess_count
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'user_sessions';

  SELECT count(*) INTO v_restr_count
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'restrictions';

  RAISE NOTICE '';
  RAISE NOTICE '✅ 20260315_missing_tables_and_columns complete';
  RAISE NOTICE '   user_profiles extra columns present: % / 4', v_col_count;
  RAISE NOTICE '   notifications table: %', CASE WHEN v_notif_count = 1 THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '   user_sessions table: %', CASE WHEN v_sess_count  = 1 THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '   restrictions table:  %', CASE WHEN v_restr_count = 1 THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '';
END;
$$;
