-- Tender Reference Materials — org-wide library for Bob context enrichment
-- Tables: tender_reference_materials, tender_reference_versions, tender_document_references
-- Also: alters tender_documents to add reference_context_snapshot, training_outcome_reason
--       and extends the status CHECK to include 'shortlisted'

-- =============================================================================
-- 1. tender_reference_materials
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tender_reference_materials (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owning organisation (org-wide scope — shared across all tenders)
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Display metadata
  title               TEXT        NOT NULL,
  description         TEXT,
  material_type       TEXT        NOT NULL DEFAULT 'other'
                        CHECK (material_type IN (
                          'policy',
                          'pricing',
                          'template',
                          'compliance',
                          'legal',
                          'past_tender',
                          'nz_reference',
                          'other'
                        )),

  -- Source file (mirrors tender_documents pattern)
  file_name           TEXT,
  file_path           TEXT,
  file_public_url     TEXT,
  file_kind           TEXT
                        CHECK (file_kind IN ('document','pdf','image','spreadsheet','text','unknown')),

  -- Extracted content (user-editable, stored in Postgres)
  extracted_text      TEXT,
  extraction_status   TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (extraction_status IN (
                          'pending',
                          'extracting',
                          'extracted',
                          'failed',
                          'needs_review'
                        )),
  extraction_notes    TEXT,

  -- Lifecycle
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  version             INTEGER     NOT NULL DEFAULT 1,
  previous_version_id UUID        REFERENCES public.tender_reference_materials(id) ON DELETE SET NULL,

  -- Ownership
  uploaded_by         UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  -- Audit
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trm_organization
  ON public.tender_reference_materials(organization_id);
CREATE INDEX IF NOT EXISTS idx_trm_type
  ON public.tender_reference_materials(material_type);
CREATE INDEX IF NOT EXISTS idx_trm_active
  ON public.tender_reference_materials(is_active);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.trg_trm_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_trm_updated_at ON public.tender_reference_materials;
CREATE TRIGGER set_trm_updated_at
  BEFORE UPDATE ON public.tender_reference_materials
  FOR EACH ROW EXECUTE FUNCTION public.trg_trm_updated_at();

-- =============================================================================
-- 2. tender_reference_versions (history when a file is replaced)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tender_reference_versions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_material_id   UUID        NOT NULL REFERENCES public.tender_reference_materials(id) ON DELETE CASCADE,
  version                 INTEGER     NOT NULL,
  file_name               TEXT,
  file_path               TEXT,
  file_kind               TEXT,
  extracted_text          TEXT,
  replaced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replaced_by             UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_trv_reference_material
  ON public.tender_reference_versions(reference_material_id);

-- =============================================================================
-- 3. tender_document_references (link table: tender ↔ active references)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tender_document_references (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id             UUID        NOT NULL REFERENCES public.tender_documents(id) ON DELETE CASCADE,
  reference_material_id   UUID        NOT NULL REFERENCES public.tender_reference_materials(id) ON DELETE CASCADE,

  -- User's per-tender inclusion checkbox (default: included)
  included                BOOLEAN     NOT NULL DEFAULT true,

  -- Audit flags set by edge functions after each run
  used_in_analysis        BOOLEAN     NOT NULL DEFAULT false,
  used_in_generation      BOOLEAN     NOT NULL DEFAULT false,
  analysis_run_at         TIMESTAMPTZ,
  generation_run_at       TIMESTAMPTZ,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (document_id, reference_material_id)
);

CREATE INDEX IF NOT EXISTS idx_tdr_document
  ON public.tender_document_references(document_id);
CREATE INDEX IF NOT EXISTS idx_tdr_reference
  ON public.tender_document_references(reference_material_id);

-- =============================================================================
-- 4. Extend tender_documents
-- =============================================================================

ALTER TABLE public.tender_documents
  ADD COLUMN IF NOT EXISTS reference_context_snapshot  JSONB,
  ADD COLUMN IF NOT EXISTS training_outcome_reason      TEXT,
  ADD COLUMN IF NOT EXISTS rejection_category           TEXT
    CHECK (rejection_category IN ('pricing','scope','qualifications','compliance','formatting','other'));

-- Extend status CHECK to include 'shortlisted'
-- (DROP and recreate with new value list)
ALTER TABLE public.tender_documents
  DROP CONSTRAINT IF EXISTS tender_documents_status_check;

ALTER TABLE public.tender_documents
  ADD CONSTRAINT tender_documents_status_check
    CHECK (status IN (
      'draft',
      'staged',
      'assessed',
      'drafting',
      'review_pending',
      'shortlisted',
      'approved',
      'submitted',
      'archived'
    ));

-- =============================================================================
-- 5. RLS — tender_reference_materials
-- =============================================================================

ALTER TABLE public.tender_reference_materials  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tender_reference_versions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tender_document_references  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN

  -- ── tender_reference_materials ──────────────────────────────────────────────
  DROP POLICY IF EXISTS "trm_select" ON public.tender_reference_materials;
  CREATE POLICY "trm_select"
    ON public.tender_reference_materials FOR SELECT TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
      )
    );

  DROP POLICY IF EXISTS "trm_insert" ON public.tender_reference_materials;
  CREATE POLICY "trm_insert"
    ON public.tender_reference_materials FOR INSERT TO authenticated
    WITH CHECK (
      organization_id IN (
        SELECT organization_id FROM public.user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'master', 'grand_master')
      )
    );

  DROP POLICY IF EXISTS "trm_update" ON public.tender_reference_materials;
  CREATE POLICY "trm_update"
    ON public.tender_reference_materials FOR UPDATE TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM public.user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'master', 'grand_master')
      )
    );

  DROP POLICY IF EXISTS "trm_service_role" ON public.tender_reference_materials;
  CREATE POLICY "trm_service_role"
    ON public.tender_reference_materials FOR ALL TO service_role
    USING (true) WITH CHECK (true);

  -- ── tender_reference_versions ───────────────────────────────────────────────
  DROP POLICY IF EXISTS "trv_select" ON public.tender_reference_versions;
  CREATE POLICY "trv_select"
    ON public.tender_reference_versions FOR SELECT TO authenticated
    USING (
      reference_material_id IN (
        SELECT id FROM public.tender_reference_materials
        WHERE organization_id IN (
          SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
        )
      )
    );

  DROP POLICY IF EXISTS "trv_insert" ON public.tender_reference_versions;
  CREATE POLICY "trv_insert"
    ON public.tender_reference_versions FOR INSERT TO authenticated
    WITH CHECK (
      reference_material_id IN (
        SELECT id FROM public.tender_reference_materials
        WHERE organization_id IN (
          SELECT organization_id FROM public.user_profiles
          WHERE id = auth.uid()
            AND role IN ('admin', 'master', 'grand_master')
        )
      )
    );

  DROP POLICY IF EXISTS "trv_service_role" ON public.tender_reference_versions;
  CREATE POLICY "trv_service_role"
    ON public.tender_reference_versions FOR ALL TO service_role
    USING (true) WITH CHECK (true);

  -- ── tender_document_references ──────────────────────────────────────────────
  DROP POLICY IF EXISTS "tdr_select" ON public.tender_document_references;
  CREATE POLICY "tdr_select"
    ON public.tender_document_references FOR SELECT TO authenticated
    USING (
      document_id IN (
        SELECT id FROM public.tender_documents
        WHERE owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.tender_collaborators tc
            WHERE tc.document_id = tender_documents.id AND tc.user_id = auth.uid()
          )
          OR organization_id IN (
            SELECT organization_id FROM public.user_profiles
            WHERE id = auth.uid()
              AND role IN ('admin', 'master', 'grand_master')
          )
      )
    );

  DROP POLICY IF EXISTS "tdr_insert" ON public.tender_document_references;
  CREATE POLICY "tdr_insert"
    ON public.tender_document_references FOR INSERT TO authenticated
    WITH CHECK (
      document_id IN (
        SELECT id FROM public.tender_documents
        WHERE owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.tender_collaborators tc
            WHERE tc.document_id = tender_documents.id
              AND tc.user_id = auth.uid()
              AND tc.role = 'editor'
          )
      )
    );

  DROP POLICY IF EXISTS "tdr_update" ON public.tender_document_references;
  CREATE POLICY "tdr_update"
    ON public.tender_document_references FOR UPDATE TO authenticated
    USING (
      document_id IN (
        SELECT id FROM public.tender_documents
        WHERE owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.tender_collaborators tc
            WHERE tc.document_id = tender_documents.id
              AND tc.user_id = auth.uid()
              AND tc.role = 'editor'
          )
      )
    );

  DROP POLICY IF EXISTS "tdr_service_role" ON public.tender_document_references;
  CREATE POLICY "tdr_service_role"
    ON public.tender_document_references FOR ALL TO service_role
    USING (true) WITH CHECK (true);

