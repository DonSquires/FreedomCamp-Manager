-- =============================================================================
-- Vehicle Discrepancy Detection
-- =============================================================================
-- Adds infrastructure to track when cross-source data (NZSCV, inference,
-- canonical_vehicles, MotorWeb) disagrees on vehicle details, or when SC
-- sticker presence on the vehicle conflicts with the NZSCV register.
--
-- The Freedom Camping (Self-Contained Vehicles) Amendment Act enforcement
-- date is 1 June 2026.  Discrepancies recorded before that date carry
-- severity = 'warning'; from that date onwards any SC mismatch becomes
-- 'critical' to reflect the legal obligation.
-- =============================================================================

-- 1. New columns on observations ------------------------------------------
ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS has_discrepancies  boolean     DEFAULT false,
  ADD COLUMN IF NOT EXISTS discrepancy_flags  jsonb;

COMMENT ON COLUMN public.observations.has_discrepancies IS
  'true when process-officer-scan found one or more data discrepancies for this observation';
COMMENT ON COLUMN public.observations.discrepancy_flags IS
  'Summary array of discrepancy objects: [{type, severity, source_a, source_b, value_a, value_b}]';

-- 2. vehicle_discrepancies table ------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicle_discrepancies (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  observation_id   uuid        NOT NULL REFERENCES public.observations(observation_id) ON DELETE CASCADE,
  plate_number     text,
  organization_id  uuid        REFERENCES public.organizations(id) ON DELETE SET NULL,
  zone_id          uuid        REFERENCES public.zones(id) ON DELETE SET NULL,

  -- What kind of disagreement was detected
  -- Allowed values:
  --   make_mismatch            - inference/canonical/NZSCV disagree on make
  --   model_mismatch           - same for model
  --   colour_mismatch          - same for colour
  --   plate_mismatch_same_vehicle - embedding similarity high but different plate (potential cloning)
  --   sc_sticker_not_in_register - physical sticker present but not on NZSCV register
  --   sc_in_register_no_sticker  - on NZSCV register but no physical sticker detected
  --   sc_sticker_inconclusive    - sticker detection was null/inconclusive (needs manual review)
  discrepancy_type text        NOT NULL,

  -- Which two data sources disagree
  source_a         text        NOT NULL,  -- 'canonical' | 'nzscv' | 'inference' | 'motorweb' | 'alpr'
  source_b         text        NOT NULL,

  -- The conflicting values from each source
  value_a          text,
  value_b          text,

  -- 'warning' = advisory; 'critical' = requires immediate attention / potential fraud
  severity         text        NOT NULL DEFAULT 'warning',

  -- Whether the SC enforcement law applies at the time of this observation
  sc_law_active    boolean     DEFAULT false,

  -- Full detail payload for audit trail
  details          jsonb,

  requires_review  boolean     DEFAULT true,
  reviewed_at      timestamptz,
  reviewed_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes     text,
  created_at       timestamptz DEFAULT now(),

  CONSTRAINT vehicle_discrepancies_discrepancy_type_check
    CHECK (discrepancy_type IN (
      'make_mismatch',
      'model_mismatch',
      'colour_mismatch',
      'plate_mismatch_same_vehicle',
      'sc_sticker_not_in_register',
      'sc_in_register_no_sticker',
      'sc_sticker_inconclusive'
    )),
  CONSTRAINT vehicle_discrepancies_severity_check
    CHECK (severity IN ('warning', 'critical')),
  CONSTRAINT vehicle_discrepancies_source_a_check
    CHECK (source_a IN ('canonical', 'nzscv', 'inference', 'motorweb', 'alpr', 'observation')),
  CONSTRAINT vehicle_discrepancies_source_b_check
    CHECK (source_b IN ('canonical', 'nzscv', 'inference', 'motorweb', 'alpr', 'observation'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vehicle_discrepancies_observation_id
  ON public.vehicle_discrepancies (observation_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_discrepancies_plate_number
  ON public.vehicle_discrepancies (plate_number)
  WHERE plate_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_discrepancies_org_severity
  ON public.vehicle_discrepancies (organization_id, severity, created_at DESC)
  WHERE requires_review = true;

CREATE INDEX IF NOT EXISTS idx_vehicle_discrepancies_type
  ON public.vehicle_discrepancies (discrepancy_type, created_at DESC);

-- 3. Row Level Security ------------------------------------------------------
ALTER TABLE public.vehicle_discrepancies ENABLE ROW LEVEL SECURITY;

-- Admins / master can see all discrepancies in their org
CREATE POLICY "org_admins_see_discrepancies"
  ON public.vehicle_discrepancies
  FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM public.user_profiles
      WHERE role IN ('admin', 'master', 'admin_officer')
        AND (organization_id = vehicle_discrepancies.organization_id OR role = 'master')
    )
  );

-- Officers can see discrepancies for their own observations
CREATE POLICY "officers_see_own_discrepancies"
  ON public.vehicle_discrepancies
  FOR SELECT
  USING (
    auth.uid() IN (
      SELECT recorded_by FROM public.observations
      WHERE observation_id = vehicle_discrepancies.observation_id
    )
  );

-- Service role can insert / update (edge functions run as service role)
CREATE POLICY "service_role_manage_discrepancies"
  ON public.vehicle_discrepancies
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Admins can mark discrepancies as reviewed
CREATE POLICY "admins_update_review"
  ON public.vehicle_discrepancies
  FOR UPDATE
  USING (
    auth.uid() IN (
      SELECT id FROM public.user_profiles
      WHERE role IN ('admin', 'master', 'admin_officer')
        AND (organization_id = vehicle_discrepancies.organization_id OR role = 'master')
    )
  )
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM public.user_profiles
      WHERE role IN ('admin', 'master', 'admin_officer')
        AND (organization_id = vehicle_discrepancies.organization_id OR role = 'master')
    )
  );

-- 4. Notify log ---------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE '✅ vehicle_discrepancies table created';
  RAISE NOTICE '   + observations.has_discrepancies  boolean  DEFAULT false';
  RAISE NOTICE '   + observations.discrepancy_flags  jsonb';
END;
$$;
