-- Add RLS to bob_policy_controls.
-- The table was created without RLS, leaving it open to all authenticated users.
-- Grand Masters manage escalation keywords via ComplianceEscalations.
-- All authenticated users need SELECT so the edge function client can read it
-- (the edge function uses service role, but the frontend reads it directly).

ALTER TABLE public.bob_policy_controls ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can view the escalation keyword policy.
DROP POLICY IF EXISTS bob_policy_controls_select ON public.bob_policy_controls;
CREATE POLICY bob_policy_controls_select
  ON public.bob_policy_controls
  FOR SELECT
  TO authenticated
  USING (true);

-- Only Grand Masters (and the service role) may modify escalation policy.
DROP POLICY IF EXISTS bob_policy_controls_write ON public.bob_policy_controls;
CREATE POLICY bob_policy_controls_write
  ON public.bob_policy_controls
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('grand_master', 'master')
        AND up.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('grand_master', 'master')
        AND up.is_active = true
    )
  );
