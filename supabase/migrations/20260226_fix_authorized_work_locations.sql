-- ============================================================================
-- Fix: authorized_work_locations column type and get_user_organization_ids
-- Migration: 20260226_fix_authorized_work_locations.sql
--
-- Problem:
--   The RLS policy `users_view_observations` calls get_user_organization_ids().
--   That function selects `authorized_work_locations` from user_profiles into a
--   uuid[] variable.  If the column is type `text` (or does not exist), PostgreSQL
--   throws "malformed array literal: '<uuid>'" which crashes every dashboard query
--   that hits the observations table directly (timeseries, breach-type chart).
--
-- Fix:
--   1. Ensure authorized_work_locations is uuid[] in user_profiles.
--   2. Rebuild get_user_organization_ids() with an EXCEPTION handler so that a
--      bad column value never brings the whole dashboard down.
-- ============================================================================

-- ── 1. Ensure authorized_work_locations is uuid[] ────────────────────────────

DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type
  INTO   col_type
  FROM   information_schema.columns
  WHERE  table_schema = 'public'
    AND  table_name   = 'user_profiles'
    AND  column_name  = 'authorized_work_locations';

  IF col_type IS NULL THEN
    -- Column is missing – add it as uuid[].
    ALTER TABLE public.user_profiles
      ADD COLUMN authorized_work_locations uuid[] DEFAULT '{}'::uuid[];

    RAISE NOTICE 'authorized_work_locations: column added as uuid[]';

  ELSIF col_type <> 'ARRAY' THEN
    -- Column exists with the wrong type (most likely text).
    -- Convert each row:
    --   • NULL         → empty array
    --   • '{uuid,...}' → already-formatted array literal → cast directly
    --   • bare uuid    → wrap in a single-element array
    --   • anything else → empty array (safe fallback)
    ALTER TABLE public.user_profiles
      ALTER COLUMN authorized_work_locations
      TYPE uuid[]
      USING CASE
        WHEN authorized_work_locations IS NULL
          THEN '{}'::uuid[]
        WHEN authorized_work_locations ~ '^\{.*\}$'
          THEN authorized_work_locations::uuid[]
        WHEN length(authorized_work_locations) = 36
             AND authorized_work_locations ~
                 '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN ARRAY[authorized_work_locations::uuid]
        ELSE '{}'::uuid[]
      END;

    RAISE NOTICE 'authorized_work_locations: column converted to uuid[]';

  ELSE
    RAISE NOTICE 'authorized_work_locations: already uuid[] – no change needed';
  END IF;
END;
$$;

-- ── 2. Add employer_organization_id if missing (referenced by same function) ─

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS employer_organization_id uuid
    REFERENCES public.organizations(id) ON DELETE SET NULL;

-- ── 3. Rebuild get_user_organization_ids with defensive error handling ────────
-- Identical logic to 20260218_create_rls_helper_functions.sql but wrapped in an
-- EXCEPTION block so that a malformed or NULL authorized_work_locations value
-- never crashes the RLS policy evaluation.

CREATE OR REPLACE FUNCTION public.get_user_organization_ids()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  user_org_id     uuid;
  user_role_val   text;
  authorized_locs uuid[];
  descendant_ids  uuid[];
  result          uuid[];
BEGIN
  -- Fetch user details.  SECURITY DEFINER bypasses RLS to prevent recursion.
  SELECT organization_id, role, authorized_work_locations
  INTO   user_org_id, user_role_val, authorized_locs
  FROM   public.user_profiles
  WHERE  id = auth.uid();

  -- Masters can see every active organization.
  IF user_role_val = 'master' THEN
    SELECT array_agg(id) INTO result
    FROM   public.organizations
    WHERE  is_active = true;
    RETURN coalesce(result, ARRAY[]::uuid[]);
  END IF;

  -- Start with the user's primary organization.
  IF user_org_id IS NOT NULL THEN
    result := ARRAY[user_org_id]::uuid[];
  ELSE
    result := ARRAY[]::uuid[];
  END IF;

  -- Admins/admin_officers also see their descendants.
  IF user_role_val IN ('admin', 'admin_officer') AND user_org_id IS NOT NULL THEN
    descendant_ids := get_descendant_organizations(user_org_id);
    result := array_cat(result, descendant_ids);
  END IF;

  -- Add authorized work locations (already uuid[] after Step 1).
  IF authorized_locs IS NOT NULL AND array_length(authorized_locs, 1) > 0 THEN
    result := array_cat(result, authorized_locs);
  END IF;

  -- Deduplicate.
  SELECT array_agg(DISTINCT org_id) INTO result
  FROM   unnest(result) AS org_id;

  RETURN coalesce(result, ARRAY[]::uuid[]);

EXCEPTION
  -- Catch data-type conversion errors (e.g. a text value that can't be cast to
  -- uuid[]) to prevent a bad authorized_work_locations value from crashing the
  -- RLS policy and taking the whole dashboard offline.
  WHEN invalid_text_representation OR data_exception THEN
  IF user_org_id IS NOT NULL THEN
    RETURN ARRAY[user_org_id]::uuid[];
  END IF;
  RETURN ARRAY[]::uuid[];
END;
$$;

COMMENT ON FUNCTION public.get_user_organization_ids() IS
  'Returns all organization IDs a user may access: primary org + descendants (admins) + authorized_work_locations. SECURITY DEFINER prevents RLS recursion. Includes EXCEPTION fallback to survive malformed column data.';

-- ── Verification ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '✅ 20260226_fix_authorized_work_locations complete';
  RAISE NOTICE '   • user_profiles.authorized_work_locations ensured as uuid[]';
  RAISE NOTICE '   • user_profiles.employer_organization_id ensured';
  RAISE NOTICE '   • get_user_organization_ids() rebuilt with EXCEPTION fallback';
END;
$$;
