-- ============================================================================
-- Add missing columns to infringement_notices
-- Date: 2026-04-11
--
-- The infringement_notices table was initially created by migration
-- 20260219000002_evidence_integrity_and_legal_compliance.sql which used
-- fee_amount / payment_deadline / issued_by as column names.
--
-- The generate-infringement Edge Function and InfringementNotices.tsx page
-- were written expecting amount_cents / due_date / created_by (from the
-- 20260220000005 schema that was never applied because the table already
-- existed).  This migration adds those columns so the UI and Edge Function
-- work correctly.
-- ============================================================================

-- 1. Add missing columns (safe, idempotent)
ALTER TABLE public.infringement_notices
  ADD COLUMN IF NOT EXISTS amount_cents   INTEGER,
  ADD COLUMN IF NOT EXISTS due_date       DATE,
  ADD COLUMN IF NOT EXISTS created_by     UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- 2. Backfill amount_cents from fee_amount where not yet set
--    fee_amount is NUMERIC(10,2) in dollars; amount_cents is the integer cent value
UPDATE public.infringement_notices
   SET amount_cents = CAST(fee_amount * 100 AS INTEGER)
 WHERE amount_cents IS NULL
   AND fee_amount IS NOT NULL;

-- 3. Backfill due_date from payment_deadline where not yet set
UPDATE public.infringement_notices
   SET due_date = payment_deadline
 WHERE due_date IS NULL
   AND payment_deadline IS NOT NULL;

-- 4. Backfill created_by from issued_by where not yet set
UPDATE public.infringement_notices
   SET created_by = issued_by
 WHERE created_by IS NULL
   AND issued_by IS NOT NULL;

-- 5. Index on created_by for the FK join used by the admin UI
CREATE INDEX IF NOT EXISTS idx_infringement_notices_created_by
  ON public.infringement_notices (created_by);

DO $$
BEGIN
  RAISE NOTICE '✅ infringement_notices: amount_cents, due_date, created_by columns added and backfilled';
END;
$$;
