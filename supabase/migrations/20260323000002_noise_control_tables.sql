-- ============================================================
-- Noise Control Management Module
-- NZ RMA s.326-333 compliant noise enforcement workflow:
--   Abatement Notice (AN), Direction Notice (DN),
--   Enforcement Notice (END), equipment seizure, financial
--   penalties, and officer job dispatch.
-- ============================================================

-- ── noise_jobs ───────────────────────────────────────────────
-- Admin-dispatched noise complaint jobs sent to field officers.
-- Contains all context the officer needs before attending:
-- prior notices, permanent orders, H&S flags, address history.
CREATE TABLE IF NOT EXISTS noise_jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_number            TEXT NOT NULL,            -- e.g. "NCJ-2026-000007"
  title                 TEXT NOT NULL,
  complaint_source      TEXT NOT NULL DEFAULT 'public'
                          CHECK (complaint_source IN ('public','officer_initiated','police_referral','council_referral','repeat_trigger')),
  complainant_ref       TEXT,                     -- internal reference (no PII stored here)
  address               TEXT NOT NULL,
  suburb                TEXT,
  city                  TEXT,
  gps_lat               DOUBLE PRECISION,
  gps_lng               DOUBLE PRECISION,
  noise_type            TEXT NOT NULL DEFAULT 'music'
                          CHECK (noise_type IN ('music','party','machinery','construction','barking_dog','industrial','motor_vehicle','other')),
  complaint_description TEXT,
  priority              TEXT NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('low','normal','high','urgent')),
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','assigned','en_route','on_scene','completed','cancelled','referred')),
  assigned_to           UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  assigned_at           TIMESTAMPTZ,
  dispatched_by         UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  eta_minutes           INTEGER,
  -- Context flags shown to officer before attendance
  has_prior_end         BOOLEAN NOT NULL DEFAULT false,  -- prior Enforcement Notice exists
  has_permanent_end     BOOLEAN NOT NULL DEFAULT false,  -- permanent END/court order in place
  has_hs_incident       BOOLEAN NOT NULL DEFAULT false,  -- H&S incident at this address
  has_prior_abatement   BOOLEAN NOT NULL DEFAULT false,  -- prior abatement notice issued
  prior_notice_count    INTEGER NOT NULL DEFAULT 0,
  prior_notice_summary  TEXT,                            -- AI/admin-populated summary
  address_history_notes TEXT,                            -- notes from previous visits
  safety_notes          TEXT,                            -- H&S briefing for officer
  -- Completion
  completed_at          TIMESTAMPTZ,
  completed_by          UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  outcome               TEXT,
  outcome_notes         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, job_number)
);

-- ── noise_job_counter ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS noise_job_counters (
  organization_id       UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  last_number           INTEGER NOT NULL DEFAULT 0
);

-- ── noise_assessments ────────────────────────────────────────
-- Officer's on-scene noise assessment — the formal measurement
-- and observation record required before issuing any notice.
-- Mirrors the NZ council noise assessment process: identify
-- source, measure/estimate dB, classify vs. district plan
-- limits, determine appropriate action.
CREATE TABLE IF NOT EXISTS noise_assessments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  noise_job_id          UUID REFERENCES noise_jobs(id) ON DELETE SET NULL,
  officer_id            UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  assessed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  address               TEXT NOT NULL,
  gps_lat               DOUBLE PRECISION,
  gps_lng               DOUBLE PRECISION,
  -- Measurement
  noise_level_db        NUMERIC(5,1),               -- estimated/measured dB(A)
  measurement_method    TEXT NOT NULL DEFAULT 'estimated'
                          CHECK (measurement_method IN ('estimated','sound_meter','app_meter','council_meter')),
  measurement_location  TEXT,                        -- e.g. "boundary of property"
  noise_type            TEXT,
  noise_source          TEXT,                        -- "residential stereo music"
  noise_source_address  TEXT,                        -- address noise is coming FROM
  -- Assessment
  exceeds_district_plan BOOLEAN,
  time_category         TEXT NOT NULL DEFAULT 'day'
                          CHECK (time_category IN ('day','evening','night')),  -- affects limit thresholds
  zone_classification   TEXT,                        -- e.g. "residential_low_density"
  district_plan_limit_db NUMERIC(5,1),               -- applicable limit
  -- Scene details
  persons_present       INTEGER,
  responsible_person_name TEXT,
  responsible_person_warned BOOLEAN DEFAULT false,
  verbal_warning_given  BOOLEAN DEFAULT false,
  -- Photos
  photos                TEXT[],
  address_photo_url     TEXT,                        -- required: photo of property address
  -- Recommended action
  recommended_action    TEXT NOT NULL DEFAULT 'monitor'
                          CHECK (recommended_action IN ('no_action','verbal_warning','abatement_notice','direction_notice','enforcement_notice','police_referral','other')),
  action_notes          TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── noise_notices ─────────────────────────────────────────────
