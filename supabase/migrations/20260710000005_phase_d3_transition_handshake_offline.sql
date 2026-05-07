-- ============================================================================
-- Phase D3: Transition / Handshake / Offline Replay Gate Contracts
-- Date: 2026-05-07
--
-- Adds bounded offline replay outcomes with org + idempotency dedupe semantics.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.offline_replay_events_d3 (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key   TEXT        NOT NULL,
  source            TEXT        NOT NULL DEFAULT 'offline_queue',
  replay_status     TEXT        NOT NULL DEFAULT 'accepted'
    CHECK (replay_status IN ('accepted', 'duplicate')),
  replay_attempts   INTEGER     NOT NULL DEFAULT 1 CHECK (replay_attempts >= 1),
  first_replayed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_replayed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_offline_replay_events_d3_org_last
  ON public.offline_replay_events_d3(organization_id, last_replayed_at DESC);

CREATE INDEX IF NOT EXISTS idx_offline_replay_events_d3_source
  ON public.offline_replay_events_d3(source, last_replayed_at DESC);

ALTER TABLE public.offline_replay_events_d3 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "offline_replay_events_d3_select" ON public.offline_replay_events_d3;
CREATE POLICY "offline_replay_events_d3_select"
ON public.offline_replay_events_d3
FOR SELECT
TO authenticated
USING (
  organization_id = public.get_user_organization_id(auth.uid())
  OR public.get_user_role(auth.uid()) IN ('master', 'grand_master')
);

DROP POLICY IF EXISTS "offline_replay_events_d3_insert" ON public.offline_replay_events_d3;
CREATE POLICY "offline_replay_events_d3_insert"
ON public.offline_replay_events_d3
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id = public.get_user_organization_id(auth.uid())
  OR public.get_user_role(auth.uid()) IN ('master', 'grand_master')
);

DROP POLICY IF EXISTS "offline_replay_events_d3_update" ON public.offline_replay_events_d3;
CREATE POLICY "offline_replay_events_d3_update"
ON public.offline_replay_events_d3
FOR UPDATE
TO authenticated
USING (
  organization_id = public.get_user_organization_id(auth.uid())
  OR public.get_user_role(auth.uid()) IN ('master', 'grand_master')
)
WITH CHECK (
  organization_id = public.get_user_organization_id(auth.uid())
  OR public.get_user_role(auth.uid()) IN ('master', 'grand_master')
);

GRANT SELECT, INSERT, UPDATE ON public.offline_replay_events_d3 TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.offline_replay_events_d3 TO service_role;

CREATE OR REPLACE FUNCTION public.record_offline_replay_event_d3(
  p_organization_id UUID,
  p_idempotency_key TEXT,
  p_source TEXT DEFAULT 'offline_queue'
)
RETURNS TABLE(
  replay_status TEXT,
  replay_conflict BOOLEAN,
  replay_event_id UUID,
  replay_attempts INTEGER,
  first_replayed_at TIMESTAMPTZ,
  last_replayed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.offline_replay_events_d3%ROWTYPE;
BEGIN
  INSERT INTO public.offline_replay_events_d3 (
    organization_id,
    idempotency_key,
    source,
    replay_status,
    replay_attempts,
    first_replayed_at,
    last_replayed_at,
    updated_at
  )
  VALUES (
    p_organization_id,
    p_idempotency_key,
    COALESCE(NULLIF(trim(p_source), ''), 'offline_queue'),
    'accepted',
    1,
    now(),
    now(),
    now()
  )
  ON CONFLICT (organization_id, idempotency_key)
  DO UPDATE SET
    replay_status = 'duplicate',
    replay_attempts = public.offline_replay_events_d3.replay_attempts + 1,
    source = COALESCE(NULLIF(trim(EXCLUDED.source), ''), 'offline_queue'),
    last_replayed_at = now(),
    updated_at = now()
  RETURNING * INTO v_event;

  replay_status := v_event.replay_status;
  replay_conflict := (v_event.replay_status = 'duplicate');
  replay_event_id := v_event.id;
  replay_attempts := v_event.replay_attempts;
  first_replayed_at := v_event.first_replayed_at;
  last_replayed_at := v_event.last_replayed_at;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.record_offline_replay_event_d3(UUID, TEXT, TEXT)
IS 'Records D3 offline replay attempts and returns bounded replay outcomes (accepted/duplicate) scoped by org + idempotency key.';

GRANT EXECUTE ON FUNCTION public.record_offline_replay_event_d3(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_offline_replay_event_d3(UUID, TEXT, TEXT) TO service_role;
