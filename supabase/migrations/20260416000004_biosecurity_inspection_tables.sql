-- =============================================================================
-- Biosecurity Inspection Module
-- Biosecurity Act 1993 (NZ) compliant enforcement workflow for invasive plants
-- (primarily Chilean Needlegrass / Nassella neesiana and related species).
--
-- Workflow:
--   1. Admin dispatches biosecurity job to field officer
--   2. Officer attends, photos/videos site, Bob AI identifies plants + density
--   3. Officer completes pre-populated checklist, confirms ID, selects action
--   4. Notice of Direction / Infringement issued if required
--
-- Number formats:
--   BIO-2026-000001  – biosecurity jobs
--   BIN-2026-000001  – biosecurity notices
-- =============================================================================

-- ── biosecurity_jobs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.biosecurity_jobs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_number              TEXT NOT NULL,           -- e.g. "BIO-2026-000001"
  title                   TEXT NOT NULL,
  complaint_source        TEXT NOT NULL DEFAULT 'public'
                            CHECK (complaint_source IN (
                              'public', 'officer_initiated', 'council_referral',
                              'mpi_referral', 'landowner_report'
                            )),
  inspection_type         TEXT NOT NULL DEFAULT 'complaint'
                            CHECK (inspection_type IN (
                              'routine', 'complaint', 'follow_up', 'targeted'
                            )),
  address                 TEXT NOT NULL,
  gps_lat                 DOUBLE PRECISION,
  gps_lng                 DOUBLE PRECISION,
  property_owner_name     TEXT,
  property_owner_contact  TEXT,
  priority                TEXT NOT NULL DEFAULT 'normal'
                            CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN (
                              'pending', 'assigned', 'en_route', 'on_scene',
                              'completed', 'cancelled', 'referred'
                            )),
  -- Assignment
  assigned_to             UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  assigned_at             TIMESTAMPTZ,
  dispatched_by           UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  -- Pre-dispatch context flags shown to officer
  has_prior_notice        BOOLEAN NOT NULL DEFAULT false,
  has_management_plan     BOOLEAN NOT NULL DEFAULT false,
  prior_notice_count      INTEGER NOT NULL DEFAULT 0,
  prior_notice_summary    TEXT,
  safety_notes            TEXT,
  -- Completion
  completed_at            TIMESTAMPTZ,
  completed_by            UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  outcome                 TEXT,
  outcome_notes           TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, job_number)
);

-- ── biosecurity_job_counters ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.biosecurity_job_counters (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_number     INTEGER NOT NULL DEFAULT 0
);

