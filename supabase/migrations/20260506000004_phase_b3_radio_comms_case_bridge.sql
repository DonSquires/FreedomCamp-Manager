-- Phase B3: Communications — Radio Comms Case Bridge
-- Records callsign binding and dispatch-to-radio escalation events on the
-- shared case backbone, enabling the unified operational timeline to surface
-- PTT/radio activity alongside patrol and dispatch events.

-- ============================================================================
-- PART 1: radio_comms_events table
-- Captures callsign binding, dispatch-to-radio escalation, and radio degraded-
-- mode state per operational case.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.radio_comms_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id           UUID        NOT NULL REFERENCES public.operational_cases(id) ON DELETE CASCADE,

  -- Officer whose callsign is being recorded
  officer_id        UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  -- Callsign active at this moment (e.g. "CCIR-01")
  callsign          TEXT,

  -- PTT channel scope this event relates to
  -- Mirrors ptt-signaling-token channelScope: 'org:<uuid>' | 'incident:<uuid>' | 'direct:<uuid>'
  channel_scope     TEXT,

  -- Lifecycle event type
  event_type        TEXT        NOT NULL
    CHECK (event_type IN (
      'radio_callsign_bound',        -- officer callsign resolved and bound to this case
      'dispatch_escalated_to_radio', -- dispatch console escalated the job to PTT radio
      'radio_degraded_mode',         -- PTT unavailable; radio comms in degraded fallback
      'radio_channel_left'           -- officer left the active radio channel for this case
    )),

  -- When true the event represents a degraded / fallback comms state.
  -- Case remains open; the timeline shows the gap in radio coverage.
  degraded_mode     BOOLEAN     NOT NULL DEFAULT false,

  -- Optional PTT session identifier from ptt-signaling-token for correlation
  ptt_session_id    TEXT,

  notes             TEXT,

  event_timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.radio_comms_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_org_radio_comms_events" ON public.radio_comms_events;
CREATE POLICY "users_read_own_org_radio_comms_events"
  ON public.radio_comms_events FOR SELECT
  USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "users_manage_own_org_radio_comms_events" ON public.radio_comms_events;
CREATE POLICY "users_manage_own_org_radio_comms_events"
  ON public.radio_comms_events FOR ALL
  USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Primary lookup: events for a case in chronological order
CREATE INDEX IF NOT EXISTS idx_radio_comms_events_case_id
  ON public.radio_comms_events(case_id, event_timestamp DESC);

-- Find all radio events for an officer across cases
CREATE INDEX IF NOT EXISTS idx_radio_comms_events_officer_org
  ON public.radio_comms_events(officer_id, organization_id);

-- Org-scoped recency feed used by the command console
CREATE INDEX IF NOT EXISTS idx_radio_comms_events_org_timestamp
  ON public.radio_comms_events(organization_id, event_timestamp DESC);

-- Partial index: quickly surface all degraded-mode events for monitoring
CREATE INDEX IF NOT EXISTS idx_radio_comms_events_degraded
  ON public.radio_comms_events(organization_id, event_timestamp DESC)
  WHERE degraded_mode = true;

-- ── Grants ────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT ON public.radio_comms_events TO authenticated;

COMMENT ON TABLE public.radio_comms_events IS
  'Phase B3: Radio callsign binding and dispatch-to-radio escalation events on the shared case timeline';
COMMENT ON COLUMN public.radio_comms_events.degraded_mode IS
  'When true, PTT was unavailable at event_timestamp. Case remains open; timeline marks the gap.';
COMMENT ON COLUMN public.radio_comms_events.channel_scope IS
  'PTT channel scope from ptt-signaling-token: org:<uuid> | incident:<uuid> | direct:<uuid>';

-- End of Phase B3 radio comms case bridge migration
