-- ==========================================================================
-- Add payment and objection contact fields to zone_legal_config
-- Date: 2026-03-17
--
-- Required so infringement notices can show actual payment channels and
-- objection destinations for the issuing jurisdiction.
-- ==========================================================================

ALTER TABLE public.zone_legal_config
  ADD COLUMN IF NOT EXISTS payment_online_url TEXT,
  ADD COLUMN IF NOT EXISTS payment_bank_account TEXT,
  ADD COLUMN IF NOT EXISTS payment_instructions TEXT,
  ADD COLUMN IF NOT EXISTS objections_email TEXT,
  ADD COLUMN IF NOT EXISTS objections_postal_address TEXT;

COMMENT ON COLUMN public.zone_legal_config.payment_online_url IS 'Public URL for online infringement payments';
COMMENT ON COLUMN public.zone_legal_config.payment_bank_account IS 'Bank account number for infringement payments';
COMMENT ON COLUMN public.zone_legal_config.payment_instructions IS 'Free-text payment instructions shown on the notice';
COMMENT ON COLUMN public.zone_legal_config.objections_email IS 'Email address for written objections to an infringement notice';
COMMENT ON COLUMN public.zone_legal_config.objections_postal_address IS 'Postal address for written objections to an infringement notice';