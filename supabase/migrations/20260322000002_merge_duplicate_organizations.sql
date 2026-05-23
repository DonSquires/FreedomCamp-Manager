-- ============================================================================
-- Merge duplicate organizations
-- Date: 2026-03-22
--
-- Canonical mapping:
--   Iron Eagle Security: old b8f3... -> new f3a3...
--   First Security:      old 0000... -> new b856...
--   Downer/LINZ:         old 3d70... -> new 5780...
--   Nelson City Council: old 569a... -> new bd59...
--
-- This migration:
--   1) Repoints all FK columns referencing public.organizations(id)
--   2) Reparents organization hierarchy links
--   3) Rewrites organization UUID arrays in user_profiles if present
--   4) Deactivates old duplicate org rows
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE org_merge_map (
  old_id uuid PRIMARY KEY,
  new_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO org_merge_map (old_id, new_id) VALUES
  ('b8f3a1e4-5c7d-4e9f-a2b6-3c8d9e1f2a3b', 'f3a3cabf-77fb-49f9-be6d-96e3d6060a11'),
  ('00000000-0000-0000-0000-000000000001', 'b8566654-4b1b-4cea-b55e-73791ec418ea'),
  ('3d70e6b3-c829-44de-ba21-dac8e7a3e975', '57804ca8-ecc2-4b0b-91a7-3b54ad513191'),
  ('569a0dd6-3672-47d6-ad53-cfdb6a9fadf5', 'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993')
ON CONFLICT (old_id) DO UPDATE SET new_id = EXCLUDED.new_id;

DO $$
DECLARE
  v_missing_old int;
  v_missing_new int;
BEGIN
  -- Fresh environments may not contain historical duplicate org IDs.
  -- Keep only mappings where both sides currently exist, then continue.
  SELECT COUNT(*)
  INTO v_missing_old
  FROM org_merge_map m
  LEFT JOIN public.organizations o ON o.id = m.old_id
  WHERE o.id IS NULL;

  SELECT COUNT(*)
  INTO v_missing_new
  FROM org_merge_map m
  LEFT JOIN public.organizations o ON o.id = m.new_id
  WHERE o.id IS NULL;

  IF v_missing_old > 0 OR v_missing_new > 0 THEN
    RAISE NOTICE 'org merge map contains % missing old IDs and % missing new IDs; skipping unavailable mappings', v_missing_old, v_missing_new;
  END IF;

  DELETE FROM org_merge_map m
  WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = m.old_id)
     OR NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = m.new_id)
     OR m.old_id = m.new_id;
END;
$$;

-- Repoint every FK column that references public.organizations(id)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT
      ns.nspname AS schema_name,
      cls.relname AS table_name,
      att.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON TRUE
    JOIN pg_attribute att ON att.attrelid = cls.oid AND att.attnum = ck.attnum
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.organizations'::regclass
      AND ns.nspname = 'public'
  LOOP
    EXECUTE format(
      'UPDATE %I.%I t
         SET %I = m.new_id
        FROM org_merge_map m
       WHERE t.%I = m.old_id',
      r.schema_name,
      r.table_name,
      r.column_name,
      r.column_name
    );
  END LOOP;
END;
$$;

-- Reparent org hierarchy pointers
UPDATE public.organizations o
SET parent_organization_id = m.new_id
FROM org_merge_map m
WHERE o.parent_organization_id = m.old_id;

-- Optional array rewrites in user_profiles when columns exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
      AND column_name = 'authorized_work_locations'
  ) THEN
    UPDATE public.user_profiles up
    SET authorized_work_locations = (
      SELECT COALESCE(array_agg(DISTINCT COALESCE(m.new_id, x.val)), ARRAY[]::uuid[])
      FROM unnest(COALESCE(up.authorized_work_locations, ARRAY[]::uuid[])) AS x(val)
      LEFT JOIN org_merge_map m ON m.old_id = x.val
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
      AND column_name = 'organization_ids'
  ) THEN
    EXECUTE $sql$
      UPDATE public.user_profiles up
      SET organization_ids = (
        SELECT COALESCE(array_agg(DISTINCT COALESCE(m.new_id, x.val)), ARRAY[]::uuid[])
        FROM unnest(COALESCE(up.organization_ids, ARRAY[]::uuid[])) AS x(val)
        LEFT JOIN org_merge_map m ON m.old_id = x.val
      )
    $sql$;
  END IF;
END;
$$;

-- Deactivate old duplicate org rows after repointing references
UPDATE public.organizations o
SET is_active = false,
    updated_at = now(),
    name = CASE
      WHEN o.name LIKE '% [MERGED %]%' THEN o.name
      ELSE o.name || ' [MERGED ' || to_char(now(), 'YYYY-MM-DD') || ']'
    END
FROM org_merge_map m
WHERE o.id = m.old_id;

COMMIT;
