-- ============================================================
-- Officer Enforcement Update Policy Fix
-- ============================================================
-- Purpose:
-- 1) Allow officers to claim unassigned enforcement actions in their org
-- 2) Allow officers to continue updating actions assigned to themselves
--
-- Existing admin policy remains unchanged; this adds officer-specific update
-- permissions without widening cross-org access.

DROP POLICY IF EXISTS officers_claim_or_update_enforcement_actions ON public.enforcement_actions;

CREATE POLICY officers_claim_or_update_enforcement_actions
  ON public.enforcement_actions
  FOR UPDATE
  TO authenticated
  USING (
    get_user_role(auth.uid()) = 'officer'
    AND organization_id = ANY(get_user_organization_ids())
    AND (assigned_to = auth.uid() OR assigned_to IS NULL)
  )
  WITH CHECK (
    get_user_role(auth.uid()) = 'officer'
    AND organization_id = ANY(get_user_organization_ids())
    AND assigned_to = auth.uid()
  );

COMMENT ON POLICY officers_claim_or_update_enforcement_actions ON public.enforcement_actions IS
  'Officers can claim unassigned enforcement actions in-org and update actions assigned to themselves';
