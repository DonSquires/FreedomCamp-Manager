-- ============================================================================
-- Contractor Profiles & Documents
-- Date: 2026-04-28
--
-- Allows First Security to track:
--   • Contact person(s) for each contractor company
--   • Rate card (guard, travel, standby, short-notice, long-term rates)
--   • Compliance documents (service agreement, insurance, H&S policy, etc.)
--
-- The contractor's own admin users can upload/replace their own insurance,
-- H&S policy and compliance certificates without requiring First Security staff.
-- ============================================================================

-- ── 1. contractor_profiles ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contractor_profiles (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID        NOT NULL UNIQUE
                                            REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Primary contact
  contact_name                TEXT,
  contact_role                TEXT,        -- e.g. 'Operations Manager'
  contact_phone               TEXT,
  contact_email               TEXT,

  -- Accounts / invoicing contact (may differ)
  accounts_name               TEXT,
  accounts_email              TEXT,
  accounts_phone              TEXT,

  -- ── Rate card (NZD, exclusive of GST) ─────────────────────────────────────
  -- All rates are per-hour unless otherwise noted.
  guard_rate_per_hour         NUMERIC(10,2),   -- standard guard / patrol officer rate
  travel_rate_per_km          NUMERIC(10,4),   -- vehicle travel reimbursement per km
  standby_rate_per_hour       NUMERIC(10,2),   -- on-call / standby rate
  short_notice_rate_per_hour  NUMERIC(10,2),   -- premium rate for <24 h notice callouts
  long_term_rate_per_hour     NUMERIC(10,2),   -- discounted rate for long deployments
  long_term_definition        TEXT,            -- e.g. 'Minimum 2-week continuous deployment'
  long_term_min_days          INTEGER,         -- numeric minimum (e.g. 14 for 2 weeks)

  -- ── Compliance status summary ──────────────────────────────────────────────
  -- Boolean flags updated when documents are verified by First Security staff.
  service_agreement_signed    BOOLEAN     NOT NULL DEFAULT false,
  service_agreement_expiry    DATE,

  insurance_verified          BOOLEAN     NOT NULL DEFAULT false,
  insurance_expiry            DATE,

  hs_policy_verified          BOOLEAN     NOT NULL DEFAULT false,
  hs_policy_expiry            DATE,

  notes                       TEXT,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contractor_profiles_org
  ON public.contractor_profiles(organization_id);

CREATE OR REPLACE FUNCTION public.update_contractor_profiles_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_contractor_profiles_updated_at
  BEFORE UPDATE ON public.contractor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_contractor_profiles_updated_at();

-- ── 2. contractor_documents ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contractor_documents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  document_type   TEXT        NOT NULL
                    CHECK (document_type IN (
                      'service_agreement',
                      'insurance',
                      'hs_policy',
                      'compliance',
                      'other'
                    )),
  document_name   TEXT        NOT NULL,          -- friendly label, e.g. 'Public Liability 2026'
  document_url    TEXT        NOT NULL,          -- Supabase Storage URL
  file_size_bytes BIGINT,
  mime_type       TEXT,
  expiry_date     DATE,
  is_current      BOOLEAN     NOT NULL DEFAULT true,  -- false = superseded / archived
  notes           TEXT,

  uploaded_by     UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contractor_documents_org
  ON public.contractor_documents(organization_id, document_type, is_current);

-- ── 3. Storage bucket: contractor-docs ────────────────────────────────────────
-- Private bucket. Files stored as {org_id}/{document_type}/{filename}

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contractor-docs',
  'contractor-docs',
  false,                         -- private: requires auth
  20971520,                      -- 20 MB limit
  ARRAY[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ── 4. RLS: contractor_profiles ──────────────────────────────────────────────

ALTER TABLE public.contractor_profiles ENABLE ROW LEVEL SECURITY;

-- Service provider admins / master / grand_master: full access
DROP POLICY IF EXISTS "service_provider_manage_contractor_profiles" ON public.contractor_profiles;
CREATE POLICY "service_provider_manage_contractor_profiles"
  ON public.contractor_profiles
  FOR ALL
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

-- Contractor org users: can read + update their own profile
DROP POLICY IF EXISTS "contractor_read_own_profile" ON public.contractor_profiles;
CREATE POLICY "contractor_read_own_profile"
  ON public.contractor_profiles
  FOR SELECT
  TO authenticated
  USING (
    organization_id = (
      SELECT COALESCE(employer_organization_id, organization_id)
      FROM   public.user_profiles
      WHERE  id = auth.uid()
      LIMIT  1
    )
  );

DROP POLICY IF EXISTS "contractor_update_own_profile" ON public.contractor_profiles;
CREATE POLICY "contractor_update_own_profile"
  ON public.contractor_profiles
  FOR UPDATE
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('admin', 'admin_officer')
    AND organization_id = (
      SELECT COALESCE(employer_organization_id, organization_id)
      FROM   public.user_profiles
      WHERE  id = auth.uid()
      LIMIT  1
    )
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('admin', 'admin_officer')
    AND organization_id = (
      SELECT COALESCE(employer_organization_id, organization_id)
      FROM   public.user_profiles
      WHERE  id = auth.uid()
      LIMIT  1
    )
  );

-- ── 5. RLS: contractor_documents ─────────────────────────────────────────────

ALTER TABLE public.contractor_documents ENABLE ROW LEVEL SECURITY;

-- Service provider admins / master / grand_master: full access
DROP POLICY IF EXISTS "service_provider_manage_contractor_documents" ON public.contractor_documents;
CREATE POLICY "service_provider_manage_contractor_documents"
  ON public.contractor_documents
  FOR ALL
  TO authenticated
  USING (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

-- Contractor org admins: read all their own docs, insert new docs (self-service upload)
DROP POLICY IF EXISTS "contractor_read_own_documents" ON public.contractor_documents;
CREATE POLICY "contractor_read_own_documents"
  ON public.contractor_documents
  FOR SELECT
  TO authenticated
  USING (
    organization_id = (
      SELECT COALESCE(employer_organization_id, organization_id)
      FROM   public.user_profiles
      WHERE  id = auth.uid()
      LIMIT  1
    )
  );

DROP POLICY IF EXISTS "contractor_insert_own_documents" ON public.contractor_documents;
CREATE POLICY "contractor_insert_own_documents"
  ON public.contractor_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    get_user_role(auth.uid()) IN ('admin', 'admin_officer')
    AND organization_id = (
      SELECT COALESCE(employer_organization_id, organization_id)
      FROM   public.user_profiles
      WHERE  id = auth.uid()
      LIMIT  1
    )
  );

-- ── 6. Storage RLS: contractor-docs bucket ───────────────────────────────────

DO $$
BEGIN
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

  -- SELECT: service provider staff OR contractor's own users
  DROP POLICY IF EXISTS "contractor_docs_select" ON storage.objects;
  CREATE POLICY "contractor_docs_select"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'contractor-docs'
      AND (
        -- Service provider / management access
        get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
        -- Contractor's own users: first path segment must equal their employer org id
        OR (split_part(name, '/', 1) = (
              SELECT COALESCE(employer_organization_id, organization_id)::text
              FROM   public.user_profiles
              WHERE  id = auth.uid()
              LIMIT  1
            ))
      )
    );

  -- INSERT: service provider admins OR contractor admins uploading for their own org
  DROP POLICY IF EXISTS "contractor_docs_insert" ON storage.objects;
  CREATE POLICY "contractor_docs_insert"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'contractor-docs'
      AND get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
      AND (
        -- Service provider roles can upload for any contractor
        get_user_role(auth.uid()) IN ('grand_master', 'master')
        -- Admin/admin_officer: can only upload into their own org's folder
        OR split_part(name, '/', 1) = (
             SELECT COALESCE(employer_organization_id, organization_id)::text
             FROM   public.user_profiles
             WHERE  id = auth.uid()
             LIMIT  1
           )
      )
    );

  -- DELETE: service provider managers / grand_master only
  DROP POLICY IF EXISTS "contractor_docs_delete" ON storage.objects;
  CREATE POLICY "contractor_docs_delete"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'contractor-docs'
      AND get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin')
    );
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING 'Skipping storage.objects policy updates for contractor-docs bucket: insufficient privileges for current role.';
END
$$;

-- ── 7. Seed empty profiles for existing contractor organisations ──────────────

INSERT INTO public.contractor_profiles (organization_id)
SELECT o.id
FROM   public.organizations o
WHERE  o.organization_type = 'contractor'
  AND  NOT EXISTS (
    SELECT 1 FROM public.contractor_profiles cp WHERE cp.organization_id = o.id
  );

DO $$
DECLARE v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM public.contractor_profiles;
  RAISE NOTICE '✅ contractor_profiles seeded: % rows', v_count;
END $$;
