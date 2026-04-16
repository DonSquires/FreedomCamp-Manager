-- =============================================================================
-- Smoke Complaint Out-of-Hours (OOH) Module
-- Resource Management Act 1991 (NZ) + local Fire & Smoke Nuisance Bylaws
-- compliant smoke nuisance enforcement workflow.
--
-- Officers assess whether smoke discharge is "offensive or objectionable"
-- beyond the property boundary, per RMA s.17A.
--
-- Number formats:
--   SMK-2026-000001  – smoke jobs
--   SMN-2026-000001  – smoke notices
-- =============================================================================

-- ── smoke_jobs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.smoke_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  job_number          TEXT NOT NULL,         -- e.g. "SMK-2026-000001"
  title               TEXT NOT NULL,
  complaint_source    TEXT NOT NULL DEFAULT 'public'
                        CHECK (complaint_source IN (
                          'public', 'officer_initiated', 'council_referral', 'repeat_trigger'
                        )),
  complainant_ref     TEXT,                  -- internal ref (no PII stored here)
  address             TEXT NOT NULL,
  suburb              TEXT,
  city                TEXT,
  gps_lat             DOUBLE PRECISION,
  gps_lng             DOUBLE PRECISION,
  complaint_time      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_out_of_hours     BOOLEAN NOT NULL DEFAULT false,  -- auto-set based on complaint_time
  priority            TEXT NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending', 'assigned', 'en_route', 'on_scene',
                          'completed', 'cancelled', 'referred'
                        )),
  -- Assignment
  assigned_to         UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  assigned_at         TIMESTAMPTZ,
  dispatched_by       UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  -- Context flags
  has_prior_notice    BOOLEAN NOT NULL DEFAULT false,
  has_repeat_offender BOOLEAN NOT NULL DEFAULT false,
  prior_notice_count  INTEGER NOT NULL DEFAULT 0,
  safety_notes        TEXT,
  complaint_description TEXT,
  -- Completion
  completed_at        TIMESTAMPTZ,
  completed_by        UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  outcome             TEXT,
  outcome_notes       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, job_number)
);

-- ── smoke_job_counters ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.smoke_job_counters (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_number     INTEGER NOT NULL DEFAULT 0
);

-- ── smoke_assessments ─────────────────────────────────────────────────────────
-- Officer's formal on-scene evidence record. Bob AI populates most fields from
-- photo/video analysis; officer confirms before submitting.
CREATE TABLE IF NOT EXISTS public.smoke_assessments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  smoke_job_id                UUID REFERENCES public.smoke_jobs(id) ON DELETE SET NULL,
  officer_id                  UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  assessed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  address                     TEXT NOT NULL,
  gps_lat                     DOUBLE PRECISION,
  gps_lng                     DOUBLE PRECISION,

  -- Smoke visual characteristics (AI-detected + officer confirmed)
  smoke_opacity               TEXT CHECK (smoke_opacity IN (
                                'light', 'moderate', 'heavy', 'very_heavy', 'black'
                              )),
  smoke_color                 TEXT CHECK (smoke_color IN (
                                'white', 'light_grey', 'grey', 'dark_grey',
                                'black', 'brown', 'yellow'
                              )),
  smoke_continuous            BOOLEAN,       -- continuous vs intermittent
  smoke_duration_minutes      INTEGER,       -- observed/reported duration

  -- Duration log for multi-observation visits
  duration_log                JSONB,         -- [{time, intensity, notes}]

  -- Fire type
  fire_type                   TEXT CHECK (fire_type IN (
                                'residential_domestic', 'burn_off', 'industrial',
                                'open_fire', 'barrel_fire', 'unknown'
                              )),

  -- Prohibited materials assessment
  prohibited_materials_suspected BOOLEAN DEFAULT false,
  materials_checklist         JSONB,         -- {treated_timber, plastics, rubber_tyres, green_waste, household_rubbish, chemicals} — each bool
  materials_notes             TEXT,

  -- Sensory assessment
  odor_description            TEXT CHECK (odor_description IN (
                                'none', 'wood_smoke', 'acrid_chemical', 'plastic_like',
                                'noxious', 'other'
                              )),
  odor_offensive              BOOLEAN,

  -- Wind / drift assessment (AI from photo/video + weather API)
  wind_speed_kmh              NUMERIC(5,1),
  wind_direction              TEXT,          -- N/NE/E/SE/S/SW/W/NW
  smoke_drifting_direction    TEXT,
  smoke_affecting_neighbors   BOOLEAN,
  smoke_affecting_road        BOOLEAN,       -- obstructing road visibility
  neighbor_impact_description TEXT,

  -- Physical sample
  sample_taken                BOOLEAN DEFAULT false,
  sample_type                 TEXT CHECK (sample_type IN ('ash', 'unburnt_material', 'other')),

  -- Weather conditions (auto-populated via weather API or manual entry)
  weather_conditions          JSONB,         -- {temp_c, wind_speed_kmh, wind_direction, rainfall_mm, conditions}

  -- Media evidence
  photos                      TEXT[],
  video_url                   TEXT,

  -- AI analysis result
  ai_assessment               JSONB,         -- full raw AI response
  ai_confidence               NUMERIC(4,3),
  ai_recommendation           TEXT,

  -- Officer professional opinion (required before issuing notice)
  officer_professional_opinion TEXT,

  -- Checklist responses
  checklist_responses         JSONB,

  -- Action determination
  recommended_action          TEXT CHECK (recommended_action IN (
                                'no_action', 'verbal_warning', 'abatement_notice',
                                'infringement_notice', 'prosecution_referral'
                              )),
  action_notes                TEXT,

  -- Witness statements
  witness_statements          JSONB,         -- [{name, contact, statement}]

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── smoke_notices ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.smoke_notices (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  notice_number           TEXT NOT NULL,     -- e.g. "SMN-2026-000001"
  smoke_assessment_id     UUID REFERENCES public.smoke_assessments(id) ON DELETE SET NULL,
  smoke_job_id            UUID REFERENCES public.smoke_jobs(id) ON DELETE SET NULL,

  notice_type             TEXT NOT NULL CHECK (notice_type IN (
                            'abatement_notice', 'infringement_notice', 'prosecution_referral'
                          )),

  -- Recipient
  recipient_name          TEXT NOT NULL,
  recipient_address       TEXT NOT NULL,
  recipient_phone         TEXT,
  recipient_email         TEXT,

  -- Notice details
  offence_description     TEXT NOT NULL,
  rma_section             TEXT DEFAULT 'RMA s.17A',
  issued_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  comply_by               TIMESTAMPTZ,

  -- Financial penalty
  penalty_amount_nzd      NUMERIC(10,2),     -- typically $300–$1,000

  -- Status
  status                  TEXT NOT NULL DEFAULT 'issued'
                            CHECK (status IN (
                              'issued', 'complied', 'breached', 'escalated',
                              'withdrawn', 'court_referred', 'paid'
                            )),
  complied_at             TIMESTAMPTZ,
  escalation_notes        TEXT,

  -- Officer / authority
  issuing_officer_id      UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  issuing_officer_name    TEXT,
  authority               TEXT,              -- e.g. "Christchurch City Council"

  -- Evidence
  evidence_photos         TEXT[],
  pdf_url                 TEXT,

  -- Flags
  previous_notice_count   INTEGER NOT NULL DEFAULT 0,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, notice_number)
);