-- Formal notices issued under NZ RMA / Local Government Act:
--   AN  = Abatement Notice (RMA s.322) — requires noise to stop/reduce
--   DN  = Direction Notice — immediate direction to stop noise now
--   END = Enforcement Notice (RMA s.319) — formal breach, financial penalty,
--         may result in equipment seizure
-- Each notice links to the assessment that triggered it.
CREATE TABLE IF NOT EXISTS noise_notices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  notice_number         TEXT NOT NULL,              -- e.g. "NCN-2026-000003"
  noise_assessment_id   UUID REFERENCES noise_assessments(id) ON DELETE SET NULL,
  noise_job_id          UUID REFERENCES noise_jobs(id) ON DELETE SET NULL,
  notice_type           TEXT NOT NULL
                          CHECK (notice_type IN ('abatement_notice','direction_notice','enforcement_notice')),
  -- Recipient
  recipient_name        TEXT NOT NULL,
  recipient_address     TEXT NOT NULL,
  recipient_dob         DATE,
  recipient_phone       TEXT,
  recipient_email       TEXT,
  -- Notice details
  offence_description   TEXT NOT NULL,
  rma_section           TEXT,                       -- e.g. "RMA s.326(1)(a)"
  issued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  comply_by             TIMESTAMPTZ,                -- deadline for compliance (AN/END)
  -- Financial penalty (END only)
  penalty_amount_nzd    NUMERIC(10,2),
  daily_penalty_nzd     NUMERIC(10,2),              -- ongoing daily fine for END
  -- Status tracking
  status                TEXT NOT NULL DEFAULT 'issued'
                          CHECK (status IN ('issued','complied','breached','escalated','withdrawn','court_referred','paid')),
  complied_at           TIMESTAMPTZ,
  escalated_to          TEXT,                       -- e.g. "court_referral","police"
  escalation_notes      TEXT,
  -- Officer / authority
  issuing_officer_id    UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  issuing_officer_name  TEXT,
  authority             TEXT,                       -- e.g. "Auckland Council"
  -- Evidence
  evidence_photos       TEXT[],
  pdf_url               TEXT,
  -- Flags (copied from job context, immutable at time of issue)
  is_permanent_end      BOOLEAN NOT NULL DEFAULT false,
  previous_notice_count INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, notice_number)
);

-- ── noise_notice_counters ────────────────────────────────────
CREATE TABLE IF NOT EXISTS noise_notice_counters (
  organization_id       UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  last_number           INTEGER NOT NULL DEFAULT 0
);

-- ── noise_seizures ───────────────────────────────────────────
-- Equipment seizure records — triggered by an END breach or
-- repeat AN non-compliance (RMA s.328 empowers authorised
-- officers to seize noise-causing equipment).
CREATE TABLE IF NOT EXISTS noise_seizures (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  seizure_number        TEXT NOT NULL,              -- e.g. "NCS-2026-000001"
  noise_notice_id       UUID REFERENCES noise_notices(id) ON DELETE SET NULL,
  noise_job_id          UUID REFERENCES noise_jobs(id) ON DELETE SET NULL,
  seized_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  address               TEXT NOT NULL,
  gps_lat               DOUBLE PRECISION,
  gps_lng               DOUBLE PRECISION,
  -- Equipment details
  equipment_description TEXT NOT NULL,              -- e.g. "Pioneer DJ turntable + 2x speaker stacks"
  equipment_count       INTEGER NOT NULL DEFAULT 1,
  estimated_value_nzd   NUMERIC(10,2),
  equipment_condition   TEXT,                       -- "good","damaged","poor"
  serial_numbers        TEXT[],
  -- Storage
  storage_location      TEXT,                       -- where equipment is held
  storage_reference     TEXT,                       -- storage docket number
  -- Return / disposal
  status                TEXT NOT NULL DEFAULT 'held'
                          CHECK (status IN ('held','returned','disposed','sold_at_auction','court_ordered')),
  return_date           DATE,
  returned_to           TEXT,
  return_conditions     TEXT,
  disposal_method       TEXT,
  -- Photos
  photos                TEXT[],                     -- required: photos of all seized items
  -- Officer
  seizing_officer_id    UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  seizing_officer_name  TEXT,
  witness_name          TEXT,
  -- Legal
  rma_authority         TEXT DEFAULT 'RMA s.328',
  court_order_ref       TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, seizure_number)
);

