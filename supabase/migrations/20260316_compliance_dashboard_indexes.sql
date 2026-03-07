-- ============================================================================
-- Compliance dashboard performance: indexes for deleted_at queries
-- Date: 2026-03-16
--
-- The compliance dashboard now filters observations by deleted_at IS NULL to
-- exclude soft-deleted records. These indexes ensure those queries remain fast.
-- ============================================================================

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

-- ── Verification ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '✅ 20260316_compliance_dashboard_indexes complete';
  RAISE NOTICE '   Indexes added for observations.deleted_at compliance dashboard queries';
END;
$$;
