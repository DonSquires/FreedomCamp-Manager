-- =============================================================================
-- POI / VOI / Trespass Notices / Site Risk Assessments
-- =============================================================================
-- Adds four tables:
--   1. persons_of_interest   – persons flagged by an organisation (POI / banned / trespassed)
--   2. vehicles_of_interest  – vehicles flagged by an organisation
--   3. trespass_notices       – official trespass notice records (NZ Trespass Act 1980)
--   4. site_risk_assessments  – NZ WorkSafe-guided site risk evaluations
--
-- Privacy:  Data is org-scoped.  RLS restricts SELECT to members of the owning
--           organisation OR authorised service-provider officers who are
--           currently inside the organisation's geo-fence.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. persons_of_interest
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.persons_of_interest (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by        UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  full_name         TEXT        NOT NULL,
  date_of_birth     DATE,
  description       TEXT,
  gender            TEXT,
  ethnicity         TEXT,
  height_cm         INTEGER,
  weight_kg         INTEGER,
  distinguishing_features TEXT,
  contact_phone     TEXT,
  contact_email     TEXT,
  address           TEXT,
  status            TEXT        NOT NULL DEFAULT 'poi'
                      CHECK (status IN ('poi','banned','trespassed')),
  reason            TEXT,
  photos            TEXT[]      DEFAULT '{}',
  notes             TEXT,
  privacy_notice_given  BOOLEAN DEFAULT false,
  privacy_lawful_purpose TEXT  DEFAULT 'NZ Trespass Act 1980 / Freedom Camping Act 2011 enforcement',
  active            BOOLEAN     DEFAULT true,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_poi_org       ON persons_of_interest(organization_id);
CREATE INDEX IF NOT EXISTS idx_poi_status    ON persons_of_interest(status);
CREATE INDEX IF NOT EXISTS idx_poi_active    ON persons_of_interest(active);
CREATE INDEX IF NOT EXISTS idx_poi_name      ON persons_of_interest(full_name);

COMMENT ON TABLE  persons_of_interest IS
  'Persons flagged as of-interest, banned, or trespassed by an organisation. '
  'Data handling must comply with NZ Privacy Act 2020 – Principles 1-6 & 11.';
COMMENT ON COLUMN persons_of_interest.privacy_notice_given IS
  'IPP 3 – whether the individual was informed of the collection and its purpose.';
COMMENT ON COLUMN persons_of_interest.privacy_lawful_purpose IS
  'IPP 1 – the lawful purpose for which personal information is collected.';

ALTER TABLE persons_of_interest ENABLE ROW LEVEL SECURITY;

-- Members of the owning organisation may SELECT
DO $$ BEGIN
  DROP POLICY IF EXISTS "poi_org_read" ON public.persons_of_interest;
  CREATE POLICY "poi_org_read"
    ON public.persons_of_interest FOR SELECT
    TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM user_profiles WHERE id = auth.uid()
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Admin / master may INSERT / UPDATE / DELETE within their org
DO $$ BEGIN
  DROP POLICY IF EXISTS "poi_org_write" ON public.persons_of_interest;
  CREATE POLICY "poi_org_write"
    ON public.persons_of_interest FOR ALL
    TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin','admin_officer','master','officer')
      )
    )
    WITH CHECK (
      organization_id IN (
        SELECT organization_id FROM user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin','admin_officer','master','officer')
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- service_role bypass
DO $$ BEGIN
  DROP POLICY IF EXISTS "service_role_all_poi" ON public.persons_of_interest;
  CREATE POLICY "service_role_all_poi"
    ON public.persons_of_interest FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.trg_poi_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS set_poi_updated_at ON public.persons_of_interest;
CREATE TRIGGER set_poi_updated_at
  BEFORE UPDATE ON public.persons_of_interest
  FOR EACH ROW EXECUTE FUNCTION public.trg_poi_updated_at();

-- ---------------------------------------------------------------------------
-- 2. vehicles_of_interest
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicles_of_interest (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by        UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  plate_number      TEXT        NOT NULL,
  vehicle_make      TEXT,
  vehicle_model     TEXT,
  vehicle_color     TEXT,
  vehicle_year      INTEGER,
  description       TEXT,
  status            TEXT        NOT NULL DEFAULT 'voi'
                      CHECK (status IN ('voi','banned','trespassed')),
  reason            TEXT,
  photos            TEXT[]      DEFAULT '{}',
  notes             TEXT,
  linked_person_id  UUID        REFERENCES persons_of_interest(id) ON DELETE SET NULL,
  active            BOOLEAN     DEFAULT true,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voi_org       ON vehicles_of_interest(organization_id);
CREATE INDEX IF NOT EXISTS idx_voi_plate     ON vehicles_of_interest(plate_number);
CREATE INDEX IF NOT EXISTS idx_voi_status    ON vehicles_of_interest(status);
CREATE INDEX IF NOT EXISTS idx_voi_active    ON vehicles_of_interest(active);

COMMENT ON TABLE vehicles_of_interest IS
  'Vehicles flagged as of-interest, banned, or trespassed by an organisation.';

ALTER TABLE vehicles_of_interest ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "voi_org_read" ON public.vehicles_of_interest;
  CREATE POLICY "voi_org_read"
    ON public.vehicles_of_interest FOR SELECT
    TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM user_profiles WHERE id = auth.uid()
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "voi_org_write" ON public.vehicles_of_interest;
  CREATE POLICY "voi_org_write"
    ON public.vehicles_of_interest FOR ALL
    TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin','admin_officer','master','officer')
      )
    )
    WITH CHECK (
      organization_id IN (
        SELECT organization_id FROM user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin','admin_officer','master','officer')
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "service_role_all_voi" ON public.vehicles_of_interest;
  CREATE POLICY "service_role_all_voi"
    ON public.vehicles_of_interest FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.trg_voi_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS set_voi_updated_at ON public.vehicles_of_interest;
CREATE TRIGGER set_voi_updated_at
  BEFORE UPDATE ON public.vehicles_of_interest
  FOR EACH ROW EXECUTE FUNCTION public.trg_voi_updated_at();

-- ---------------------------------------------------------------------------
-- 3. trespass_notices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trespass_notices (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id         UUID        REFERENCES persons_of_interest(id) ON DELETE SET NULL,
  vehicle_id        UUID        REFERENCES vehicles_of_interest(id) ON DELETE SET NULL,
  issued_by         UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  zone_id           UUID        REFERENCES zones(id) ON DELETE SET NULL,
  reference_number  TEXT,
  notice_type       TEXT        NOT NULL DEFAULT 'verbal'
                      CHECK (notice_type IN ('verbal','written','permanent')),
  status            TEXT        NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','expired','withdrawn','appealed')),
  trespass_from     TEXT,
  trespass_reason   TEXT        NOT NULL,
  legal_basis       TEXT        DEFAULT 'Trespass Act 1980, Section 3 & 4',
  duration_days     INTEGER     DEFAULT 730,
  issued_at         TIMESTAMPTZ DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  served_method     TEXT        CHECK (served_method IN ('in_person','posted','email','left_on_vehicle')),
  witness_name      TEXT,
  witness_present   BOOLEAN     DEFAULT false,
  photos            TEXT[]      DEFAULT '{}',
  notice_html       TEXT,
  notes             TEXT,
  privacy_notice_given  BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tn_org        ON trespass_notices(organization_id);
CREATE INDEX IF NOT EXISTS idx_tn_person     ON trespass_notices(person_id);
CREATE INDEX IF NOT EXISTS idx_tn_vehicle    ON trespass_notices(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_tn_status     ON trespass_notices(status);

COMMENT ON TABLE trespass_notices IS
  'Official trespass notices issued under the NZ Trespass Act 1980. '
  'Written notices must identify the land, the person, and the duration (max 2 years). '
  'Verbal warnings last until revoked.';

ALTER TABLE trespass_notices ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "tn_org_read" ON public.trespass_notices;
  CREATE POLICY "tn_org_read"
    ON public.trespass_notices FOR SELECT
    TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM user_profiles WHERE id = auth.uid()
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "tn_org_write" ON public.trespass_notices;
  CREATE POLICY "tn_org_write"
    ON public.trespass_notices FOR ALL
    TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin','admin_officer','master','officer')
      )
    )
    WITH CHECK (
      organization_id IN (
        SELECT organization_id FROM user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin','admin_officer','master','officer')
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "service_role_all_tn" ON public.trespass_notices;
  CREATE POLICY "service_role_all_tn"
    ON public.trespass_notices FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.trg_tn_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS set_tn_updated_at ON public.trespass_notices;
CREATE TRIGGER set_tn_updated_at
  BEFORE UPDATE ON public.trespass_notices
  FOR EACH ROW EXECUTE FUNCTION public.trg_tn_updated_at();

-- ---------------------------------------------------------------------------
-- 4. site_risk_assessments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_risk_assessments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zone_id           UUID        REFERENCES zones(id) ON DELETE SET NULL,
  assessed_by       UUID        REFERENCES user_profiles(id) ON DELETE SET NULL,
  job_reference     TEXT,
  request_type      TEXT        NOT NULL DEFAULT 'adhoc'
                      CHECK (request_type IN ('adhoc','organisation_request','service_provider_request')),
  site_name         TEXT        NOT NULL,
  site_address      TEXT,
  gps_latitude      DOUBLE PRECISION,
  gps_longitude     DOUBLE PRECISION,
  assessment_date   TIMESTAMPTZ DEFAULT now(),
  overall_risk_level TEXT       NOT NULL DEFAULT 'low'
                      CHECK (overall_risk_level IN ('low','medium','high','critical')),

  -- NZ WorkSafe hazard categories (checkbox-driven)
  hazard_slips_trips_falls        BOOLEAN DEFAULT false,
  hazard_working_at_height        BOOLEAN DEFAULT false,
  hazard_manual_handling           BOOLEAN DEFAULT false,
  hazard_vehicles_traffic          BOOLEAN DEFAULT false,
  hazard_electrical                BOOLEAN DEFAULT false,
  hazard_fire                      BOOLEAN DEFAULT false,
  hazard_hazardous_substances      BOOLEAN DEFAULT false,
  hazard_confined_spaces           BOOLEAN DEFAULT false,
  hazard_noise                     BOOLEAN DEFAULT false,
  hazard_weather_exposure          BOOLEAN DEFAULT false,
  hazard_biological                BOOLEAN DEFAULT false,
  hazard_lone_working              BOOLEAN DEFAULT false,
  hazard_aggressive_persons        BOOLEAN DEFAULT false,
  hazard_animals                   BOOLEAN DEFAULT false,
  hazard_water_drowning            BOOLEAN DEFAULT false,
  hazard_poor_lighting             BOOLEAN DEFAULT false,
  hazard_uneven_terrain            BOOLEAN DEFAULT false,
  hazard_other                     BOOLEAN DEFAULT false,
  hazard_other_description         TEXT,

  -- Controls & mitigations
  controls_in_place      TEXT,
  additional_controls    TEXT,
  ppe_required           TEXT[]    DEFAULT '{}',

  -- Checklist items
  emergency_plan_sighted   BOOLEAN DEFAULT false,
  first_aid_available      BOOLEAN DEFAULT false,
  communication_coverage   BOOLEAN DEFAULT false,
  safe_parking_available   BOOLEAN DEFAULT false,
  site_access_clear        BOOLEAN DEFAULT false,
  signage_adequate         BOOLEAN DEFAULT false,

  -- Evidence
  photos                 TEXT[]    DEFAULT '{}',
  assessor_signature     TEXT,
  notes                  TEXT,
  status                 TEXT      NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','submitted','reviewed','archived')),
  reviewed_by            UUID      REFERENCES user_profiles(id) ON DELETE SET NULL,
  reviewed_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sra_org       ON site_risk_assessments(organization_id);
CREATE INDEX IF NOT EXISTS idx_sra_zone      ON site_risk_assessments(zone_id);
CREATE INDEX IF NOT EXISTS idx_sra_assessor  ON site_risk_assessments(assessed_by);
CREATE INDEX IF NOT EXISTS idx_sra_risk      ON site_risk_assessments(overall_risk_level);
CREATE INDEX IF NOT EXISTS idx_sra_status    ON site_risk_assessments(status);

COMMENT ON TABLE site_risk_assessments IS
  'Site risk assessments per NZ WorkSafe HSWA 2015 guidelines. '
  'Officers may complete ad-hoc or on request from the organisation / service provider. '
  'Hazard checkboxes align with WorkSafe NZ hazard identification categories.';

ALTER TABLE site_risk_assessments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "sra_org_read" ON public.site_risk_assessments;
  CREATE POLICY "sra_org_read"
    ON public.site_risk_assessments FOR SELECT
    TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM user_profiles WHERE id = auth.uid()
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "sra_org_write" ON public.site_risk_assessments;
  CREATE POLICY "sra_org_write"
    ON public.site_risk_assessments FOR ALL
    TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin','admin_officer','master','officer')
      )
    )
    WITH CHECK (
      organization_id IN (
        SELECT organization_id FROM user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin','admin_officer','master','officer')
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "service_role_all_sra" ON public.site_risk_assessments;
  CREATE POLICY "service_role_all_sra"
    ON public.site_risk_assessments FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.trg_sra_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS set_sra_updated_at ON public.site_risk_assessments;
CREATE TRIGGER set_sra_updated_at
  BEFORE UPDATE ON public.site_risk_assessments
  FOR EACH ROW EXECUTE FUNCTION public.trg_sra_updated_at();

-- =============================================================================
-- End of migration
-- =============================================================================
