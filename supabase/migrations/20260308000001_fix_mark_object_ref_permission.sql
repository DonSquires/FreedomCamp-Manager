-- ============================================================================
-- FIX: permission denied for function mark_object_ref
-- Date: 2026-03-08
--
-- PROBLEM:
--   Officers receive "Save failed: permission denied for function
--   mark_object_ref" when inserting a row into public.observations.
--   This also manifests as a 403 Forbidden on POST /rest/v1/observations.
--
-- ROOT CAUSE:
--   Supabase Storage creates an INTERNAL trigger (tgisinternal = true) on the
--   observations table when the "scans" bucket has Object Reference Tracking
--   enabled (Supabase Storage > Bucket settings > Database References).
--   This trigger calls storage.mark_object_ref() to record that a storage
--   object is referenced by a database row.
--
--   Because the trigger is internal it was NOT removed by the
--   20260307_restore_observation_jobs migration (which skipped
--   tgisinternal = true triggers), so it continues to fire on every INSERT.
--
--   The authenticated role lacks EXECUTE on storage.mark_object_ref, so the
--   INSERT fails with a permission-denied error.
--
-- FIX:
--   Grant EXECUTE on every overload of mark_object_ref in every schema to the
--   authenticated (and service_role) roles.  A DO block is used so the
--   migration is safe and idempotent even if the function signature changes
--   between Supabase versions.
--
-- CORS NOTE (separate issue, requires Supabase Dashboard action):
--   The Supabase REST API is returning a specific old preview URL as the
--   Access-Control-Allow-Origin header, blocking requests from new preview
--   deployments.  To fix this:
--     1. Open Supabase Dashboard → Project Settings → API
--     2. Under "Additional Allowed Origins", remove the hardcoded preview URL
--        (https://preview-react-9b4t5o-bjsyuxnw5saa88ykxnfbqe.onspace.build)
--     3. Add '*' (wildcard) or leave empty to allow all origins.
--   This cannot be changed via a SQL migration.
-- ============================================================================

DO $$
DECLARE
  r         RECORD;
  fn_count  integer := 0;
BEGIN
  -- Find every function named mark_object_ref in any schema and grant EXECUTE
  -- to the roles that serve user requests.
  FOR r IN
    SELECT p.oid::regprocedure AS fn_sig
    FROM   pg_proc      p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  p.proname = 'mark_object_ref'
  LOOP
    fn_count := fn_count + 1;

    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.fn_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',  r.fn_sig);

    RAISE NOTICE '✅ Granted EXECUTE on % to authenticated, service_role', r.fn_sig;
  END LOOP;

  IF fn_count = 0 THEN
    RAISE NOTICE '⚠️  mark_object_ref not found in pg_proc – '
                 'no grants applied (bucket object-reference tracking may not be enabled)';
  ELSE
    RAISE NOTICE '✅ 20260308_fix_mark_object_ref_permission: granted EXECUTE on '
                 '% overload(s) of mark_object_ref', fn_count;
  END IF;
END;
$$;
