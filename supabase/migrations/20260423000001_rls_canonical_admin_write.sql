-- ============================================================================
-- RLS write-access grants for canonical reference tables
-- ============================================================================
-- admin / admin_officer / master  → full CRUD on canonical_homeless
-- admin / admin_officer / master  → full CRUD on canonical_scv
-- master                          → DELETE on canonical_vehicles
--                                   (UPDATE already covered by existing policy)
-- master                          → UPDATE + DELETE on observations
-- ============================================================================

-- ── canonical_homeless ───────────────────────────────────────────────────────

DO $$ BEGIN
  DROP POLICY IF EXISTS "admin_write_canonical_homeless" ON public.canonical_homeless;
  CREATE POLICY "admin_write_canonical_homeless"
    ON public.canonical_homeless
    FOR ALL
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'admin_officer', 'master')
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'admin_officer', 'master')
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ── canonical_scv ─────────────────────────────────────────────────────────────
-- Existing policies: authenticated SELECT + service_role ALL.
-- Admins may also manually upsert/correct SCV records in the UI.

DO $$ BEGIN
  DROP POLICY IF EXISTS "admin_write_canonical_scv" ON public.canonical_scv;
  CREATE POLICY "admin_write_canonical_scv"
    ON public.canonical_scv
    FOR ALL
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'admin_officer', 'master')
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'admin_officer', 'master')
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ── canonical_vehicles (master: UPDATE + DELETE) ──────────────────────────────
-- The existing "admins_manage_canonical_vehicles" policy already covers
-- INSERT/UPDATE/DELETE for admins — master is included there.
-- This policy is a belt-and-braces DELETE grant specifically for master.

DO $$ BEGIN
  DROP POLICY IF EXISTS "master_delete_canonical_vehicles" ON public.canonical_vehicles;
  CREATE POLICY "master_delete_canonical_vehicles"
    ON public.canonical_vehicles
    FOR DELETE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
          AND role = 'master'
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ── observations (master: UPDATE + DELETE) ────────────────────────────────────

ALTER TABLE public.observations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "master_update_observations" ON public.observations;
  CREATE POLICY "master_update_observations"
    ON public.observations
    FOR UPDATE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
          AND role = 'master'
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
          AND role = 'master'
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "master_delete_observations" ON public.observations;
  CREATE POLICY "master_delete_observations"
    ON public.observations
    FOR DELETE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid()
          AND role = 'master'
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');
