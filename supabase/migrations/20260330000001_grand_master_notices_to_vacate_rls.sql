-- Add missing grand_master RLS policies for notice/infringement tables
-- The grand_master role was created in 20260424000002_add_grand_master_role.sql
-- but RLS policies for notices_to_vacate and related tables were overlooked.

-- notices_to_vacate: grand_master can read all records
DO $$ BEGIN
  DROP POLICY IF EXISTS "grand_master_read_all_notices_to_vacate" ON public.notices_to_vacate;
  CREATE POLICY "grand_master_read_all_notices_to_vacate"
    ON public.notices_to_vacate
    FOR SELECT
    TO authenticated
    USING (get_user_role(auth.uid()) = 'grand_master');
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- notices_to_vacate: grand_master can manage all records
DO $$ BEGIN
  DROP POLICY IF EXISTS "grand_master_manage_all_notices_to_vacate" ON public.notices_to_vacate;
  CREATE POLICY "grand_master_manage_all_notices_to_vacate"
    ON public.notices_to_vacate
    FOR ALL
    TO authenticated
    USING (get_user_role(auth.uid()) = 'grand_master')
    WITH CHECK (get_user_role(auth.uid()) = 'grand_master');
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- infringement_notices: grand_master can read all records (if table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='infringement_notices') THEN
    DROP POLICY IF EXISTS "grand_master_read_all_infringement_notices" ON public.infringement_notices;
    CREATE POLICY "grand_master_read_all_infringement_notices"
      ON public.infringement_notices
      FOR SELECT
      TO authenticated
      USING (get_user_role(auth.uid()) = 'grand_master');
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- infringement_notices: grand_master can manage all records (if table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='infringement_notices') THEN
    DROP POLICY IF EXISTS "grand_master_manage_all_infringement_notices" ON public.infringement_notices;
    CREATE POLICY "grand_master_manage_all_infringement_notices"
      ON public.infringement_notices
      FOR ALL
      TO authenticated
      USING (get_user_role(auth.uid()) = 'grand_master')
      WITH CHECK (get_user_role(auth.uid()) = 'grand_master');
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- warning_notices: grand_master can read all records (if table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='warning_notices') THEN
    DROP POLICY IF EXISTS "grand_master_read_all_warning_notices" ON public.warning_notices;
    CREATE POLICY "grand_master_read_all_warning_notices"
      ON public.warning_notices
      FOR SELECT
      TO authenticated
      USING (get_user_role(auth.uid()) = 'grand_master');
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- warning_notices: grand_master can manage all records (if table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='warning_notices') THEN
    DROP POLICY IF EXISTS "grand_master_manage_all_warning_notices" ON public.warning_notices;
    CREATE POLICY "grand_master_manage_all_warning_notices"
      ON public.warning_notices
      FOR ALL
      TO authenticated
      USING (get_user_role(auth.uid()) = 'grand_master')
      WITH CHECK (get_user_role(auth.uid()) = 'grand_master');
  END IF;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

COMMENT ON POLICY "grand_master_read_all_notices_to_vacate" ON public.notices_to_vacate IS
  'grand_master role can read all notices_to_vacate records across all organizations.';

COMMENT ON POLICY "grand_master_manage_all_notices_to_vacate" ON public.notices_to_vacate IS
  'grand_master role can create, update, and delete notices_to_vacate records. '
  'This allows platform admins to manage notices globally when needed.';
