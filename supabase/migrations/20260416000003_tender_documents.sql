-- Tender Documents module
-- Tables: tender_documents, tender_collaborators, tender_comments
-- Supports: RFP/RFIP/tender-response lifecycle with ownership, collaboration, human approval

-- =============================================================================
-- 1. tender_documents
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tender_documents (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owning organisation (Iron Eagle Security / operator org)
  organization_id           UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- CRM link — issuing body organisation (auto-created if not found)
  crm_client_organization_id UUID       REFERENCES public.organizations(id) ON DELETE SET NULL,

  -- Document identity
  title                     TEXT        NOT NULL,
  description               TEXT,
  document_type             TEXT        NOT NULL DEFAULT 'rfp'
                              CHECK (document_type IN (
                                'rfp',               -- Request for Proposal
                                'rfi',               -- Request for Information
                                'rfq',               -- Request for Quote
                                'rfip',              -- Request for Information and Pricing
                                'tender_application',
                                'tender_response',
                                'proposal',
                                'other'
                              )),

  -- Issuing body metadata
  issuing_body              TEXT,        -- free-text (e.g. "Marlborough District Council")
  reference_number          TEXT,
  due_date                  DATE,

  -- Source file
  file_name                 TEXT,
  file_path                 TEXT,        -- Supabase Storage bucket path
  file_public_url           TEXT,
  file_kind                 TEXT
                              CHECK (file_kind IN ('document','pdf','image','spreadsheet','text','unknown')),

  -- Extracted content
  extracted_text            TEXT,

  -- Bob assessment (structured JSON from inference service)
  bob_assessment            JSONB,
  bob_assessment_summary    TEXT,
  key_services              JSONB,       -- array of service items found in document
  key_requirements          JSONB,       -- eligibility requirements
  key_dates                 JSONB,       -- timeline / deadlines
  enrichment_data           JSONB,       -- web-enrichment results Bob gathered
  enrichment_requested_at   TIMESTAMPTZ,

  -- Draft response content (editable sections JSON)
  response_sections         JSONB,       -- {"cover": "", "executive_summary": "", "services": {}, "pricing": [], ...}
  generated_html            TEXT,        -- latest generated HTML of the response

  -- Workflow status
  status                    TEXT        NOT NULL DEFAULT 'draft'
                              CHECK (status IN (
                                'draft',            -- just created
                                'staged',           -- file uploaded, pending extraction
                                'assessed',         -- Bob has analysed
                                'drafting',         -- user writing response
                                'review_pending',   -- awaiting approval
                                'approved',         -- approved for export/submit
                                'submitted',        -- sent to issuing body
                                'archived'
                              )),

  -- Ownership
  owner_id                  UUID        NOT NULL REFERENCES public.user_profiles(id),

  -- Approval
  approved_by               UUID        REFERENCES public.user_profiles(id),
  approved_at               TIMESTAMPTZ,
  approval_notes            TEXT,

  -- Audit
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tender_documents_org
  ON public.tender_documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_tender_documents_owner
  ON public.tender_documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_tender_documents_status
  ON public.tender_documents(status);
CREATE INDEX IF NOT EXISTS idx_tender_documents_crm_client
  ON public.tender_documents(crm_client_organization_id);

-- =============================================================================
-- 2. tender_collaborators
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tender_collaborators (
  id            UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID  NOT NULL REFERENCES public.tender_documents(id) ON DELETE CASCADE,
  user_id       UUID  NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  role          TEXT  NOT NULL DEFAULT 'editor'
                        CHECK (role IN ('editor', 'viewer', 'approver')),
  invited_by    UUID  REFERENCES public.user_profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tender_collaborators_doc
  ON public.tender_collaborators(document_id);
CREATE INDEX IF NOT EXISTS idx_tender_collaborators_user
  ON public.tender_collaborators(user_id);

-- =============================================================================
-- 3. tender_comments
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tender_comments (
  id                UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       UUID  NOT NULL REFERENCES public.tender_documents(id) ON DELETE CASCADE,
  user_id           UUID  NOT NULL REFERENCES public.user_profiles(id),
  content           TEXT  NOT NULL,
  is_approval_note  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tender_comments_doc
  ON public.tender_comments(document_id);

-- =============================================================================
-- 4. updated_at trigger for tender_documents
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trg_tender_documents_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_tender_documents_updated_at ON public.tender_documents;
CREATE TRIGGER set_tender_documents_updated_at
  BEFORE UPDATE ON public.tender_documents
  FOR EACH ROW EXECUTE FUNCTION public.trg_tender_documents_updated_at();

-- =============================================================================
-- 5. Row-Level Security
-- =============================================================================

ALTER TABLE public.tender_documents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tender_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tender_comments      ENABLE ROW LEVEL SECURITY;

-- ── tender_documents ──────────────────────────────────────────────────────────
DO $$ BEGIN
  DROP POLICY IF EXISTS "tender_docs_select" ON public.tender_documents;
  CREATE POLICY "tender_docs_select"
    ON public.tender_documents FOR SELECT TO authenticated
    USING (
      owner_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.tender_collaborators tc
        WHERE tc.document_id = id AND tc.user_id = auth.uid()
      )
      OR organization_id IN (
        SELECT organization_id FROM public.user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'master', 'grand_master')
      )
    );

  DROP POLICY IF EXISTS "tender_docs_insert" ON public.tender_documents;
  CREATE POLICY "tender_docs_insert"
    ON public.tender_documents FOR INSERT TO authenticated
    WITH CHECK (
      owner_id = auth.uid()
      AND organization_id IN (
        SELECT organization_id FROM public.user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'master', 'grand_master')
      )
    );

  DROP POLICY IF EXISTS "tender_docs_update" ON public.tender_documents;
  CREATE POLICY "tender_docs_update"
    ON public.tender_documents FOR UPDATE TO authenticated
    USING (
      owner_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.tender_collaborators tc
        WHERE tc.document_id = id AND tc.user_id = auth.uid() AND tc.role = 'editor'
      )
      OR EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid() AND up.role IN ('master', 'grand_master')
      )
    );

  DROP POLICY IF EXISTS "tender_docs_service_role" ON public.tender_documents;
  CREATE POLICY "tender_docs_service_role"
    ON public.tender_documents FOR ALL TO service_role
    USING (true) WITH CHECK (true);
