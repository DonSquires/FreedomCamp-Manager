-- ============================================================================
-- Extend canonical_scv to store full NZSCV payload fields
-- ============================================================================
-- Purpose:
--   Persist optional NZSCV response fields so they can be backfilled into
--   observations and used for mismatch detection against inference outputs.

ALTER TABLE public.canonical_scv
  ADD COLUMN IF NOT EXISTS certificate_issue_date DATE,
  ADD COLUMN IF NOT EXISTS certificate_status TEXT,
  ADD COLUMN IF NOT EXISTS vin TEXT,
  ADD COLUMN IF NOT EXISTS max_occupants INTEGER,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS raw_payload JSONB;

COMMENT ON COLUMN public.canonical_scv.certificate_issue_date IS 'NZSCV certificate issue date';
COMMENT ON COLUMN public.canonical_scv.certificate_status IS 'NZSCV certificate status: Current | Issued | Revoked | Expired';
COMMENT ON COLUMN public.canonical_scv.vin IS 'Vehicle VIN from NZSCV';
COMMENT ON COLUMN public.canonical_scv.max_occupants IS 'Certified max occupants from NZSCV';
COMMENT ON COLUMN public.canonical_scv.logo_url IS 'NZSCV logo URL returned by API';
COMMENT ON COLUMN public.canonical_scv.raw_payload IS 'Raw NZSCV payload for audit/backfill';

CREATE INDEX IF NOT EXISTS idx_canonical_scv_status
  ON public.canonical_scv (certificate_status)
  WHERE certificate_status IS NOT NULL;
