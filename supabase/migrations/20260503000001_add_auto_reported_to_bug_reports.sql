-- ============================================================================
-- Add auto_reported column to bug_reports
-- Date: 2026-05-03
--
-- Marks bug reports that were submitted automatically by the in-browser error
-- monitoring system (useAutoErrorReporter hook) or the GitHub Actions synthetic
-- monitor, as opposed to reports manually submitted by users.
--
-- Grand-master portal uses this flag to show "Auto-detected" badges and
-- prioritise triage of machine-generated reports.
-- ============================================================================

ALTER TABLE public.bug_reports
  ADD COLUMN IF NOT EXISTS auto_reported boolean DEFAULT false;

COMMENT ON COLUMN public.bug_reports.auto_reported IS
  'true when the report was submitted automatically by the in-browser crash '
  'detector or the GitHub Actions synthetic monitor, not by a user action.';