END $$;

-- =============================================================================
-- 6. Grants
-- =============================================================================

GRANT SELECT, INSERT, UPDATE ON public.tender_reference_materials  TO authenticated;
GRANT SELECT, INSERT         ON public.tender_reference_versions    TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tender_document_references   TO authenticated;

-- =============================================================================
-- 7. Storage RLS policy for tender-references/ prefix
-- =============================================================================

-- Allow authenticated org users to upload and read from tender-references/
-- (mirrors the evidence_tender_insert pattern from 20260417000010)
DO $$ BEGIN
  -- Upload policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'evidence_tender_ref_insert'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "evidence_tender_ref_insert"
        ON storage.objects FOR INSERT TO authenticated
        WITH CHECK (
          bucket_id = 'evidence'
          AND (storage.foldername(name))[1] = 'tender-references'
        )
    $pol$;
  END IF;

  -- Read policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'evidence_tender_ref_select'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "evidence_tender_ref_select"
        ON storage.objects FOR SELECT TO authenticated
        USING (
          bucket_id = 'evidence'
          AND (storage.foldername(name))[1] = 'tender-references'
        )
    $pol$;
  END IF;
END $$;

-- =============================================================================
-- 8. NZ Reference seed data (platform-level, no file required)
-- =============================================================================

