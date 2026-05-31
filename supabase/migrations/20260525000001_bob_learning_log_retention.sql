-- Migration: Bob learning-log retention policy and purge function
-- Purpose: prevent unbounded growth in bob_learning_log
-- Date: 2026-05-25

-- Optional org-level retention policy. Defaults to 90 days when no row exists.
CREATE TABLE IF NOT EXISTS public.bob_memory_retention_policy (
  policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations NOT NULL,
  table_name TEXT NOT NULL,
  retention_days INTEGER NOT NULL DEFAULT 90 CHECK (retention_days > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, table_name)
);

CREATE INDEX IF NOT EXISTS idx_bob_memory_retention_policy_table
  ON public.bob_memory_retention_policy(table_name, organization_id);

-- Purge function:
-- - p_org_id NULL: purge all orgs using their configured retention or default
-- - p_org_id set : purge one org only
CREATE OR REPLACE FUNCTION public.purge_old_bob_learning_log(
  p_org_id UUID DEFAULT NULL,
  p_default_retention_days INTEGER DEFAULT 90
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER := 0;
BEGIN
  IF p_default_retention_days IS NULL OR p_default_retention_days <= 0 THEN
    p_default_retention_days := 90;
  END IF;

  IF p_org_id IS NULL THEN
    WITH deleted AS (
      DELETE FROM public.bob_learning_log bll
      WHERE bll.created_at < (
        now() - make_interval(days => COALESCE((
          SELECT policy.retention_days
          FROM public.bob_memory_retention_policy policy
          WHERE policy.organization_id = bll.organization_id
            AND policy.table_name = 'bob_learning_log'
          LIMIT 1
        ), p_default_retention_days))
      )
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_deleted FROM deleted;
  ELSE
    WITH deleted AS (
      DELETE FROM public.bob_learning_log bll
      WHERE bll.organization_id = p_org_id
        AND bll.created_at < (
          now() - make_interval(days => COALESCE((
            SELECT policy.retention_days
            FROM public.bob_memory_retention_policy policy
            WHERE policy.organization_id = p_org_id
              AND policy.table_name = 'bob_learning_log'
            LIMIT 1
          ), p_default_retention_days))
        )
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_deleted FROM deleted;
  END IF;

  RETURN COALESCE(v_deleted, 0);
END;
$$;
