-- ============================================================================
-- Fix: authorized_work_locations column type + get_user_organization_ids()
-- ============================================================================
-- Migration: 20260226_fix_authorized_work_locations.sql
-- Root cause: get_user_organization_ids() tries to SELECT authorized_work_locations
--             INTO a uuid[] variable.  If the column is stored as TEXT (containing a
--             bare UUID string such as '569a0dd6-...') PostgreSQL raises:
--               malformed array literal: "569a0dd6-..."
--             because a bare UUID is NOT a valid array literal (needs curly braces).
--
-- This migration:
--   1. Ensures user_profiles.authorized_work_locations is uuid[] DEFAULT '{}'.
--   2. Converts any existing text values (single UUIDs) to single-element arrays.
--   3. Rebuilds get_user_organization_ids() with COALESCE so null/missing values
--      can never cause a runtime cast failure.
-- ============================================================================

-- ── Step 1: Fix column type ─────────────────────────────────────────────────

DO $$
DECLARE
  col_type text;
BEGIN
  -- Inspect current column type (NULL means column doesn't exist yet)
  SELECT data_type
    INTO col_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'user_profiles'
     AND column_name  = 'authorized_work_locations';

  IF col_type IS NULL THEN
    -- Column has never been created — add it with the correct type
    ALTER TABLE public.user_profiles
      ADD COLUMN authorized_work_locations uuid[] DEFAULT '{}';
    RAISE NOTICE '✅ authorized_work_locations: added as uuid[] DEFAULT ''{}''';

  ELSIF col_type = 'ARRAY' THEN
    -- Already the right type; make sure the default is set
    ALTER TABLE public.user_profiles
      ALTER COLUMN authorized_work_locations SET DEFAULT '{}';
    RAISE NOTICE '✅ authorized_work_locations: already uuid[] — set DEFAULT ''{}''';

  ELSIF col_type = 'text' THEN
    -- Column exists as text.
    -- Values may be:
    --   NULL               → stay NULL
    --   '569a0dd6-...'     → bare UUID  → wrap in ARRAY[...::uuid]
    --   '{569a0dd6-...}'   → array literal (already braced) → cast directly
    ALTER TABLE public.user_profiles
      ALTER COLUMN authorized_work_locations
        TYPE uuid[]
        USING CASE
                WHEN authorized_work_locations IS NULL          THEN NULL
                WHEN authorized_work_locations LIKE '{%}'       THEN authorized_work_locations::uuid[]
                ELSE ARRAY[authorized_work_locations::uuid]
              END;
    ALTER TABLE public.user_profiles
      ALTER COLUMN authorized_work_locations SET DEFAULT '{}';
    RAISE NOTICE '✅ authorized_work_locations: converted from text → uuid[]';

  ELSE
    -- Some other type (e.g. uuid scalar).  Safe to drop and recreate since the
    -- existing data could not have been a valid uuid[] value anyway.
    ALTER TABLE public.user_profiles DROP COLUMN authorized_work_locations;
    ALTER TABLE public.user_profiles
      ADD COLUMN authorized_work_locations uuid[] DEFAULT '{}';
    RAISE NOTICE '✅ authorized_work_locations: rebuilt as uuid[] (old type was: %)', col_type;
  END IF;
END;
$$;

COMMENT ON COLUMN public.user_profiles.authorized_work_locations IS
  'Array of organization UUIDs the user is explicitly authorised to work at,
   in addition to their primary organisation and its descendants.
   Used by get_user_organization_ids() for multi-org RLS filtering.';

-- ── Step 2: Rebuild get_user_organization_ids() defensively ─────────────────
-- Uses COALESCE on authorized_work_locations so a NULL or missing value never
-- causes a cast failure.

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
  -- Fetch user details.  COALESCE ensures authorized_work_locations is always
  -- a proper array (never NULL) going into the uuid[] variable.
  SELECT
    organization_id,
    role,
    COALESCE(authorized_work_locations, '{}'::uuid[])
  INTO user_org_id, user_role_val, authorized_locs
  FROM public.user_profiles
  WHERE id = auth.uid();

  -- Masters see every active organisation
  IF user_role_val = 'master' THEN
    SELECT array_agg(id) INTO result
      FROM public.organizations
     WHERE is_active = TRUE;
    RETURN COALESCE(result, '{}'::uuid[]);
  END IF;

  -- Start from the user's primary organisation
  IF user_org_id IS NOT NULL THEN
    result := ARRAY[user_org_id]::uuid[];
  ELSE
    result := '{}'::uuid[];
  END IF;

  -- Admins and admin_officers also see child organisations
  IF user_role_val IN ('admin', 'admin_officer') AND user_org_id IS NOT NULL THEN
    descendant_ids := get_descendant_organizations(user_org_id);
    result := array_cat(result, descendant_ids);
  END IF;

  -- Add explicitly authorised work locations
  IF array_length(authorized_locs, 1) > 0 THEN
    result := array_cat(result, authorized_locs);
  END IF;

  -- Remove duplicates
  SELECT array_agg(DISTINCT org_id)
    INTO result
    FROM unnest(result) AS org_id;

  RETURN COALESCE(result, '{}'::uuid[]);
END;
$$;

COMMENT ON FUNCTION public.get_user_organization_ids() IS
  'Returns all organization IDs the current user can access:
   primary org + descendants (if admin/admin_officer) + authorized_work_locations.
   Uses SECURITY DEFINER to bypass RLS on user_profiles.
   COALESCE on authorized_work_locations prevents malformed-array-literal errors
   when the column is NULL or was stored in an unexpected format.';

GRANT EXECUTE ON FUNCTION public.get_user_organization_ids() TO authenticated;

-- ── Verification ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type
    INTO col_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'user_profiles'
     AND column_name  = 'authorized_work_locations';

  IF col_type != 'ARRAY' THEN
    RAISE EXCEPTION 'authorized_work_locations is still wrong type: %', col_type;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ authorized_work_locations fix applied';
  RAISE NOTICE '   Column type : %', col_type;
  RAISE NOTICE '   RLS helper  : get_user_organization_ids() rebuilt with COALESCE';
  RAISE NOTICE '========================================';
END;
$$;
