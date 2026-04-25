-- ============================================================================
-- Create admin_recalculation_actions table
-- Date: 2026-03-17
--
-- This table provides an audit trail for compliance recalculation jobs
-- triggered by admins from the Compliance Recalculation page.
-- Referenced by the recalculate-compliance edge function.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_recalculation_actions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type            text        NOT NULL DEFAULT 'BUILD'
                                    CHECK (scope_type IN ('ZONE', 'ORG', 'BUILD')),
  target_zone_ids       uuid[]      NOT NULL DEFAULT '{}',
  target_org_ids        uuid[]      NOT NULL DEFAULT '{}',
  date_range_start      timestamptz,
  date_range_end        timestamptz,
  performed_by          uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  status                text        NOT NULL DEFAULT 'running'
                                    CHECK (status IN ('running', 'completed', 'failed')),
  observations_processed integer    DEFAULT 0,
  compliance_changed    integer     DEFAULT 0,
  drift_events_created  integer     DEFAULT 0,
  error_message         text,
  started_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  duration_seconds      integer,
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_recalculation_actions IS
  'Audit log for bulk compliance recalculation jobs. One row per job run.';

CREATE INDEX IF NOT EXISTS idx_recalc_actions_performed_by
  ON public.admin_recalculation_actions (performed_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recalc_actions_status
  ON public.admin_recalculation_actions (status, created_at DESC);

ALTER TABLE public.admin_recalculation_actions ENABLE ROW LEVEL SECURITY;

-- Admins and above can read recalculation history within their org context
DROP POLICY IF EXISTS "recalc_actions_select_admins" ON public.admin_recalculation_actions;
CREATE POLICY "recalc_actions_select_admins"
  ON public.admin_recalculation_actions FOR SELECT
  TO authenticated
  USING (
    get_user_role(auth.uid()) = ANY (ARRAY['admin', 'admin_officer', 'master'])
  );

-- Service role has full access (edge functions use service role key)
DROP POLICY IF EXISTS "recalc_actions_service_role_all" ON public.admin_recalculation_actions;
CREATE POLICY "recalc_actions_service_role_all"
  ON public.admin_recalculation_actions FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ── Verification ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_table_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'admin_recalculation_actions'
  ) INTO v_table_exists;

  RAISE NOTICE '';
  RAISE NOTICE '✅ 20260317_admin_recalculation_actions complete';
  RAISE NOTICE '   admin_recalculation_actions table: %',
    CASE WHEN v_table_exists THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '';
END;
$$;
