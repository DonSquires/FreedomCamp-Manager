-- ============================================================================
-- Capture full NZSCV registry data for vehicle mismatch detection
-- ============================================================================
-- Purpose: Store all NZSCV response fields in observations table so inference
--          service can compare detected vehicle attributes (make, model, year, 
--          color, VIN) against registered details and flag discrepancies.
--
-- New columns:
--   - nzscv_certificate_status: 'Current' | 'Issued' | 'Revoked' | 'Expired'
--   - nzscv_certificate_issue_date: when certification was issued
--   - vehicle_vin: for anti-spoofing and stolen vehicle verification
--   - vehicle_max_occupants: for density/occupancy compliance checks
--   - nzscv_logo_url: official badge/verification mark for UI display
--   - nzscv_checked_at: audit trail of when NZSCV was last queried

ALTER TABLE public.observations ADD COLUMN IF NOT EXISTS nzscv_certificate_status TEXT;
COMMENT ON COLUMN public.observations.nzscv_certificate_status IS 'NZSCV status: Current | Issued | Revoked | Expired';

ALTER TABLE public.observations ADD COLUMN IF NOT EXISTS nzscv_certificate_issue_date DATE;
COMMENT ON COLUMN public.observations.nzscv_certificate_issue_date IS 'NZSCV certificate issued date (YYYY-MM-DD)';

ALTER TABLE public.observations ADD COLUMN IF NOT EXISTS vehicle_vin TEXT;
COMMENT ON COLUMN public.observations.vehicle_vin IS 'Vehicle Identification Number from NZSCV or inference service';

ALTER TABLE public.observations ADD COLUMN IF NOT EXISTS vehicle_max_occupants INTEGER;
COMMENT ON COLUMN public.observations.vehicle_max_occupants IS 'Maximum certified occupants for self-contained vehicles';

ALTER TABLE public.observations ADD COLUMN IF NOT EXISTS nzscv_logo_url TEXT;
COMMENT ON COLUMN public.observations.nzscv_logo_url IS 'Official NZSCV verification badge URL for UI display';

ALTER TABLE public.observations ADD COLUMN IF NOT EXISTS nzscv_checked_at TIMESTAMPTZ;
COMMENT ON COLUMN public.observations.nzscv_checked_at IS 'Timestamp of NZSCV registry lookup';

-- Create index for mismatch detection queries
CREATE INDEX IF NOT EXISTS idx_observations_nzscv_status 
  ON public.observations (nzscv_certificate_status) 
  WHERE nzscv_certificate_status IN ('Revoked', 'Expired');

CREATE INDEX IF NOT EXISTS idx_observations_vin 
  ON public.observations (vehicle_vin) 
  WHERE vehicle_vin IS NOT NULL;
