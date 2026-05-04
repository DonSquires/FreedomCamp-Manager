-- Migration: Bob Approval Audit Trail
-- Date: 2026-05-04
-- Purpose: Enable governance, traceability, and audit of Bob AI-assisted approval decisions

-- ============================================================================
-- PART 1: Bob Approval Audit Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bob_approval_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Proposal identity
  proposal_type TEXT NOT NULL
    CHECK (proposal_type IN ('feature', 'migration', 'deployment', 'security', 'incident', 'other')),
  proposal_id TEXT NOT NULL, -- External ID (e.g., GitHub PR number, ticket ID)
  proposal_title TEXT NOT NULL,
  proposal_url TEXT, -- Link to external proposal (GitHub PR, etc.)
  
  -- Bob decision
  bob_decision TEXT NOT NULL
    CHECK (bob_decision IN ('approve', 'reject', 'defer', 'escalate', 'needs_more_info')),
  bob_reasoning TEXT, -- Why Bob approved/rejected (max 2000 chars)
  bob_confidence_score DECIMAL(3, 2), -- 0.0-1.0, how confident is Bob in this decision
  
  -- Human approval/rejection of Bob decision
  approver_role TEXT CHECK (approver_role IN ('admin', 'master', 'lead', 'system')),
  approver_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  human_decision TEXT
    CHECK (human_decision IS NULL
        OR human_decision IN ('approved_as_is', 'approved_with_changes', 'rejected', 'sent_back_to_bob')),
  human_reasoning TEXT, -- Why human agreed/disagreed with Bob
  
  -- Approval status
  status TEXT NOT NULL DEFAULT 'pending_human_review'
    CHECK (status IN (
      'pending_human_review',  -- Bob made decision, awaiting human approval
      'approved',              -- Proposal approved (Bob decision accepted)
      'rejected',              -- Proposal rejected (human overrode Bob)
      'appealed',              -- Developer appealed, sent back to Bob
      'expired'                -- Approval request expired
    )),
  
  -- SLA tracking
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bob_decision_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  human_decision_at TIMESTAMPTZ,
  status_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Context
  changed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  metadata JSONB -- Additional context: deployment target, feature flags affected, etc.
);

-- RLS: Organization-scoped access
ALTER TABLE public.bob_approval_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_org_approvals" ON public.bob_approval_audit;
CREATE POLICY "users_read_own_org_approvals" ON public.bob_approval_audit
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "admins_manage_approvals" ON public.bob_approval_audit;
CREATE POLICY "admins_manage_approvals" ON public.bob_approval_audit
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND organization_id = bob_approval_audit.organization_id
        AND role IN ('admin', 'master')
    )
  );

COMMENT ON TABLE public.bob_approval_audit IS
  'Complete audit trail of Bob AI-assisted approval decisions with human override capability';
COMMENT ON COLUMN public.bob_approval_audit.proposal_id IS
  'External proposal identifier: e.g., GitHub PR #123, JIRA PROJ-456, ticket-789';
COMMENT ON COLUMN public.bob_approval_audit.bob_confidence_score IS
  'Bob''s confidence in the decision (0.0-1.0). Low scores should trigger human review even if approved.';
COMMENT ON COLUMN public.bob_approval_audit.status IS
  'Workflow: pending → (approved|rejected|appealed) or expired after 48 hours';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bob_approvals_org_status
  ON public.bob_approval_audit(organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bob_approvals_proposal
  ON public.bob_approval_audit(proposal_type, proposal_id);

CREATE INDEX IF NOT EXISTS idx_bob_approvals_approver
  ON public.bob_approval_audit(approver_id, status);

CREATE INDEX IF NOT EXISTS idx_bob_approvals_pending
  ON public.bob_approval_audit(organization_id, status, bob_decision_at)
  WHERE status IN ('pending_human_review', 'appealed');

-- ============================================================================
-- PART 2: Bob Appeal Workflow Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bob_approval_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  approval_audit_id UUID NOT NULL REFERENCES public.bob_approval_audit(id) ON DELETE CASCADE,
  
  -- Appeal details
  appeal_reason TEXT NOT NULL,
  appealed_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  
  -- New context provided by developer
  additional_context TEXT,
  supporting_evidence_urls TEXT[],
  
  -- Status
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'under_review', 'approved', 'rejected')),
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ
);

ALTER TABLE public.bob_approval_appeals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_org_appeals" ON public.bob_approval_appeals;
CREATE POLICY "users_manage_own_org_appeals" ON public.bob_approval_appeals
  FOR ALL USING (
    organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid())
  );

COMMENT ON TABLE public.bob_approval_appeals IS
  'Appeal workflow: developers can appeal Bob''s rejection with additional context';

-- ============================================================================
-- PART 3: Sample Approval Records (Seed Data)
-- ============================================================================

INSERT INTO public.bob_approval_audit (
  organization_id,
  proposal_type,
  proposal_id,
  proposal_title,
  proposal_url,
  bob_decision,
  bob_reasoning,
  bob_confidence_score,
  status,
  metadata
)
SELECT
  id,
  'feature',
  'SAMPLE-001',
  'Phase A: Case Model Schema and Org Isolation Tests',
  'https://github.com/DonSquires/FreedomCamp-Manager/pull/phase-a-001',
  'approve',
  'Proposal implements required org isolation RLS policies with proper audit trail. All 5 test scenarios verified. Risk: Low. Ready for production deployment.',
  0.95,
  'approved',
  jsonb_build_object(
    'phase', 'A',
    'risk_level', 'low',
    'affected_modules', jsonb_build_array('operational_cases', 'patrol_events', 'dispatch_events', 'enforcement_events'),
    'rollback_safe', true
  )
FROM public.organizations
LIMIT 1;

-- ============================================================================
-- PART 4: Helper Functions
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_bob_approval_request(
  org_id UUID,
  proposal_type TEXT,
  proposal_id TEXT,
  proposal_title TEXT,
  proposal_url TEXT DEFAULT NULL,
  metadata JSONB DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  audit_id UUID;
BEGIN
  INSERT INTO public.bob_approval_audit (
    organization_id,
    proposal_type,
    proposal_id,
    proposal_title,
    proposal_url,
    bob_decision,
    status,
    metadata,
    changed_by
  )
  VALUES (
    org_id,
    proposal_type,
    proposal_id,
    proposal_title,
    proposal_url,
    'pending',
    'pending_human_review',
    metadata,
    auth.uid()
  )
  RETURNING bob_approval_audit.id INTO audit_id;
  
  RETURN audit_id;
END; $$;

COMMENT ON FUNCTION public.create_bob_approval_request(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) IS
  'Create a new Bob approval request for a proposal';

-- ============================================================================
-- PART 5: Grants
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON public.bob_approval_audit TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.bob_approval_appeals TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_bob_approval_request(UUID, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- End of Bob approval audit trail
-- Status: Phase A Week 3 Workflows
-- Approved by: Bob/AI Team
-- Date: 2026-05-04
