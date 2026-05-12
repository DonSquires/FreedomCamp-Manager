-- Allow service role to read bug_reports for automated triage workflows
-- Service role bypasses RLS, but we make this explicit for clarity

-- Add service role bypass policy for SELECT operations
CREATE POLICY "service_role_view_bug_reports"
  ON public.bug_reports FOR SELECT
  TO service_role
  USING (true);

-- Add service role bypass policy for UPDATE operations (if needed for future automation)
CREATE POLICY "service_role_update_bug_reports"
  ON public.bug_reports FOR UPDATE
  TO service_role
  USING (true);

-- Ensure RLS is enabled so these policies take effect
ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;
