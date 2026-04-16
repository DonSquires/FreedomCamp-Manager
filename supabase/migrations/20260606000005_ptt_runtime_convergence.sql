-- PTT runtime convergence
-- Ensures required PTT objects exist and refreshes PostgREST schema cache.

-- 1) ptt_transmission_log table (best-effort create)
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

ALTER TABLE public.ptt_transmission_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ptt_tx_log_select ON public.ptt_transmission_log;
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

DROP POLICY IF EXISTS ptt_tx_log_insert ON public.ptt_transmission_log;
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

-- 2) Seed default channels function
CREATE OR REPLACE FUNCTION public.seed_default_ptt_channels(p_organization_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.ptt_channels (organization_id, channel_number, name, channel_type, color, is_priority, description)
  VALUES
    (p_organization_id, 1, 'All Units',          'primary',    '#3b82f6', false, 'Org-wide primary channel'),
    (p_organization_id, 2, 'Dispatch',            'dispatch',   '#f97316', false, 'Dispatch coordination'),
    (p_organization_id, 3, 'Operations',          'team',       '#22c55e', false, 'Operational team channel'),
    (p_organization_id, 4, 'Incident Primary',    'incident',   '#ef4444', false, 'Active incident response'),
    (p_organization_id, 5, 'Incident Secondary',  'incident',   '#dc2626', false, 'Secondary incident channel'),
    (p_organization_id, 6, 'Welfare Check',       'welfare',    '#a855f7', false, 'Officer welfare monitoring'),
    (p_organization_id, 7, 'Admin',               'admin',      '#6b7280', false, 'Administrative use only'),
    (p_organization_id, 9, 'EMERGENCY',           'emergency',  '#ff0000', true,  'All-call emergency broadcast')
  ON CONFLICT (organization_id, channel_number) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_default_ptt_channels(uuid) TO authenticated;

-- 3) Ensure realtime publication includes tx log
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

-- 4) Ensure storage bucket for clip fallback exists
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ptt-clips',
  'ptt-clips',
  false,
  10485760,
  ARRAY['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/mp4']
)
ON CONFLICT (id) DO NOTHING;

-- 5) Bucket policies (idempotent)
DROP POLICY IF EXISTS ptt_clips_select_authenticated ON storage.objects;
CREATE POLICY ptt_clips_select_authenticated ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'ptt-clips');

DROP POLICY IF EXISTS ptt_clips_insert_authenticated ON storage.objects;
CREATE POLICY ptt_clips_insert_authenticated ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ptt-clips');

-- 6) Force schema cache reload so PostgREST sees newly created objects immediately.
NOTIFY pgrst, 'reload schema';
