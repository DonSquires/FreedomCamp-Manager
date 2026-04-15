-- PTT Radio: independent 2-way radio system
-- Adds: callsign to user_profiles, ptt_channels table, ptt_transmission_log table
-- PTT is a standalone system with NO dependency on Team Chat.

-- ────────────────────────────────────────────────────────────
-- 1.  callsign on user_profiles
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS callsign text;

-- ────────────────────────────────────────────────────────────
-- 2.  ptt_channels — org-defined radio channels
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ptt_channels (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel_number   smallint     NOT NULL CHECK (channel_number BETWEEN 1 AND 99),
  name             text         NOT NULL,
  channel_type     text         NOT NULL CHECK (channel_type IN ('primary','dispatch','team','incident','welfare','admin','emergency')),
  description      text,
  color            text         NOT NULL DEFAULT '#3b82f6',
  is_priority      boolean      NOT NULL DEFAULT false,
  is_encrypted     boolean      NOT NULL DEFAULT false,
  allowed_roles    text[]       NOT NULL DEFAULT '{}',
  is_active        boolean      NOT NULL DEFAULT true,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (organization_id, channel_number)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ptt_channels'
      AND column_name = 'channel_number'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ptt_channels_org ON public.ptt_channels (organization_id, channel_number)';
  ELSE
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ptt_channels_org ON public.ptt_channels (organization_id)';
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 3.  ptt_transmission_log — history of radio transmissions
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ptt_transmission_log (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel_number    smallint     NOT NULL,
  channel_name      text         NOT NULL DEFAULT '',
  speaker_id        uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  speaker_name      text         NOT NULL DEFAULT '',
  speaker_callsign  text         NOT NULL DEFAULT '',
  duration_seconds  numeric(8,2) NOT NULL DEFAULT 0,
  is_emergency      boolean      NOT NULL DEFAULT false,
  created_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ptt_tx_log_org_created
  ON public.ptt_transmission_log (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ptt_tx_log_speaker
  ON public.ptt_transmission_log (speaker_id);

-- ────────────────────────────────────────────────────────────
-- 4.  Row-Level Security
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.ptt_channels         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ptt_transmission_log ENABLE ROW LEVEL SECURITY;

-- ptt_channels: all org members can read
DROP POLICY IF EXISTS ptt_channels_select  ON public.ptt_channels;
CREATE POLICY ptt_channels_select ON public.ptt_channels
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid() AND is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('master', 'grand_master')
    )
  );

-- ptt_channels: admin/master can insert/update/delete
DROP POLICY IF EXISTS ptt_channels_manage  ON public.ptt_channels;
CREATE POLICY ptt_channels_manage ON public.ptt_channels
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'admin_officer', 'master', 'grand_master')
        AND (up.organization_id = ptt_channels.organization_id OR up.role IN ('master', 'grand_master'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'admin_officer', 'master', 'grand_master')
        AND (up.organization_id = ptt_channels.organization_id OR up.role IN ('master', 'grand_master'))
    )
  );

-- ptt_transmission_log: all org members can read
DROP POLICY IF EXISTS ptt_tx_log_select  ON public.ptt_transmission_log;
CREATE POLICY ptt_tx_log_select ON public.ptt_transmission_log
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid() AND is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('master', 'grand_master')
    )
  );

-- ptt_transmission_log: speakers log their own transmissions
DROP POLICY IF EXISTS ptt_tx_log_insert  ON public.ptt_transmission_log;
CREATE POLICY ptt_tx_log_insert ON public.ptt_transmission_log
  FOR INSERT TO authenticated
  WITH CHECK (
    speaker_id = auth.uid()
    AND (
      organization_id IN (
        SELECT organization_id FROM public.user_profiles
        WHERE id = auth.uid() AND is_active = true
      )
      OR EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND role IN ('master', 'grand_master')
      )
    )
  );

-- ────────────────────────────────────────────────────────────
-- 5.  Seed default channels helper function
--     Called lazily in PTTRadio when no channels found for an org.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.seed_default_ptt_channels(p_organization_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ptt_channels'
      AND column_name = 'channel_number'
  ) THEN
    EXECUTE $sql$
      INSERT INTO public.ptt_channels (organization_id, channel_number, name, channel_type, color, is_priority, description)
      VALUES
        ($1, 1, 'All Units',          'primary',    '#3b82f6', false, 'Org-wide primary channel'),
        ($1, 2, 'Dispatch',           'dispatch',   '#f97316', false, 'Dispatch coordination'),
        ($1, 3, 'Operations',         'team',       '#22c55e', false, 'Operational team channel'),
        ($1, 4, 'Incident Primary',   'incident',   '#ef4444', false, 'Active incident response'),
        ($1, 5, 'Incident Secondary', 'incident',   '#dc2626', false, 'Secondary incident channel'),
        ($1, 6, 'Welfare Check',      'welfare',    '#a855f7', false, 'Officer welfare monitoring'),
        ($1, 7, 'Admin',              'admin',      '#6b7280', false, 'Administrative use only'),
        ($1, 9, 'EMERGENCY',          'emergency',  '#ff0000', true,  'All-call emergency broadcast')
      ON CONFLICT DO NOTHING
    $sql$
    USING p_organization_id;
  ELSE
    EXECUTE $sql$
      INSERT INTO public.ptt_channels (
        organization_id,
        channel_key,
        name,
        channel_type,
        description,
        is_active
      )
      VALUES
        ($1, 'org:' || $1::text || ':all-units',         'All Units',          'org',      'Org-wide primary channel', true),
        ($1, 'org:' || $1::text || ':dispatch',          'Dispatch',           'org',      'Dispatch coordination', true),
        ($1, 'org:' || $1::text || ':operations',        'Operations',         'org',      'Operational team channel', true),
        ($1, 'incident:' || $1::text || ':primary',      'Incident Primary',   'incident', 'Active incident response', true),
        ($1, 'incident:' || $1::text || ':secondary',    'Incident Secondary', 'incident', 'Secondary incident channel', true),
        ($1, 'org:' || $1::text || ':welfare',           'Welfare Check',      'org',      'Officer welfare monitoring', true),
        ($1, 'org:' || $1::text || ':admin',             'Admin',              'org',      'Administrative use only', true),
        ($1, 'org:' || $1::text || ':emergency',         'EMERGENCY',          'org',      'All-call emergency broadcast', true)
      ON CONFLICT DO NOTHING
    $sql$
    USING p_organization_id;
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 6.  Realtime publication for live presence in transmission log
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'ptt_transmission_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ptt_transmission_log;
  END IF;
END;
$$;
