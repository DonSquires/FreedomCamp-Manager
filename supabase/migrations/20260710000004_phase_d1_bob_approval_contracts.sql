-- ============================================================================
-- Phase D1: Bob Approval / Proposal / Audit Contracts
-- Date: 2026-05-08
--
-- Introduces the structured Bob proposal contract required by the
-- build realignment plan:
--   - bob_action_proposals        structured proposal rows with approval SLA
--   - bob_action_proposal_events  audit/event trail for distinct outcomes
--   - approval / escalation / execution RPCs with org + role guardrails
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bob_action_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id UUID REFERENCES public.operational_cases(id) ON DELETE SET NULL,
  source_record_table TEXT,
  source_record_id UUID,
  source_context_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposal_type TEXT NOT NULL,
  title TEXT NOT NULL,
  proposal_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  impact_level TEXT NOT NULL DEFAULT 'medium'
    CHECK (impact_level IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN (
      'proposed',
      'approved',
      'rejected',
      'pending_escalation',
      'executed',
      'execution_failed'
    )),
  requested_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  approver_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  approval_notes TEXT,
  rejection_reason TEXT,
  execution_error TEXT,
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approval_due_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 seconds'),
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  execution_failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bob_action_proposals_org_status_due
  ON public.bob_action_proposals(organization_id, status, approval_due_at);

CREATE INDEX IF NOT EXISTS idx_bob_action_proposals_case
  ON public.bob_action_proposals(case_id, proposed_at DESC);

CREATE INDEX IF NOT EXISTS idx_bob_action_proposals_requested_by
  ON public.bob_action_proposals(requested_by, proposed_at DESC);