-- ── smoke_notice_counters ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.smoke_notice_counters (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_number     INTEGER NOT NULL DEFAULT 0
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_smoke_jobs_org
  ON public.smoke_jobs(organization_id);
CREATE INDEX IF NOT EXISTS idx_smoke_jobs_status
  ON public.smoke_jobs(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_smoke_jobs_assigned
  ON public.smoke_jobs(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_smoke_assessments_org
  ON public.smoke_assessments(organization_id);
CREATE INDEX IF NOT EXISTS idx_smoke_assessments_job
  ON public.smoke_assessments(smoke_job_id);
CREATE INDEX IF NOT EXISTS idx_smoke_assessments_gps
  ON public.smoke_assessments(gps_lat, gps_lng) WHERE gps_lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_smoke_notices_org
  ON public.smoke_notices(organization_id);
CREATE INDEX IF NOT EXISTS idx_smoke_notices_status
  ON public.smoke_notices(organization_id, status);

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.smoke_jobs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smoke_job_counters      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smoke_assessments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smoke_notices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smoke_notice_counters   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "smoke_jobs_org_rw" ON public.smoke_jobs
  USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "smoke_job_counters_org_rw" ON public.smoke_job_counters
  USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "smoke_assessments_org_rw" ON public.smoke_assessments
  USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "smoke_notices_org_rw" ON public.smoke_notices
  USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
CREATE POLICY "smoke_notice_counters_org_rw" ON public.smoke_notice_counters
  USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));

-- grand_master cross-org read
CREATE POLICY "smoke_jobs_gm_read" ON public.smoke_jobs FOR SELECT
  USING ((SELECT role FROM public.user_profiles WHERE id = auth.uid()) = 'grand_master');
CREATE POLICY "smoke_assessments_gm_read" ON public.smoke_assessments FOR SELECT
  USING ((SELECT role FROM public.user_profiles WHERE id = auth.uid()) = 'grand_master');
CREATE POLICY "smoke_notices_gm_read" ON public.smoke_notices FOR SELECT
  USING ((SELECT role FROM public.user_profiles WHERE id = auth.uid()) = 'grand_master');

-- ── Sequential number functions ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._next_smoke_seq(
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

CREATE OR REPLACE FUNCTION public.next_smoke_job_number(p_org_id UUID)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT public._next_smoke_seq(p_org_id, 'smoke_job_counters', 'SMK');
$$;

CREATE OR REPLACE FUNCTION public.next_smoke_notice_number(p_org_id UUID)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT public._next_smoke_seq(p_org_id, 'smoke_notice_counters', 'SMN');
$$;

-- ── updated_at triggers ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_smoke_jobs_updated_at') THEN
    CREATE TRIGGER trg_smoke_jobs_updated_at
      BEFORE UPDATE ON public.smoke_jobs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_smoke_notices_updated_at') THEN
    CREATE TRIGGER trg_smoke_notices_updated_at
      BEFORE UPDATE ON public.smoke_notices FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END;
$$;
