-- Migration: Officer Skills & Qualifications
-- Tracks certifications, licences, and skills held by each officer.
-- InTime-style: skill requirements can be matched to shift/site requirements.
-- Existing user_profiles.coa_number/warrant_number captures NZ-specific certs;
-- this table is the general skill catalogue that can grow with the business.

CREATE TABLE IF NOT EXISTS public.officer_skills (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id          UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Skill / certification identity
  skill_name          TEXT        NOT NULL,   -- e.g. "First Aid Level 2", "Dog Handler", "CCTV"
  skill_category      TEXT        NOT NULL DEFAULT 'general'
                        CHECK (skill_category IN (
                          'licence',        -- NZ CoA, Warrant, driver licence
                          'certification',  -- First aid, fire warden, etc.
                          'training',       -- Internal training courses
                          'equipment',      -- Dog handler, CCTV, ALPR, etc.
                          'language',       -- Bilingual officers
                          'general'
                        )),

  -- Evidence / expiry
  certification_number TEXT,
  issued_at           DATE,
  expires_at          DATE,
  document_url        TEXT,

  -- Verification
  is_verified         BOOLEAN     NOT NULL DEFAULT false,
  verified_by         UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  verified_at         TIMESTAMPTZ,

  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (officer_id, skill_name)
);

CREATE INDEX IF NOT EXISTS idx_officer_skills_officer  ON public.officer_skills(officer_id);
CREATE INDEX IF NOT EXISTS idx_officer_skills_org      ON public.officer_skills(organization_id);
CREATE INDEX IF NOT EXISTS idx_officer_skills_expiry   ON public.officer_skills(expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE public.officer_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage officer_skills"
  ON public.officer_skills FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.organization_id = officer_skills.organization_id
    )
  );