CREATE TABLE IF NOT EXISTS public.bob_action_proposal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES public.bob_action_proposals(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id UUID REFERENCES public.operational_cases(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'proposed',
      'approved',
      'rejected',
      'pending_escalation',
      'executed',
      'execution_failed'
    )),
  actor_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bob_action_proposal_events_proposal
  ON public.bob_action_proposal_events(proposal_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_bob_action_proposal_events_case
  ON public.bob_action_proposal_events(case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bob_action_proposal_events_org
  ON public.bob_action_proposal_events(organization_id, created_at DESC);

ALTER TABLE public.bob_action_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bob_action_proposal_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "bob_action_proposals_org_read" ON public.bob_action_proposals;
  CREATE POLICY "bob_action_proposals_org_read"
    ON public.bob_action_proposals FOR SELECT
    TO authenticated
    USING (organization_id = ANY(get_user_organization_ids()));
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "bob_action_proposals_org_insert" ON public.bob_action_proposals;
  CREATE POLICY "bob_action_proposals_org_insert"
    ON public.bob_action_proposals FOR INSERT
    TO authenticated
    WITH CHECK (
      organization_id = ANY(get_user_organization_ids())
      AND requested_by = auth.uid()
    );
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "bob_action_proposal_events_org_read" ON public.bob_action_proposal_events;
  CREATE POLICY "bob_action_proposal_events_org_read"
    ON public.bob_action_proposal_events FOR SELECT
    TO authenticated
    USING (organization_id = ANY(get_user_organization_ids()));
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "service_role_all_bob_action_proposals" ON public.bob_action_proposals;
  CREATE POLICY "service_role_all_bob_action_proposals"
    ON public.bob_action_proposals FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "service_role_all_bob_action_proposal_events" ON public.bob_action_proposal_events;
  CREATE POLICY "service_role_all_bob_action_proposal_events"
    ON public.bob_action_proposal_events FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.trg_bob_action_proposals_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_bob_action_proposals_updated_at ON public.bob_action_proposals;
CREATE TRIGGER set_bob_action_proposals_updated_at
  BEFORE UPDATE ON public.bob_action_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_bob_action_proposals_updated_at();

CREATE OR REPLACE FUNCTION public.trg_bob_action_proposals_insert_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.bob_action_proposal_events (
    proposal_id,
    organization_id,
    case_id,
    event_type,
    actor_id,
    notes,
    metadata
  )
  VALUES (
    NEW.id,
    NEW.organization_id,
    NEW.case_id,
    'proposed',
    NEW.requested_by,
    NULL,
    jsonb_build_object(
      'proposal_type', NEW.proposal_type,
      'impact_level', NEW.impact_level,
      'approval_due_at', NEW.approval_due_at
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bob_action_proposals_insert_event ON public.bob_action_proposals;
CREATE TRIGGER bob_action_proposals_insert_event
  AFTER INSERT ON public.bob_action_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_bob_action_proposals_insert_event();

CREATE OR REPLACE FUNCTION public.approve_bob_action_proposal(
  p_proposal_id UUID,
  p_decision TEXT,
  p_note TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS public.bob_action_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_status TEXT;
  v_actor_id UUID;
  v_row public.bob_action_proposals;
BEGIN
  v_actor_id := COALESCE(auth.uid(), p_actor_id);
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve actor for Bob proposal approval';
  END IF;

  v_role := public.get_user_role(v_actor_id);
  IF v_role NOT IN ('admin', 'admin_officer', 'master', 'grand_master') THEN
    RAISE EXCEPTION 'Only supervisory roles can approve Bob proposals';
  END IF;

  v_status := CASE
    WHEN lower(p_decision) IN ('approve', 'approved') THEN 'approved'
    WHEN lower(p_decision) IN ('reject', 'rejected', 'deny') THEN 'rejected'
    ELSE NULL
  END;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Invalid decision. Use approve|reject';
  END IF;

  UPDATE public.bob_action_proposals
  SET status = v_status,
      approver_id = v_actor_id,
      approval_notes = CASE WHEN v_status = 'approved' THEN p_note ELSE approval_notes END,
      rejection_reason = CASE WHEN v_status = 'rejected' THEN p_note ELSE rejection_reason END,
      approved_at = CASE WHEN v_status = 'approved' THEN now() ELSE approved_at END,
      rejected_at = CASE WHEN v_status = 'rejected' THEN now() ELSE rejected_at END
  WHERE id = p_proposal_id
    AND status IN ('proposed', 'pending_escalation')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Bob proposal not found or not pending: %', p_proposal_id;
  END IF;

  INSERT INTO public.bob_action_proposal_events (
    proposal_id,
    organization_id,
    case_id,
    event_type,
    actor_id,
    notes,
    metadata
  )
  VALUES (
    v_row.id,
    v_row.organization_id,
    v_row.case_id,
    v_status,
    v_actor_id,
    p_note,
    jsonb_build_object('status', v_row.status)
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.escalate_expired_bob_action_proposals(
  p_organization_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  WITH moved AS (
    UPDATE public.bob_action_proposals
    SET status = 'pending_escalation',
        escalated_at = now()
    WHERE status = 'proposed'
      AND approval_due_at <= now()
      AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    RETURNING id, organization_id, case_id
  )
  INSERT INTO public.bob_action_proposal_events (
    proposal_id,
    organization_id,
    case_id,
    event_type,
    actor_id,
    notes,
    metadata
  )
  SELECT
    id,
    organization_id,
    case_id,
    'pending_escalation',
    NULL,
    'Approval SLA exceeded before supervisor decision',
    jsonb_build_object('source', 'escalate_expired_bob_action_proposals')
  FROM moved;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_bob_action_proposal_execution(
  p_proposal_id UUID,
  p_execution_status TEXT,
  p_note TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS public.bob_action_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_status TEXT;
  v_row public.bob_action_proposals;
BEGIN
  v_actor_id := COALESCE(auth.uid(), p_actor_id);
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve actor for Bob proposal execution';
  END IF;

  v_status := CASE
    WHEN lower(p_execution_status) IN ('executed', 'success', 'completed') THEN 'executed'
    WHEN lower(p_execution_status) IN ('execution_failed', 'failed', 'error') THEN 'execution_failed'
    ELSE NULL
  END;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Invalid execution status. Use executed|execution_failed';
  END IF;

  UPDATE public.bob_action_proposals
  SET status = v_status,
      execution_error = CASE WHEN v_status = 'execution_failed' THEN p_error ELSE NULL END,
      executed_at = CASE WHEN v_status = 'executed' THEN now() ELSE executed_at END,
      execution_failed_at = CASE WHEN v_status = 'execution_failed' THEN now() ELSE execution_failed_at END
  WHERE id = p_proposal_id
    AND status = 'approved'
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Bob proposal not found or not approved: %', p_proposal_id;
  END IF;

  INSERT INTO public.bob_action_proposal_events (
    proposal_id,
    organization_id,
    case_id,
    event_type,
    actor_id,
    notes,
    metadata
  )
  VALUES (
    v_row.id,
    v_row.organization_id,
    v_row.case_id,
    v_status,
    v_actor_id,
    p_note,
    jsonb_build_object('execution_error', p_error)
  );

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_bob_action_proposal(UUID, TEXT, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.escalate_expired_bob_action_proposals(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_bob_action_proposal_execution(UUID, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role;
