-- Extend scoped org access to all authenticated users.
-- Date: 2026-07-14
--
-- Why:
-- 1) organizations read policy previously role-limited; client roles were excluded.
-- 2) radio_floor_events policies were bound to primary organization only,
--    which blocked scoped multi-org visibility/logging.
--
-- Approach:
-- - Use get_user_organization_ids() as the canonical org scope for all
--   authenticated users on read paths.
-- - Keep privileged write/update controls role-gated where appropriate.

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "org_member_read_descendant_orgs" ON public.organizations;
  CREATE POLICY "org_member_read_descendant_orgs"
    ON public.organizations
    FOR SELECT
    TO authenticated
    USING (
      id = ANY(get_user_organization_ids())
    );
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'radio_floor_events'
  ) THEN
    ALTER TABLE public.radio_floor_events ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS radio_floor_events_select_own_org ON public.radio_floor_events;
    DROP POLICY IF EXISTS radio_floor_events_insert_own_org ON public.radio_floor_events;
    DROP POLICY IF EXISTS radio_floor_events_update_admin ON public.radio_floor_events;

    CREATE POLICY radio_floor_events_select_scoped_orgs
      ON public.radio_floor_events
      FOR SELECT
      TO authenticated
      USING (
        org_id = ANY(get_user_organization_ids())
      );

    CREATE POLICY radio_floor_events_insert_scoped_orgs
      ON public.radio_floor_events
      FOR INSERT
      TO authenticated
      WITH CHECK (
        org_id = ANY(get_user_organization_ids())
      );

    CREATE POLICY radio_floor_events_update_scoped_supervisors
      ON public.radio_floor_events
      FOR UPDATE
      TO authenticated
      USING (
        org_id = ANY(get_user_organization_ids())
        AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
      )
      WITH CHECK (
        org_id = ANY(get_user_organization_ids())
        AND get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
      );
  END IF;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
