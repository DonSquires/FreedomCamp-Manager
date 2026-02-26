-- ============================================================================
-- Fix: authorized_work_locations column type + defensive RLS helper function
-- Migration: 20260226_fix_authorized_work_locations.sql
-- Date: 2026-02-26
--
-- Problem:
--   Dashboard load error "malformed array literal: "UUID"" (ERR-1772089251223).
--   Root cause: get_user_organization_ids() performs an implicit cast of the
--   authorized_work_locations column to uuid[] via a SELECT INTO statement.
--   When the column contains a plain UUID text value (no curly-brace array
--   notation) or is of a non-array type, PostgreSQL raises:
--     ERROR: malformed array literal: "569a0dd6-3672-47d6-ad53-cfdb6a9fadf5"
--   This exception propagates through every RLS policy on the observations
--   table, causing all dashboard queries to fail.
--
-- Fix:
--   1. Ensure authorized_work_locations is uuid[] in user_profiles.
--      - ADD COLUMN IF NOT EXISTS handles the "missing column" case.
--      - A DO block handles the "wrong type" case by renaming the old column,
--        adding a properly-typed replacement, migrating any single-UUID text
--        values, then dropping the renamed column.
--   2. Replace get_user_organization_ids() with a version that reads
--      authorized_work_locations in its own BEGIN/EXCEPTION block so any
--      remaining bad data silently falls back to an empty array instead of
--      crashing the entire query.
-- ============================================================================

-- ── Step 1: Ensure authorized_work_locations is uuid[] ───────────────────────

-- Add the column if it is completely absent.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS authorized_work_locations uuid[] DEFAULT '{}';

-- If it already existed with the wrong type the ADD above is a no-op.
-- Detect and fix that case here.
DO $$
DECLARE
  col_type text;
  col_udt  text;
BEGIN
  SELECT data_type, udt_name
    INTO col_type, col_udt
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'user_profiles'
     AND column_name  = 'authorized_work_locations';

  -- Nothing to do if already a proper uuid array
  IF col_type = 'ARRAY' AND col_udt = '_uuid' THEN
    RAISE NOTICE 'authorized_work_locations is already uuid[] — no type change needed';
    RETURN;
  END IF;

  -- Column exists with wrong type — rename, replace, migrate, drop
  RAISE NOTICE 'authorized_work_locations has type "%" — migrating to uuid[]', col_type;

  ALTER TABLE public.user_profiles
    RENAME COLUMN authorized_work_locations TO _awl_old;

  ALTER TABLE public.user_profiles
    ADD COLUMN authorized_work_locations uuid[] DEFAULT '{}';

  -- Best-effort data migration:
  --   • NULL / empty        → empty array
  --   • plain UUID string   → single-element array
  --   • anything else       → empty array (safe fallback)
  UPDATE public.user_profiles
     SET authorized_work_locations = (
           CASE
             WHEN _awl_old IS NULL
               OR trim(_awl_old::text) = ''
               OR trim(_awl_old::text) = 'null'
             THEN ARRAY[]::uuid[]
             WHEN trim(_awl_old::text)
                    ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
             THEN ARRAY[ trim(_awl_old::text)::uuid ]
             ELSE ARRAY[]::uuid[]
           END
         );

  ALTER TABLE public.user_profiles
    DROP COLUMN _awl_old;

  RAISE NOTICE 'authorized_work_locations migrated to uuid[]';
END;
$$;

-- ── Step 2: Defensive replacement of get_user_organization_ids() ─────────────
-- Split the SELECT INTO so that authorized_work_locations is read inside its
-- own BEGIN/EXCEPTION block.  Any cast or data error is silently swallowed and
-- the function falls back to an empty slice, preventing dashboard crashes.

CREATE OR REPLACE FUNCTION public.get_user_organization_ids()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  user_org_id     uuid;
  user_role_val   text;
  authorized_locs uuid[] := ARRAY[]::uuid[];
  descendant_ids  uuid[];
  result          uuid[];
BEGIN
  -- Fetch role and primary org (these columns are always well-typed)
  SELECT organization_id, role
    INTO user_org_id, user_role_val
    FROM public.user_profiles
   WHERE id = auth.uid();

  -- Safely read authorized_work_locations.
  -- An EXCEPTION block is needed because implicit casts to uuid[] can raise
  -- "malformed array literal" when the column contains non-array text data.
  BEGIN
    SELECT authorized_work_locations
      INTO authorized_locs
      FROM public.user_profiles
     WHERE id = auth.uid();
  EXCEPTION WHEN OTHERS THEN
    authorized_locs := ARRAY[]::uuid[];
  END;

  -- Masters see all active organizations
  IF user_role_val = 'master' THEN
    SELECT array_agg(id) INTO result
      FROM public.organizations
     WHERE is_active = true;
    RETURN coalesce(result, ARRAY[]::uuid[]);
  END IF;

  -- Start with the user's primary org
  result := CASE
              WHEN user_org_id IS NOT NULL THEN ARRAY[user_org_id]::uuid[]
              ELSE ARRAY[]::uuid[]
            END;

  -- Add descendant orgs for admin / admin_officer
  IF user_role_val IN ('admin', 'admin_officer') AND user_org_id IS NOT NULL THEN
    descendant_ids := get_descendant_organizations(user_org_id);
    result := array_cat(result, descendant_ids);
  END IF;

  -- Merge authorized work locations
  IF authorized_locs IS NOT NULL AND array_length(authorized_locs, 1) > 0 THEN
    result := array_cat(result, authorized_locs);
  END IF;

  -- Deduplicate
  SELECT array_agg(DISTINCT org_id) INTO result
    FROM unnest(result) AS org_id;

  RETURN coalesce(result, ARRAY[]::uuid[]);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_organization_ids() TO authenticated;

COMMENT ON FUNCTION public.get_user_organization_ids() IS
  'Returns all org IDs the current user may access: primary org + hierarchy '
  'descendants (admin/admin_officer) + authorized_work_locations. '
  'Reads authorized_work_locations defensively so malformed column data never '
  'crashes dashboard or RLS queries (fix for ERR-1772089251223).';

-- ── Verification ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  col_type text;
  col_udt  text;
  fn_exists boolean;
BEGIN
  -- Assert authorized_work_locations is now uuid[]
  SELECT data_type, udt_name
    INTO col_type, col_udt
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'user_profiles'
     AND column_name  = 'authorized_work_locations';

  IF col_type IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: user_profiles.authorized_work_locations column not found';
  END IF;

  IF col_type <> 'ARRAY' OR col_udt <> '_uuid' THEN
    RAISE EXCEPTION 'VERIFY FAILED: authorized_work_locations has type "%" (udt "%"), expected uuid[]',
      col_type, col_udt;
  END IF;

  -- Assert get_user_organization_ids() exists
  SELECT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'get_user_organization_ids'
  ) INTO fn_exists;

  IF NOT fn_exists THEN
    RAISE EXCEPTION 'VERIFY FAILED: function get_user_organization_ids() not found';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '✅ 20260226_fix_authorized_work_locations verified';
  RAISE NOTICE '   + user_profiles.authorized_work_locations is uuid[]';
  RAISE NOTICE '   + get_user_organization_ids() exists with defensive error handling';
  RAISE NOTICE '   Fix: dashboard "malformed array literal" error (ERR-1772089251223)';
END;
$$;
