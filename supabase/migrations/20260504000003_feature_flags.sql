-- Migration: Feature Flags Infrastructure
-- Date: 2026-05-04
-- Purpose: Enable controlled rollout of Phase B features with canary → early-adopter → full rollout patterns

-- ============================================================================
-- PART 1: Feature Flags Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Flag identity (naming pattern: FF_PHASE_[A-E]_[FEATURE_NAME])
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  phase TEXT CHECK (phase IN ('A', 'B', 'C', 'D', 'E')),
  
  -- Global enable/disable
  enabled BOOLEAN NOT NULL DEFAULT false,
  
  -- Rollout percentage (0-100)
  -- Used for A/B testing and gradual rollout: 5% → 25% → 50% → 100%
  rollout_percentage INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
  
  -- Canary thresholds for automatic rollback
  canary_error_rate_threshold DECIMAL(5, 2) DEFAULT 1.00, -- Max error % before rollback: < 1%
  canary_p95_latency_threshold_ms INTEGER DEFAULT 500,     -- Max p95 latency before rollback
  
  -- Rollout strategy
  rollout_strategy TEXT DEFAULT 'percentage'
    CHECK (rollout_strategy IN ('percentage', 'user_list', 'org_list', 'gradual')),
  
  -- Special cases: explicit user/org allowlists
  allowed_user_ids UUID[] DEFAULT array[]::UUID[],
  allowed_org_ids UUID[] DEFAULT array[]::UUID[],
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  modified_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

-- RLS: Enable row level security
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

-- RLS Policy: All authenticated users can read feature flags
DROP POLICY IF EXISTS "users_read_feature_flags" ON public.feature_flags;
CREATE POLICY "users_read_feature_flags" ON public.feature_flags
  FOR SELECT USING (true);

-- RLS Policy: Only admins can modify feature flags
DROP POLICY IF EXISTS "admins_manage_feature_flags" ON public.feature_flags;
CREATE POLICY "admins_manage_feature_flags" ON public.feature_flags
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'master')
    )
  );

COMMENT ON TABLE public.feature_flags IS
  'Phase B+ feature rollout control with canary thresholds and gradual rollout patterns';
COMMENT ON COLUMN public.feature_flags.name IS
  'Naming pattern: FF_PHASE_[A-E]_[FEATURE_NAME], e.g., FF_PHASE_B_PATROL_EVENTS or FF_PHASE_B_DISPATCH_ACK';
COMMENT ON COLUMN public.feature_flags.rollout_percentage IS
  'Gradual rollout: 5% (canary) → 25% (early adopters) → 50% (rollout) → 100% (general availability)';
COMMENT ON COLUMN public.feature_flags.canary_error_rate_threshold IS
  'If monitored error rate exceeds this (%), auto-rollback to 0% enabled flag or previous state';
COMMENT ON COLUMN public.feature_flags.canary_p95_latency_threshold_ms IS
  'If monitored p95 latency exceeds this (ms), flag degradation alert or auto-rollback';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_feature_flags_name
  ON public.feature_flags(name);

CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled
  ON public.feature_flags(enabled, rollout_percentage DESC);

CREATE INDEX IF NOT EXISTS idx_feature_flags_phase
  ON public.feature_flags(phase);

-- ============================================================================
-- PART 2: Feature Flag Evaluations (Audit Trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.feature_flag_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  flag_id UUID NOT NULL REFERENCES public.feature_flags(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  
  -- Evaluation result
  enabled BOOLEAN NOT NULL DEFAULT false,
  rollout_bucket INTEGER, -- 0-99, used for consistent hashing
  
  -- Context
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  evaluation_context JSONB, -- Additional context for decision
  
  created_by UUID DEFAULT auth.uid()
);

-- RLS: Only admins can read evaluations
ALTER TABLE public.feature_flag_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_evaluations" ON public.feature_flag_evaluations;
CREATE POLICY "admins_read_evaluations" ON public.feature_flag_evaluations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'master')
    )
  );

COMMENT ON TABLE public.feature_flag_evaluations IS
  'Audit trail: log each feature flag evaluation for monitoring and troubleshooting';

CREATE INDEX IF NOT EXISTS idx_feature_flag_evaluations_flag
  ON public.feature_flag_evaluations(flag_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_feature_flag_evaluations_user
  ON public.feature_flag_evaluations(user_id, evaluated_at DESC);

-- ============================================================================
-- PART 3: Feature Flag Rollout History
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.feature_flag_rollout_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  flag_id UUID NOT NULL REFERENCES public.feature_flags(id) ON DELETE CASCADE,
  
  -- Rollout stage
  from_percentage INTEGER NOT NULL DEFAULT 0,
  to_percentage INTEGER NOT NULL DEFAULT 0,
  stage TEXT,  -- 'canary' / 'early_adopters' / 'rollout' / 'general_availability' / 'rollback'
  
  -- Change metadata
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  
  -- Monitoring snapshot at time of change
  error_rate_at_change DECIMAL(5, 2),
  p95_latency_at_change_ms INTEGER,
  monitoring_notes TEXT,
  
  change_reason TEXT, -- 'manual_increase' / 'manual_rollback' / 'auto_rollback_error' / 'auto_rollback_latency'
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_flag_rollout_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_rollout_history" ON public.feature_flag_rollout_history;
CREATE POLICY "users_read_rollout_history" ON public.feature_flag_rollout_history
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "admins_log_rollout_history" ON public.feature_flag_rollout_history;
CREATE POLICY "admins_log_rollout_history" ON public.feature_flag_rollout_history
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'master')
    )
  );

