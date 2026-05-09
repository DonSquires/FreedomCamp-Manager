-- ============================================================================
-- Consolidate duplicate Nelson City Council client organizations
-- Date: 2026-05-06
--
-- Purpose:
--   Ensure there is only one active exact-match "Nelson City Council" client
--   organization by repointing foreign keys from duplicate rows to a canonical
--   row, updating array references, and deactivating merged duplicates.
--
-- Notes:
--   - Idempotent: safe to re-run.
--   - Canonical org is chosen deterministically by oldest created_at, then id.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE ncc_merge_map (
  old_id uuid PRIMARY KEY,
  new_id uuid NOT NULL
) ON COMMIT DROP;

WITH ranked_ncc AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM public.organizations
  WHERE lower(name) = lower('Nelson City Council')
    AND organization_type = 'client'
    AND is_active = true
)
INSERT INTO ncc_merge_map (old_id, new_id)
SELECT dup.id, canon.id
FROM ranked_ncc dup
CROSS JOIN LATERAL (
  SELECT id
  FROM ranked_ncc
  WHERE rn = 1
) canon
WHERE dup.rn > 1;

-- Repoint every FK column that references public.organizations(id)
DO $$
DECLARE
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM ncc_merge_map) THEN
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
          FROM ncc_merge_map m
         WHERE t.%I = m.old_id',
        r.schema_name,
        r.table_name,
        r.column_name,
        r.column_name
      );
    END LOOP;
  END IF;
END;
$$;

UPDATE public.organizations o
SET parent_organization_id = m.new_id
FROM ncc_merge_map m
WHERE o.parent_organization_id = m.old_id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ncc_merge_map)
     AND EXISTS (
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
      LEFT JOIN ncc_merge_map m ON m.old_id = x.val
    );
  END IF;

  IF EXISTS (SELECT 1 FROM ncc_merge_map)
     AND EXISTS (
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
        LEFT JOIN ncc_merge_map m ON m.old_id = x.val
      )
    $sql$;
  END IF;
END;
$$;

UPDATE public.organizations o
SET is_active = false,
    updated_at = now(),
    name = CASE
      WHEN o.name LIKE '% [MERGED %]%' THEN o.name
      ELSE o.name || ' [MERGED ' || to_char(now(), 'YYYY-MM-DD') || ']'
    END
FROM ncc_merge_map m
WHERE o.id = m.old_id;

COMMIT;