-- ── noise_seizure_counters ────────────────────────────────────
CREATE TABLE IF NOT EXISTS noise_seizure_counters (
  organization_id       UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  last_number           INTEGER NOT NULL DEFAULT 0
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_noise_jobs_org          ON noise_jobs(organization_id);
CREATE INDEX IF NOT EXISTS idx_noise_jobs_status       ON noise_jobs(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_noise_jobs_assigned     ON noise_jobs(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_noise_jobs_address      ON noise_jobs USING gin(to_tsvector('english', address));
CREATE INDEX IF NOT EXISTS idx_noise_assessments_org   ON noise_assessments(organization_id);
CREATE INDEX IF NOT EXISTS idx_noise_assessments_job   ON noise_assessments(noise_job_id);
CREATE INDEX IF NOT EXISTS idx_noise_notices_org       ON noise_notices(organization_id);
CREATE INDEX IF NOT EXISTS idx_noise_notices_status    ON noise_notices(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_noise_notices_type      ON noise_notices(organization_id, notice_type);
CREATE INDEX IF NOT EXISTS idx_noise_notices_end       ON noise_notices(organization_id) WHERE notice_type = 'enforcement_notice';
CREATE INDEX IF NOT EXISTS idx_noise_seizures_org      ON noise_seizures(organization_id);

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE noise_jobs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE noise_job_counters      ENABLE ROW LEVEL SECURITY;
ALTER TABLE noise_assessments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE noise_notices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE noise_notice_counters   ENABLE ROW LEVEL SECURITY;
ALTER TABLE noise_seizures          ENABLE ROW LEVEL SECURITY;
ALTER TABLE noise_seizure_counters  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "noise_jobs_org_rw"             ON noise_jobs
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "noise_job_counters_org_rw"     ON noise_job_counters
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "noise_assessments_org_rw"      ON noise_assessments
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "noise_notices_org_rw"          ON noise_notices
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "noise_notice_counters_org_rw"  ON noise_notice_counters
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "noise_seizures_org_rw"         ON noise_seizures
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "noise_seizure_counters_org_rw" ON noise_seizure_counters
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- grand_master cross-org read
CREATE POLICY "noise_jobs_gm_read"         ON noise_jobs        FOR SELECT
  USING ((SELECT role FROM user_profiles WHERE id = auth.uid()) = 'grand_master');
CREATE POLICY "noise_notices_gm_read"      ON noise_notices     FOR SELECT
  USING ((SELECT role FROM user_profiles WHERE id = auth.uid()) = 'grand_master');
CREATE POLICY "noise_assessments_gm_read"  ON noise_assessments FOR SELECT
  USING ((SELECT role FROM user_profiles WHERE id = auth.uid()) = 'grand_master');
CREATE POLICY "noise_seizures_gm_read"     ON noise_seizures    FOR SELECT
  USING ((SELECT role FROM user_profiles WHERE id = auth.uid()) = 'grand_master');

-- ── Sequential number functions ───────────────────────────────
CREATE OR REPLACE FUNCTION next_noise_job_number(p_org_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_next INTEGER; v_year TEXT := to_char(NOW() AT TIME ZONE 'Pacific/Auckland', 'YYYY');
BEGIN
  INSERT INTO noise_job_counters (organization_id, last_number) VALUES (p_org_id, 1)
  ON CONFLICT (organization_id) DO UPDATE
    SET last_number = noise_job_counters.last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'NCJ-' || v_year || '-' || lpad(v_next::TEXT, 6, '0');
END; $$;

CREATE OR REPLACE FUNCTION next_noise_notice_number(p_org_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_next INTEGER; v_year TEXT := to_char(NOW() AT TIME ZONE 'Pacific/Auckland', 'YYYY');
BEGIN
  INSERT INTO noise_notice_counters (organization_id, last_number) VALUES (p_org_id, 1)
  ON CONFLICT (organization_id) DO UPDATE
    SET last_number = noise_notice_counters.last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'NCN-' || v_year || '-' || lpad(v_next::TEXT, 6, '0');
END; $$;

CREATE OR REPLACE FUNCTION next_noise_seizure_number(p_org_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_next INTEGER; v_year TEXT := to_char(NOW() AT TIME ZONE 'Pacific/Auckland', 'YYYY');
BEGIN
  INSERT INTO noise_seizure_counters (organization_id, last_number) VALUES (p_org_id, 1)
  ON CONFLICT (organization_id) DO UPDATE
    SET last_number = noise_seizure_counters.last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'NCS-' || v_year || '-' || lpad(v_next::TEXT, 6, '0');
END; $$;

-- ── updated_at triggers ───────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_noise_jobs_updated_at') THEN
    CREATE TRIGGER trg_noise_jobs_updated_at
      BEFORE UPDATE ON noise_jobs FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_noise_notices_updated_at') THEN
    CREATE TRIGGER trg_noise_notices_updated_at
      BEFORE UPDATE ON noise_notices FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_noise_seizures_updated_at') THEN
    CREATE TRIGGER trg_noise_seizures_updated_at
      BEFORE UPDATE ON noise_seizures FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END;
$$;
