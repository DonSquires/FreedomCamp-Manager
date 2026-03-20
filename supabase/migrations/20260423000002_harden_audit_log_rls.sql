-- ============================================================================
-- Harden audit_log tenant isolation
-- Date: 2026-04-23
-- Purpose:
--   1) Add organization_id to audit_log for explicit tenant scoping
--   2) Auto-populate organization_id from performed_by on inserts
--   3) Enforce RLS so authenticated users only read their accessible org scope
-- ============================================================================

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_org ON public.audit_log(organization_id);

-- Backfill existing rows from performer profile when possible.
UPDATE public.audit_log al
SET organization_id = up.organization_id
FROM public.user_profiles up
WHERE al.organization_id IS NULL
  AND al.performed_by = up.id
  AND up.organization_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_audit_log_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.performed_by IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM public.user_profiles
    WHERE id = NEW.performed_by;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_audit_log_organization_id ON public.audit_log;
CREATE TRIGGER trg_set_audit_log_organization_id
  BEFORE INSERT ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.set_audit_log_organization_id();

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_select_org_scoped" ON public.audit_log;
CREATE POLICY "audit_log_select_org_scoped"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (
    get_user_role(auth.uid()) = 'master'
    OR (
      organization_id IS NOT NULL
      AND organization_id = ANY(get_user_organization_ids())
    )
  );

DROP POLICY IF EXISTS "audit_log_insert_org_scoped" ON public.audit_log;
CREATE POLICY "audit_log_insert_org_scoped"
  ON public.audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (performed_by IS NULL OR performed_by = auth.uid())
    AND (
      get_user_role(auth.uid()) = 'master'
      OR (
        organization_id IS NOT NULL
        AND organization_id = ANY(get_user_organization_ids())
      )
      OR (organization_id IS NULL AND performed_by = auth.uid())
    )
  );

COMMENT ON COLUMN public.audit_log.organization_id IS
  'Tenant scope for audit visibility. Backfilled from performed_by profile and used by RLS policies.';
