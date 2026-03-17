-- ============================================================================
-- Add vehicle make/model fields to infringement_notices
-- Date: 2026-03-17
--
-- Required for NZ FCA-compliant infringement notices (DOC / Kawerau DC format).
-- The printed notice must identify the vehicle by registration + make/model.
-- ============================================================================

ALTER TABLE public.infringement_notices
  ADD COLUMN IF NOT EXISTS vehicle_make  TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_model TEXT;

COMMENT ON COLUMN public.infringement_notices.vehicle_make  IS 'Vehicle make (e.g. Toyota) — mandatory for NZ FCA-compliant notice';
COMMENT ON COLUMN public.infringement_notices.vehicle_model IS 'Vehicle model (e.g. Hiace) — mandatory for NZ FCA-compliant notice';
