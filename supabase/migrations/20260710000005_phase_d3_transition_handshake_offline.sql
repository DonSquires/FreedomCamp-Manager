-- ============================================================
-- Phase D3: Transition / Handshake / Offline-Reconnect hardening
-- ============================================================
-- Adds auditable offline replay conflict recording while reusing
-- existing active-org transition and hybrid workspace handshake contracts.

CREATE TABLE IF NOT EXISTS public.offline_replay_events_d3 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  replay_status TEXT NOT NULL CHECK (replay_status IN ('accepted', 'duplicate', 'rejected')),
  observation_id TEXT,
  source TEXT NOT NULL DEFAULT 'offline_queue',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offline_replay_events_d3_org_created
  ON public.offline_replay_events_d3(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_offline_replay_events_d3_idempotency
  ON public.offline_replay_events_d3(idempotency_key);

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
  (
    organization_id = public.get_user_organization_id(auth.uid())
    OR public.get_user_role(auth.uid()) IN ('master', 'grand_master')
  )
  AND replay_status IN ('accepted', 'duplicate', 'rejected')
);

CREATE OR REPLACE FUNCTION public.record_offline_replay_event_d3(
  p_organization_id UUID,
  p_idempotency_key TEXT,
  p_source TEXT DEFAULT 'offline_queue'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_observation RECORD;
  v_role TEXT;
  v_user_org UUID;
  v_status TEXT;
  v_event_id UUID;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id_required';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    v_role := public.get_user_role(auth.uid());
    v_user_org := public.get_user_organization_id(auth.uid());

    IF COALESCE(v_role, '') NOT IN ('master', 'grand_master')
      AND v_user_org IS DISTINCT FROM p_organization_id THEN
      RAISE EXCEPTION 'organization_scope_violation';
    END IF;
  END IF;

  SELECT o.id, o.observation_id
    INTO v_observation
  FROM public.observations o
  WHERE o.organization_id = p_organization_id
    AND o.idempotency_key = p_idempotency_key
  ORDER BY o.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_observation IS NULL THEN
    v_status := 'accepted';
  ELSE
    v_status := 'duplicate';
  END IF;

  INSERT INTO public.offline_replay_events_d3 (
    organization_id,
    idempotency_key,
    replay_status,
    observation_id,
    source,
    details
  )
  VALUES (
    p_organization_id,
    p_idempotency_key,
    v_status,
    COALESCE(v_observation.observation_id, v_observation.id),
    COALESCE(NULLIF(p_source, ''), 'offline_queue'),
    jsonb_build_object(
      'replay_conflict', (v_status = 'duplicate'),
      'recorded_by', COALESCE(auth.uid()::text, 'service_role')
    )
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'replay_event_id', v_event_id,
    'organization_id', p_organization_id,
    'idempotency_key', p_idempotency_key,
    'replay_status', v_status,
    'replay_conflict', (v_status = 'duplicate'),
    'observation_id', COALESCE(v_observation.observation_id, v_observation.id)
  );
END;
$$;

COMMENT ON FUNCTION public.record_offline_replay_event_d3(UUID, TEXT, TEXT)
IS 'Phase D3: Records offline replay attempts and returns bounded duplicate/accepted outcomes by organization + idempotency key.';

GRANT EXECUTE ON FUNCTION public.record_offline_replay_event_d3(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_offline_replay_event_d3(UUID, TEXT, TEXT) TO service_role;