END $$;

-- ── tender_collaborators ──────────────────────────────────────────────────────
DO $$ BEGIN
  -- NOTE: policies here must NOT query tender_documents to avoid infinite
  -- recursion (tender_documents SELECT policy queries tender_collaborators).
  DROP POLICY IF EXISTS "tender_collabs_select" ON public.tender_collaborators;
  CREATE POLICY "tender_collabs_select"
    ON public.tender_collaborators FOR SELECT TO authenticated
    USING (
      user_id = auth.uid()
      OR invited_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid() AND up.role IN ('admin', 'master', 'grand_master')
      )
    );

  DROP POLICY IF EXISTS "tender_collabs_insert" ON public.tender_collaborators;
  CREATE POLICY "tender_collabs_insert"
    ON public.tender_collaborators FOR INSERT TO authenticated
    WITH CHECK (
      invited_by = auth.uid()
    );

  DROP POLICY IF EXISTS "tender_collabs_update" ON public.tender_collaborators;
  CREATE POLICY "tender_collabs_update"
    ON public.tender_collaborators FOR UPDATE TO authenticated
    USING (
      invited_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid() AND up.role IN ('admin', 'master', 'grand_master')
      )
    );

  DROP POLICY IF EXISTS "tender_collabs_delete" ON public.tender_collaborators;
  CREATE POLICY "tender_collabs_delete"
    ON public.tender_collaborators FOR DELETE TO authenticated
    USING (
      user_id = auth.uid()
      OR invited_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid() AND up.role IN ('admin', 'master', 'grand_master')
      )
    );

  DROP POLICY IF EXISTS "tender_collabs_service_role" ON public.tender_collaborators;
  CREATE POLICY "tender_collabs_service_role"
    ON public.tender_collaborators FOR ALL TO service_role
    USING (true) WITH CHECK (true);
END $$;

-- ── tender_comments ────────────────────────────────────────────────────────────
DO $$ BEGIN
  DROP POLICY IF EXISTS "tender_comments_select" ON public.tender_comments;
  CREATE POLICY "tender_comments_select"
    ON public.tender_comments FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.tender_documents td
        WHERE td.id = document_id
          AND (
            td.owner_id = auth.uid()
            OR EXISTS (
              SELECT 1 FROM public.tender_collaborators tc
              WHERE tc.document_id = td.id AND tc.user_id = auth.uid()
            )
            OR EXISTS (
              SELECT 1 FROM public.user_profiles up
              WHERE up.id = auth.uid()
                AND up.role IN ('admin', 'master', 'grand_master')
            )
          )
      )
    );

  DROP POLICY IF EXISTS "tender_comments_insert" ON public.tender_comments;
  CREATE POLICY "tender_comments_insert"
    ON public.tender_comments FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

  DROP POLICY IF EXISTS "tender_comments_service_role" ON public.tender_comments;
  CREATE POLICY "tender_comments_service_role"
    ON public.tender_comments FOR ALL TO service_role
    USING (true) WITH CHECK (true);
END $$;

-- =============================================================================
-- 6. Grants
-- =============================================================================

GRANT SELECT, INSERT, UPDATE ON public.tender_documents     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tender_collaborators TO authenticated;
GRANT SELECT, INSERT              ON public.tender_comments  TO authenticated;

-- =============================================================================
-- 7. Comments
-- =============================================================================

COMMENT ON TABLE public.tender_documents IS
  'Tender/RFP/RFIP documents managed by Bob Document Workspace. Supports intake, AI assessment, collaborative drafting and approval workflow.';
COMMENT ON TABLE public.tender_collaborators IS
  'Invited collaborators on tender documents with role (editor | viewer | approver).';
COMMENT ON TABLE public.tender_comments IS
  'Threaded comments and approval notes on tender documents.';
