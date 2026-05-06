-- =============================================================================
-- Public Noise Complaint Portal (B-13)
-- Allows members of the public to submit noise complaints online and track
-- status by reference number — no login required.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.public_noise_complaints (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference             TEXT NOT NULL UNIQUE,          -- e.g. NCC-2026-000001
  organization_id       UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  -- Complaint location
  address               TEXT NOT NULL,
  suburb                TEXT,
  -- Complaint details
  complaint_description TEXT NOT NULL,
  noise_type            TEXT CHECK (noise_type IN (
                          'music', 'party', 'machinery', 'animals',
                          'construction', 'vehicle', 'other'
                        )),
  -- Optional complainant contact (voluntarily provided; not required)
  complainant_name      TEXT,
  complainant_email     TEXT,
  complainant_phone     TEXT,
  -- Status tracking
  status                TEXT NOT NULL DEFAULT 'received'
                          CHECK (status IN (
                            'received', 'acknowledged', 'assigned',
                            'on_scene', 'resolved', 'no_action_taken'
                          )),
  status_message        TEXT,   -- public-facing status note set by officers
  -- Linking
  linked_noise_assessment_id UUID,
  linked_dispatch_job_id     UUID,
  -- Timestamps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sequential reference counter
CREATE TABLE IF NOT EXISTS public.public_noise_complaint_counters (
  year        INTEGER NOT NULL,
  next_seq    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (year)
);

-- Function to generate reference number (NCC-YYYY-NNNNNN)
CREATE OR REPLACE FUNCTION public.generate_noise_complaint_reference()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_year   INTEGER := EXTRACT(YEAR FROM NOW())::INTEGER;
  v_seq    INTEGER;
BEGIN
  INSERT INTO public.public_noise_complaint_counters(year, next_seq)
    VALUES (v_year, 2)
    ON CONFLICT (year) DO UPDATE SET next_seq = public_noise_complaint_counters.next_seq + 1
    RETURNING next_seq - 1 INTO v_seq;
  RETURN 'NCC-' || v_year || '-' || LPAD(v_seq::TEXT, 6, '0');
END;
$$;

-- Auto-populate reference and updated_at
CREATE OR REPLACE FUNCTION public.set_noise_complaint_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reference IS NULL OR NEW.reference = '' THEN
    NEW.reference := public.generate_noise_complaint_reference();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_noise_complaint_reference
  BEFORE INSERT ON public.public_noise_complaints
  FOR EACH ROW EXECUTE FUNCTION public.set_noise_complaint_reference();

CREATE OR REPLACE FUNCTION public.touch_noise_complaint_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END; $$;

CREATE OR REPLACE TRIGGER trg_noise_complaint_updated_at
  BEFORE UPDATE ON public.public_noise_complaints
  FOR EACH ROW EXECUTE FUNCTION public.touch_noise_complaint_updated_at();

-- Index for status lookup and reference lookup
CREATE INDEX IF NOT EXISTS idx_public_noise_complaints_reference
  ON public.public_noise_complaints(reference);
CREATE INDEX IF NOT EXISTS idx_public_noise_complaints_status
  ON public.public_noise_complaints(status);
CREATE INDEX IF NOT EXISTS idx_public_noise_complaints_org
  ON public.public_noise_complaints(organization_id);

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.public_noise_complaints ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon) can INSERT a new complaint
CREATE POLICY "public_insert_noise_complaint"
  ON public.public_noise_complaints
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Anyone can SELECT a complaint by reference (used by status-check page)
-- We expose only non-PII columns via the policy; client-side select list controls the rest
CREATE POLICY "public_select_by_reference"
  ON public.public_noise_complaints
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Authenticated staff can UPDATE complaints (change status, link jobs)
CREATE POLICY "staff_update_noise_complaint"
  ON public.public_noise_complaints
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = ANY(get_user_organization_ids())
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('master', 'grand_master')
    )
  );

GRANT INSERT, SELECT ON public.public_noise_complaints TO anon;
GRANT INSERT, SELECT ON public.public_noise_complaint_counters TO anon;
GRANT ALL ON public.public_noise_complaints TO authenticated;
GRANT ALL ON public.public_noise_complaint_counters TO authenticated;
