-- ============================================================================
-- Dispute intake enhancement: homeless review request fields
-- Date: 2026-04-18
-- ============================================================================

BEGIN;

ALTER TABLE public.dispute_intake
  ADD COLUMN IF NOT EXISTS request_homeless_review BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hardship_context TEXT,
  ADD COLUMN IF NOT EXISTS evidence_statement TEXT;

COMMENT ON COLUMN public.dispute_intake.request_homeless_review IS
  'TRUE when claimant asks for homeless/hardship review in parallel with dispute.';
COMMENT ON COLUMN public.dispute_intake.hardship_context IS
  'Optional hardship context provided by claimant.';
COMMENT ON COLUMN public.dispute_intake.evidence_statement IS
  'Optional claimant explanation of evidence they want reviewed.';

COMMIT;