-- Insert seeded NZ reference stubs for the platform (grand_master) org.
-- These use organization_id of the first grand_master user's org, so they
-- only exist if a grand_master org is present — safe to skip if not.
DO $$ BEGIN
  INSERT INTO public.tender_reference_materials
    (organization_id, title, description, material_type, extraction_status, extracted_text, is_active)
  SELECT
    up.organization_id,
    refs.title,
    refs.description,
    'nz_reference',
    'extracted',
    refs.extracted_text,
    true
  FROM (
    VALUES
      (
        'Freedom Camping Act 2011 — Key Enforcement Sections',
        'Summary of key enforcement powers under the Freedom Camping Act 2011 for security contractors and councils.',
        E'Freedom Camping Act 2011 — Key Enforcement Sections\n\n'
        'Section 18: Enforcement officers may issue infringement notices to freedom campers in breach of freedom camping controls.\n'
        'Section 19: Infringement offences — freedom camping in a prohibited area, or failing to comply with freedom camping conditions.\n'
        'Section 20: Enforcement officers may require a person to leave a freedom camping area if the officer believes on reasonable grounds that the person has committed a freedom camping offence.\n'
        'Section 21: Enforcement officers may seize and impound vehicles used in connection with a freedom camping offence.\n'
        'Section 22: Territorial authorities may appoint warranted enforcement officers. Private contractors may be appointed as enforcement officers by the territorial authority.\n'
        'Key obligations for contractors: Officers must carry and produce their warrant of authority on request. Officers may not use excessive force. All enforcement actions must be documented.'
      ),
      (
        'Private Security Personnel and Private Investigators Act 2010 — CoA Requirements',
        'Certificate of Approval (CoA) requirements checklist for security contractors under the PSP&PI Act 2010.',
        E'PSP&PI Act 2010 — Certificate of Approval (CoA) Requirements\n\n'
        'All security personnel performing security work must hold a current Certificate of Approval (CoA) issued by the Registrar.\n'
        'Categories relevant to freedom camping enforcement:\n'
        '  - Security officer (Class D): controlling or monitoring access to property\n'
        '  - Crowd controller (Class C): if managing situations involving potential disorder\n'
        'Application requirements:\n'
        '  1. Completed application form\n'
        '  2. Proof of identity (NZ citizen or permanent resident)\n'
        '  3. Criminal history check (no disqualifying convictions)\n'
        '  4. Medical certificate (fitness for duty)\n'
        '  5. Application fee\n'
        'CoA must be renewed every 3 years. Employer obligations: verify all personnel hold valid CoAs before deployment. '
        'Failure to comply: fine of up to $40,000 for the company. Personnel without CoA: up to $10,000 fine.\n'
        'Check status: https://www.justice.govt.nz/security-licensing/'
      ),
      (
        'Health and Safety at Work Act 2015 — PCBU Obligations for Security Contractors',
        'PCBU duties under HSWA 2015 relevant to security contractors in field operations.',
        E'Health and Safety at Work Act 2015 — PCBU Obligations\n\n'
        'As a PCBU (Person Conducting a Business or Undertaking), Iron Eagle Security must:\n'
        '1. Ensure, so far as is reasonably practicable, the health and safety of workers.\n'
        '2. Provide and maintain a work environment without risks to health and safety.\n'
        '3. Provide adequate facilities for the welfare of workers.\n'
        '4. Provide information, training, instruction, or supervision necessary to protect workers.\n'
        '5. Monitor workers'' health and the conditions at the workplace.\n\n'
        'Field-specific obligations:\n'
        '  - Solo patrol: welfare check frequency must be documented in the H&S plan.\n'
        '  - Lone worker monitoring: GPS tracking and regular check-ins are best practice.\n'
        '  - Incident reporting: notifiable events must be reported to WorkSafe NZ immediately.\n'
        '  - PPE: provide appropriate PPE (high-vis, personal alarm, communication device).\n\n'
        'Tender submissions must include a Site-Specific Safety Plan (SSSP) or equivalent H&S document. '
        'Demonstrate ISO 45001 or equivalent management system. Reference PCBU overlap with council (joint duty holder).'
      ),
      (
        'NZ Council Procurement Template — Structure & Evaluation Criteria',
        'Standard NZ council RFP/RFIP structure and typical evaluation criteria for security services.',
        E'NZ Council Procurement — Standard Structure\n\n'
        'Typical RFP/RFIP sections for NZ council security services:\n'
        '1. Cover letter and executive summary\n'
        '2. Organisational capability and experience\n'
        '   - Company history, size, NZ operations\n'
        '   - Relevant contract examples (past 5 years)\n'
        '   - Key personnel CVs and qualifications\n'
        '3. Service delivery methodology\n'
        '   - Patrol frequency, coverage plan\n'
        '   - Response times and escalation procedures\n'
        '   - Technology platform (GPS, reporting, evidence)\n'
        '4. Compliance and accreditations\n'
        '   - PSP&PI Act CoA for all personnel\n'
        '   - H&S management system\n'
        '   - Insurance (public liability min $5M, professional indemnity)\n'
        '5. Pricing schedule\n'
        '   - Unit rates per hour (day/night/weekend)\n'
        '   - Vehicle costs, disbursements\n'
        '   - Total contract value estimate\n'
        '6. References (3 minimum, NZ council or similar preferred)\n'
        '7. Declarations (collusion, conflict of interest, NZBN)\n\n'
        'Typical evaluation weighting:\n'
        '  - Methodology / capability: 40%\n'
        '  - Compliance / H&S: 25%\n'
        '  - Price: 25%\n'
        '  - References / experience: 10%'
      ),
      (
        'NZ Commerce Act 1986 — Collusion Declaration',
        'Standard collusion declaration text required for competitive tender submissions in NZ.',
        E'NZ Commerce Act 1986 — Collusion Declaration\n\n'
        'Required text for tender submissions:\n\n'
        '"We declare that this tender submission has been prepared independently, without collusion or '
        'communication with any other tenderer regarding the pricing, terms, or strategy of this submission. '
        'No arrangement, understanding, or agreement exists between this organisation and any other party '
        'that would restrict or limit competitive tendering for this contract, whether directly or indirectly. '
        'This declaration is made in compliance with the Commerce Act 1986 (New Zealand), specifically the '
        'provisions prohibiting price-fixing and anti-competitive conduct under Part 2."\n\n'
        'Signatory requirements:\n'
        '  - Authorised representative of the tendering organisation\n'
        '  - Name, title, date\n'
        '  - Company name and NZBN\n\n'
        'Note: Breach of Commerce Act cartel provisions can result in fines up to $10 million for a company '
        'or $500,000 for an individual. Always include this declaration in every tender response.'
      )
    ) AS refs(title, description, extracted_text)
    CROSS JOIN (
      SELECT DISTINCT organization_id
      FROM public.user_profiles
      WHERE role = 'grand_master'
      LIMIT 1
    ) up
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tender_reference_materials trm
    WHERE trm.organization_id = up.organization_id
      AND trm.title = refs.title
  );
END $$;

-- =============================================================================
-- 9. Comments
-- =============================================================================

COMMENT ON TABLE public.tender_reference_materials IS
  'Org-wide library of reference documents (policies, pricing guides, NZ legislation) that Bob uses as context when analysing and generating tender responses.';
COMMENT ON TABLE public.tender_reference_versions IS
  'Immutable version history of tender reference materials — created when a file is replaced.';
COMMENT ON TABLE public.tender_document_references IS
  'Per-tender link table recording which reference materials were included/used for each Bob analysis or generation run.';
