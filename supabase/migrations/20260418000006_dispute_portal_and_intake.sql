-- ============================================================================
-- Dispute Portal URL + Public Dispute Intake
-- Date: 2026-04-18
--
-- Adds a configurable dispute portal link per zone legal config and
-- creates a dispute intake table for inbound recipient challenges.
-- ============================================================================

BEGIN;

ALTER TABLE public.zone_legal_config
  ADD COLUMN IF NOT EXISTS dispute_portal_url TEXT;

COMMENT ON COLUMN public.zone_legal_config.dispute_portal_url IS
  'Public URL where recipients can lodge disputes/challenges for notices or infringements.';

CREATE TABLE IF NOT EXISTS public.dispute_intake (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  zone_id UUID REFERENCES public.zones(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('notice_to_vacate', 'infringement', 'homeless_status', 'other')),
  source_reference TEXT,
  plate_number TEXT,
  claimant_name TEXT,
  claimant_email TEXT,
  claimant_phone TEXT,
  message TEXT NOT NULL,
  request_homeless_review BOOLEAN NOT NULL DEFAULT false,
  hardship_context TEXT,
  evidence_statement TEXT,
  submitted_via TEXT NOT NULL DEFAULT 'public_portal',
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'under_review', 'info_requested', 'upheld', 'varied', 'rejected', 'closed')),
  assigned_to UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  admin_notes TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dispute_intake IS
  'Public and staff-submitted recipient disputes/challenges for notices, infringements and hardship/homeless claims.';

CREATE INDEX IF NOT EXISTS idx_dispute_intake_org_status
  ON public.dispute_intake (organization_id, status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_dispute_intake_plate
  ON public.dispute_intake (plate_number, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_dispute_intake_reference
  ON public.dispute_intake (source_reference);

ALTER TABLE public.dispute_intake ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dispute_intake_admin_select ON public.dispute_intake;
CREATE POLICY dispute_intake_admin_select
  ON public.dispute_intake FOR SELECT
  TO authenticated
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = ANY(get_user_organization_ids())
      OR organization_id IS NULL
    )
  );

DROP POLICY IF EXISTS dispute_intake_admin_update ON public.dispute_intake;
CREATE POLICY dispute_intake_admin_update
  ON public.dispute_intake FOR UPDATE
  TO authenticated
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
    AND (
      get_user_role(auth.uid()) = 'master'
      OR organization_id = ANY(get_user_organization_ids())
      OR organization_id IS NULL
    )
  )
  WITH CHECK (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
  );

DROP POLICY IF EXISTS dispute_intake_service_all ON public.dispute_intake;
CREATE POLICY dispute_intake_service_all
  ON public.dispute_intake FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
