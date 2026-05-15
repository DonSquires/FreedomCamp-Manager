-- Harden Bob ledger with explicit organization scope so dual attribution
-- (user_id + operator_id) is also tenant-bound.

ALTER TABLE public.bob_system_ledger
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bob_system_ledger_org_type_created_idx
  ON public.bob_system_ledger (organization_id, record_type, created_at DESC);

ALTER TABLE public.bob_system_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bob_system_ledger_select_own ON public.bob_system_ledger;
CREATE POLICY bob_system_ledger_select_own
  ON public.bob_system_ledger
  FOR SELECT
  TO authenticated
  USING (
    (auth.uid() = user_id OR auth.uid() = operator_id)
    AND (
      organization_id IS NULL
      OR organization_id = ANY(public.get_user_organization_ids())
    )
  );

DROP POLICY IF EXISTS bob_system_ledger_insert_own ON public.bob_system_ledger;
CREATE POLICY bob_system_ledger_insert_own
  ON public.bob_system_ledger
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.uid() = user_id OR auth.uid() = operator_id)
    AND (
      organization_id IS NULL
      OR organization_id = ANY(public.get_user_organization_ids())
    )
  );
