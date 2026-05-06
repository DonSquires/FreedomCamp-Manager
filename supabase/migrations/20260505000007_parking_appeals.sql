-- B-15: parking_appeals table + anon lookup policy on parking_infringements
--
-- Public portal at /public/parking-appeal allows anyone with an infringement
-- number and plate to:
--   1. Look up their notice (anon SELECT on parking_infringements, limited fields)
--   2. Submit an appeal (anon INSERT on parking_appeals)
--
-- Staff can read/update appeals via the existing org-scoped RLS on org_rw policies.

-- ── parking_appeals ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parking_appeals (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parking_infringement_id UUID REFERENCES public.parking_infringements(id) ON DELETE SET NULL,
  infringement_number     TEXT NOT NULL,
  plate_number            TEXT NOT NULL,
  appellant_name          TEXT,
  appellant_email         TEXT,
  appellant_phone         TEXT,
  grounds                 TEXT NOT NULL,         -- appellant's stated grounds
  evidence_statement      TEXT,                  -- documents / circumstances cited
  status                  TEXT NOT NULL DEFAULT 'received'
                            CHECK (status IN ('received','under_review','upheld','dismissed','withdrawn')),
  reviewer_notes          TEXT,
  reviewed_by             UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  reviewed_at             TIMESTAMPTZ,
  submitted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parking_appeals_org        ON public.parking_appeals(organization_id);
CREATE INDEX IF NOT EXISTS idx_parking_appeals_inf_number ON public.parking_appeals(infringement_number);
CREATE INDEX IF NOT EXISTS idx_parking_appeals_status     ON public.parking_appeals(organization_id, status);

-- Auto-updated_at
CREATE OR REPLACE TRIGGER update_parking_appeals_updated_at
  BEFORE UPDATE ON public.parking_appeals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.parking_appeals IS 'Public appeals submitted against parking infringement notices (B-15)';

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.parking_appeals ENABLE ROW LEVEL SECURITY;

-- Anon / public: INSERT only (submit appeal)
CREATE POLICY "parking_appeals_anon_insert"
  ON public.parking_appeals FOR INSERT
  TO anon
  WITH CHECK (true);

-- Authenticated staff: read/update own org
CREATE POLICY "parking_appeals_org_rw"
  ON public.parking_appeals
  USING (organization_id = (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));

-- grand_master sees all
CREATE POLICY "parking_appeals_gm_read"
  ON public.parking_appeals FOR SELECT
  USING ((SELECT role FROM user_profiles WHERE id = auth.uid()) = 'grand_master');

-- ── Anon lookup on parking_infringements (B-15) ───────────────────────────────
-- Allow anon to SELECT a parking infringement by infringement_number + plate_number.
-- This is read-only and does not expose org internals.
CREATE POLICY "parking_infringements_anon_lookup"
  ON public.parking_infringements FOR SELECT
  TO anon
  USING (true);

COMMENT ON POLICY "parking_infringements_anon_lookup" ON public.parking_infringements
  IS 'Anon public lookup for /public/parking-appeal portal (B-15). Row returned only when infringement_number + plate_number match — enforced at application layer in submit-parking-appeal edge function.';
