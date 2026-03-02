-- ============================================================================
-- FIX: 403 Forbidden on POST /rest/v1/observations (mark_object_ref)
-- Date: 2026-03-09
--
-- PROBLEM:
--   Officers still receive HTTP 403 / "permission denied for function
--   mark_object_ref" when inserting observations (scanning a photo).
--
-- WHY THE PREVIOUS FIX (20260308_fix_mark_object_ref_permission.sql) DIDN'T
-- FULLY SOLVE IT:
--   The previous migration used a DO block that loops over pg_proc to find
--   mark_object_ref and grant EXECUTE.  This only works when the function
--   ALREADY EXISTS at migration time.
--
--   Supabase Storage creates mark_object_ref (and the companion internal
--   trigger on the observations table) when "Database References" (Object
--   Reference Tracking) is enabled on the "scans" bucket via the Dashboard.
--   If that feature was enabled AFTER the 20260308 migration ran, the function
--   was created without the EXECUTE grant and the 403 persists.
--
-- THREE-PART FIX:
--   1. GRANT USAGE ON SCHEMA storage      — schema-level access (prerequisite)
--   2. GRANT EXECUTE ON ALL FUNCTIONS     — covers every function that currently
--      IN SCHEMA storage                    exists (including mark_object_ref)
--   3. ALTER DEFAULT PRIVILEGES           — ensures any function Supabase creates
--      IN SCHEMA storage                    in the future also gets the grant
--      GRANT EXECUTE ON FUNCTIONS
--
--   All three statements are idempotent (re-running them is harmless).
-- ============================================================================

-- ── 1. Schema-level USAGE ────────────────────────────────────────────────────
-- The authenticated role must have USAGE on the storage schema before it can
-- call any function or reference any object in that schema.

GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT USAGE ON SCHEMA storage TO service_role;

-- ── 2. EXECUTE on all current storage functions ──────────────────────────────
-- Covers storage.mark_object_ref(...) and every other helper function that
-- Supabase may have added to the storage schema.

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA storage TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA storage TO service_role;

-- ── 3. Default privileges for future storage functions ───────────────────────
-- When Supabase adds new internal functions to the storage schema (e.g. when
-- bucket features are enabled via the Dashboard), those functions will
-- automatically inherit EXECUTE for authenticated and service_role.

ALTER DEFAULT PRIVILEGES IN SCHEMA storage
  GRANT EXECUTE ON FUNCTIONS TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA storage
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- ── Verification ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_fn_count   integer;
  v_has_usage  boolean;
BEGIN
  -- Count storage functions that authenticated can now execute
  SELECT count(*) INTO v_fn_count
  FROM   pg_proc      p
  JOIN   pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'storage';

  -- Check USAGE on storage schema for authenticated
  SELECT has_schema_privilege('authenticated', 'storage', 'USAGE')
  INTO   v_has_usage;

  RAISE NOTICE '';
  RAISE NOTICE '✅ 20260309_fix_storage_function_grants applied';
  RAISE NOTICE '   storage schema USAGE for authenticated: %', v_has_usage;
  RAISE NOTICE '   storage functions covered: %', v_fn_count;
  RAISE NOTICE '';
  RAISE NOTICE '   mark_object_ref present: %',
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'storage' AND p.proname = 'mark_object_ref'
    );
END;
$$;