-- ── biosecurity_assessments ──────────────────────────────────────────────────
-- The formal on-scene evidence record. Bob AI populates most fields from
-- photo/video; officer confirms or corrects before submitting.
CREATE TABLE IF NOT EXISTS public.biosecurity_assessments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  biosecurity_job_id          UUID REFERENCES public.biosecurity_jobs(id) ON DELETE SET NULL,
  officer_id                  UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  assessed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  address                     TEXT NOT NULL,
  gps_lat                     DOUBLE PRECISION,
  gps_lng                     DOUBLE PRECISION,

  -- Primary species (Bob AI best match + officer confirmation)
  plant_species               TEXT,   -- e.g. 'nassella_neesiana', 'nassella_trichotoma', 'other'
  officer_confirmed_species   TEXT,   -- officer-confirmed species after reviewing AI result
  species_list                JSONB,  -- [{name, common_name, confidence, count_estimate, density_per_m2, stage, evidence_features[]}]

  -- Density / scale
  density_estimate            NUMERIC(8,2),  -- plants per m²
  density_category            TEXT CHECK (density_category IN (
                                'isolated', 'low', 'medium', 'high', 'dense'
                              )),
  patch_area_m2               NUMERIC(10,2),
  patch_count                 INTEGER,

  -- Life stage
  infestation_stage           TEXT CHECK (infestation_stage IN (
                                'seedling', 'vegetative', 'flowering', 'seeding', 'dormant'
                              )),

  -- CNG-specific identifiers (AI + officer checklist)
  seed_heads_present          BOOLEAN,  -- reddish-purple nodding spikelets
  basal_seeds_present         BOOLEAN,  -- cleistogenes at leaf sheath base
  cleistogenes_present        BOOLEAN,  -- hidden basal seeds specifically
  leaf_texture_harsh          BOOLEAN,  -- bright yellow-green, rough texture
  awn_visible                 BOOLEAN,  -- long twisted hairy awn visible

  -- Location context
  location_type               TEXT CHECK (location_type IN (
                                'stockyard', 'fenceline', 'vehicle_area', 'woolshed',
                                'earthworks', 'roadside', 'paddock', 'power_pole',
                                'driveway', 'other'
                              )),

  -- Compliance context
  buffer_zone_breached        BOOLEAN,  -- within 5m of property boundary
  buffer_zone_m               NUMERIC(6,2) DEFAULT 5.0,  -- applicable buffer per RPMP
  management_plan_current     BOOLEAN,  -- landowner has current written management plan
  management_plan_ref         TEXT,

  -- Pathway / spread risk evidence
  pathway_evidence            TEXT,     -- contaminated hay, uncleaned machinery, stock movement

  -- Physical sample
  sample_taken                BOOLEAN DEFAULT false,
  sample_ref                  TEXT,     -- lab reference number

  -- Weather conditions at time of assessment
  weather_conditions          JSONB,    -- {temp_c, wind_speed_kmh, wind_direction, rainfall_mm, conditions}

  -- Media evidence
  photos                      TEXT[],
  video_url                   TEXT,

  -- AI analysis result
  ai_species_identification   JSONB,    -- full raw AI response
  ai_confidence               NUMERIC(4,3),
  ai_recommendation           TEXT,

  -- Checklist responses (officer-confirmed answers)
  checklist_responses         JSONB,

  -- Action determination
  recommended_action          TEXT CHECK (recommended_action IN (
                                'no_action', 'advisory', 'notice_of_direction',
                                'infringement', 'referral_to_mpi', 'prosecution'
                              )),
  action_notes                TEXT,

  -- Stock welfare (seedy carcass risk)
  stock_present               BOOLEAN,
  stock_welfare_risk          BOOLEAN,
  stock_welfare_notes         TEXT,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── biosecurity_notices ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.biosecurity_notices (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  notice_number             TEXT NOT NULL,         -- e.g. "BIN-2026-000001"
  biosecurity_assessment_id UUID REFERENCES public.biosecurity_assessments(id) ON DELETE SET NULL,
  biosecurity_job_id        UUID REFERENCES public.biosecurity_jobs(id) ON DELETE SET NULL,

  notice_type               TEXT NOT NULL CHECK (notice_type IN (
                              'notice_of_direction', 'infringement_notice', 'formal_warning'
                            )),

  -- Recipient
  recipient_name            TEXT NOT NULL,
  recipient_address         TEXT NOT NULL,
  recipient_phone           TEXT,
  recipient_email           TEXT,

  -- Notice details
  offence_description       TEXT NOT NULL,
  biosecurity_act_section   TEXT DEFAULT 'Biosecurity Act 1993 s.128',
  species_identified        TEXT,
  infestation_location      TEXT,

  -- Compliance requirements
  comply_by                 TIMESTAMPTZ,
  required_actions          TEXT,       -- what landowner must do (destroy plants, submit plan, etc.)

  -- Financial penalty (infringement)
  penalty_amount_nzd        NUMERIC(10,2),

  -- Status
  status                    TEXT NOT NULL DEFAULT 'issued'
                              CHECK (status IN (
                                'issued', 'complied', 'breached', 'escalated',
                                'withdrawn', 'court_referred', 'paid'
                              )),
  complied_at               TIMESTAMPTZ,
  escalation_notes          TEXT,

  -- Officer / authority
  issuing_officer_id        UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  issuing_officer_name      TEXT,
  authority                 TEXT,        -- e.g. "Marlborough District Council"

  -- Evidence
  evidence_photos           TEXT[],
  pdf_url                   TEXT,
  notes                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, notice_number)
);

