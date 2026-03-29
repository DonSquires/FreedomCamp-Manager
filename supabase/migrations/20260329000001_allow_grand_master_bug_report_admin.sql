-- Allow grand_master users to manage bug_reports (view/update/delete) alongside masters

-- Replace existing policies to include grand_master role
DROP POLICY IF EXISTS "masters_view_all_reports" ON public.bug_reports;
CREATE POLICY "masters_view_all_reports"
  ON public.bug_reports FOR SELECT
  TO authenticated
  USING (get_user_role(auth.uid()) IN ('master', 'grand_master'));

DROP POLICY IF EXISTS "masters_update_reports" ON public.bug_reports;
CREATE POLICY "masters_update_reports"
  ON public.bug_reports FOR UPDATE
  TO authenticated
  USING (get_user_role(auth.uid()) IN ('master', 'grand_master'));

DROP POLICY IF EXISTS "masters_delete_reports" ON public.bug_reports;
CREATE POLICY "masters_delete_reports"
  ON public.bug_reports FOR DELETE
  TO authenticated
  USING (get_user_role(auth.uid()) IN ('master', 'grand_master'));