COMMENT ON TABLE public.feature_flag_rollout_history IS
  'Complete audit trail of all rollout percentage changes with monitoring snapshots';

CREATE INDEX IF NOT EXISTS idx_rollout_history_flag
  ON public.feature_flag_rollout_history(flag_id, changed_at DESC);

-- ============================================================================
-- PART 4: Helper Function: Evaluate Feature Flag for User
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_feature_enabled(
  flag_name TEXT,
  user_org_id UUID DEFAULT NULL
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  flag_row record;
  user_id UUID;
  bucket INTEGER;
  is_enabled BOOLEAN;
BEGIN
  user_id := auth.uid();
  
  -- Get the user's organization if not provided
  IF user_org_id IS NULL AND user_id IS NOT NULL THEN
    SELECT organization_id INTO user_org_id
    FROM public.user_profiles
    WHERE id = user_id;
  END IF;
  
  -- Fetch flag configuration
  SELECT * INTO flag_row FROM public.feature_flags WHERE name = flag_name;
  
  IF flag_row IS NULL THEN
    -- Flag doesn't exist, default to disabled
    RETURN false;
  END IF;
  
  -- If globally disabled, return false
  IF NOT flag_row.enabled THEN
    RETURN false;
  END IF;
  
  -- Check explicit allowlists
  IF user_id = ANY(flag_row.allowed_user_ids) THEN
    RETURN true;
  END IF;
  
  IF user_org_id = ANY(flag_row.allowed_org_ids) THEN
    RETURN true;
  END IF;
  
  -- Percentage-based rollout using consistent hashing
  IF flag_row.rollout_strategy = 'percentage' THEN
    -- Hash user_id to consistent bucket (0-99)
    bucket := (('x' || lpad(substr(md5(COALESCE(user_id::text, user_org_id::text)), 1, 8), 8, '0'))::bit(32)::int) % 100;
    is_enabled := bucket < flag_row.rollout_percentage;
    RETURN is_enabled;
  END IF;
  
  -- Default to enabled percentage for other strategies
  RETURN flag_row.rollout_percentage > 0;
END; $$;

COMMENT ON FUNCTION public.is_feature_enabled(TEXT, UUID) IS
  'Evaluate whether a feature flag is enabled for a user or organization (consistent hashing for rollout)';

-- ============================================================================
-- PART 5: Phase B Feature Flags (Seed Data)
-- ============================================================================

INSERT INTO public.feature_flags (
  name,
  description,
  phase,
  enabled,
  rollout_percentage,
  rollout_strategy,
  created_by
) VALUES
  (
    'FF_PHASE_B_PATROL_EVENTS',
    'Enable new patrol_events table integration in field officer portal',
    'B',
    false,
    0,
    'percentage',
    null
  ),
  (
    'FF_PHASE_B_DISPATCH_ACK',
    'Enable new dispatch acknowledgement flow with case model',
    'B',
    false,
    0,
    'percentage',
    null
  ),
  (
    'FF_PHASE_B_ENFORCEMENT_TIMELINE',
    'Enable enforcement timeline creation from operational_cases',
    'B',
    false,
    0,
    'percentage',
    null
  ),
  (
    'FF_PHASE_C_SECURITY_ASSISTIVE',
    'Enable security assistive surfaces with shared case model',
    'C',
    false,
    0,
    'percentage',
    null
  ),
  (
    'FF_PHASE_D_BOB_INTEGRATION',
    'Enable Bob AI assistant integration with approval workflows',
    'D',
    false,
    0,
    'percentage',
    null
  )
ON CONFLICT (name) DO NOTHING;

COMMENT ON TABLE public.feature_flags IS
  'Phase B+ feature rollout control with canary thresholds and gradual rollout patterns';

-- ============================================================================
-- PART 6: Grants
-- ============================================================================

GRANT SELECT, INSERT, UPDATE ON public.feature_flags TO authenticated;
GRANT SELECT ON public.feature_flag_evaluations TO authenticated;
GRANT SELECT ON public.feature_flag_rollout_history TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_feature_enabled(TEXT, UUID) TO authenticated;

-- End of feature flags infrastructure
-- Status: Phase A Week 2 Foundation
-- Approved by: Platform Infra Team
-- Date: 2026-05-04