-- ── biosecurity_notice_counters ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.biosecurity_notice_counters (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_number     INTEGER NOT NULL DEFAULT 0
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_biosecurity_jobs_org
  ON public.biosecurity_jobs(organization_id);
CREATE INDEX IF NOT EXISTS idx_biosecurity_jobs_status
  ON public.biosecurity_jobs(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_biosecurity_jobs_assigned
  ON public.biosecurity_jobs(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_biosecurity_assessments_org
  ON public.biosecurity_assessments(organization_id);
CREATE INDEX IF NOT EXISTS idx_biosecurity_assessments_job
  ON public.biosecurity_assessments(biosecurity_job_id);
CREATE INDEX IF NOT EXISTS idx_biosecurity_assessments_gps
  ON public.biosecurity_assessments(gps_lat, gps_lng) WHERE gps_lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_biosecurity_notices_org
  ON public.biosecurity_notices(organization_id);
CREATE INDEX IF NOT EXISTS idx_biosecurity_notices_status
  ON public.biosecurity_notices(organization_id, status);

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.biosecurity_jobs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.biosecurity_job_counters      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.biosecurity_assessments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.biosecurity_notices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.biosecurity_notice_counters   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "biosecurity_jobs_org_rw" ON public.biosecurity_jobs
  USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "biosecurity_job_counters_org_rw" ON public.biosecurity_job_counters
  USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "biosecurity_assessments_org_rw" ON public.biosecurity_assessments
  USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "biosecurity_notices_org_rw" ON public.biosecurity_notices
  USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "biosecurity_notice_counters_org_rw" ON public.biosecurity_notice_counters
  USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

-- grand_master cross-org read
CREATE POLICY "biosecurity_jobs_gm_read" ON public.biosecurity_jobs FOR SELECT
  USING ((SELECT role FROM public.user_profiles WHERE id = auth.uid()) = 'grand_master');
CREATE POLICY "biosecurity_assessments_gm_read" ON public.biosecurity_assessments FOR SELECT
  USING ((SELECT role FROM public.user_profiles WHERE id = auth.uid()) = 'grand_master');
CREATE POLICY "biosecurity_notices_gm_read" ON public.biosecurity_notices FOR SELECT
  USING ((SELECT role FROM public.user_profiles WHERE id = auth.uid()) = 'grand_master');

-- ── Sequential number functions ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._next_biosecurity_seq(
  p_org_id UUID,
  p_table  TEXT,
  p_prefix TEXT
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_next INTEGER;
  v_year TEXT := to_char(NOW() AT TIME ZONE 'Pacific/Auckland', 'YYYY');
  v_sql  TEXT;
BEGIN
  v_sql := format(
    'INSERT INTO %I (organization_id, last_number) VALUES ($1, 1)
     ON CONFLICT (organization_id) DO UPDATE
       SET last_number = %I.last_number + 1
     RETURNING last_number',
    p_table, p_table
  );
  EXECUTE v_sql INTO v_next USING p_org_id;
  RETURN p_prefix || '-' || v_year || '-' || lpad(v_next::TEXT, 6, '0');
END; $$;

CREATE OR REPLACE FUNCTION public.next_biosecurity_job_number(p_org_id UUID)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT public._next_biosecurity_seq(p_org_id, 'biosecurity_job_counters', 'BIO');
$$;

CREATE OR REPLACE FUNCTION public.next_biosecurity_notice_number(p_org_id UUID)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT public._next_biosecurity_seq(p_org_id, 'biosecurity_notice_counters', 'BIN');
$$;

-- ── updated_at triggers ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_biosecurity_jobs_updated_at') THEN
    CREATE TRIGGER trg_biosecurity_jobs_updated_at
      BEFORE UPDATE ON public.biosecurity_jobs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_biosecurity_notices_updated_at') THEN
    CREATE TRIGGER trg_biosecurity_notices_updated_at
      BEFORE UPDATE ON public.biosecurity_notices FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END;
$$;
