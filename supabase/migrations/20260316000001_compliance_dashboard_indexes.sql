-- ============================================================================
-- Compliance dashboard performance: indexes for deleted_at queries
-- Date: 2026-03-16
--
-- The compliance dashboard now filters observations by deleted_at IS NULL to
-- exclude soft-deleted records. These indexes ensure those queries remain fast.
-- ============================================================================

DO $$
DECLARE
  v_has_deleted_at boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'observations'
      AND column_name = 'deleted_at'
  ) INTO v_has_deleted_at;

  IF v_has_deleted_at THEN
    -- Partial index: active (not soft-deleted) observations ordered by recorded_at
    CREATE INDEX IF NOT EXISTS idx_obs_active_recorded_at
      ON public.observations (recorded_at DESC)
      WHERE deleted_at IS NULL;

    -- Partial index: active non-compliant observations (breach list)
    CREATE INDEX IF NOT EXISTS idx_obs_active_non_compliant
      ON public.observations (recorded_at DESC, organization_id)
      WHERE deleted_at IS NULL AND is_compliant = false;

    -- Composite index: org + date range + active (OverviewTab KPI queries)
    CREATE INDEX IF NOT EXISTS idx_obs_org_recorded_active
      ON public.observations (organization_id, recorded_at DESC)
      WHERE deleted_at IS NULL;
  ELSE
    -- Fallback indexes for schemas without soft-delete support.
    CREATE INDEX IF NOT EXISTS idx_obs_active_recorded_at
      ON public.observations (recorded_at DESC);

    CREATE INDEX IF NOT EXISTS idx_obs_active_non_compliant
      ON public.observations (recorded_at DESC, organization_id)
      WHERE is_compliant = false;

    CREATE INDEX IF NOT EXISTS idx_obs_org_recorded_active
      ON public.observations (organization_id, recorded_at DESC);
  END IF;
END;
$$;

-- ── Verification ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '✅ 20260316_compliance_dashboard_indexes complete';
  RAISE NOTICE '   Compatible indexes added for observations compliance dashboard queries';
END;
$$;
