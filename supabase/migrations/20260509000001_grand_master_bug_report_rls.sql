-- Allow grand_master users to triage the Feedback Inbox from the app UI.
-- The Platform page is grand-master only, so bug_reports RLS must match that
-- visibility or status updates and cleanup actions will fail in the client.

ALTER POLICY "masters_view_all_reports"
  ON public.bug_reports
  USING (get_user_role(auth.uid()) IN ('master', 'grand_master'));

ALTER POLICY "masters_update_reports"
  ON public.bug_reports
  USING (get_user_role(auth.uid()) IN ('master', 'grand_master'));

ALTER POLICY "masters_delete_reports"
  ON public.bug_reports
  USING (get_user_role(auth.uid()) IN ('master', 'grand_master'));
