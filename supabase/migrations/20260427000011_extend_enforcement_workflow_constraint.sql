-- ============================================================================
-- Extend enforcement_workflow CHECK constraint to include 'officer_first'
-- Date: 2026-04-27
--
-- The initial schema defined organizations.enforcement_workflow as:
--   CHECK (enforcement_workflow IN ('admin_first', 'officer_direct', 'hybrid'))
--
-- Subsequent migrations (20260428000001+) seed organizations with
-- enforcement_workflow = 'officer_first', which violates the old constraint.
--
-- This migration drops the old constraint and re-creates it with the
-- additional 'officer_first' value before those seed migrations run.
-- ============================================================================

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_enforcement_workflow_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_enforcement_workflow_check
    CHECK (enforcement_workflow IN (
      'admin_first',
      'officer_direct',
      'hybrid',
      'officer_first'
    ));

COMMENT ON COLUMN public.organizations.enforcement_workflow IS
  'Controls how breach enforcement is routed. '
  'admin_first: admin reviews before officer action. '
  'officer_direct: officers act immediately without admin review. '
  'hybrid: mix of admin and officer initiated actions. '
  'officer_first: officer acts first, admin notified/reviews after.';
