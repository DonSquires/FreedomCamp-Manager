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
--
-- This migration also creates the table from scratch if it does not exist
-- (handles databases where 20260219000002 or 20260220000005 did not apply).
-- ============================================================================

-- 0. Create the table if it does not yet exist.
--    All columns are nullable (except id, notice_number, status) so that
--    ALTER TABLE ADD COLUMN IF NOT EXISTS below remains a safe no-op.
CREATE TABLE IF NOT EXISTS public.infringement_notices (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id              UUID,        -- FK added conditionally below (enforcement_cases may not exist yet)
  notice_number        TEXT        UNIQUE NOT NULL,
  notice_type          TEXT,
  plate_number         TEXT,
  offence_description  TEXT,
  legal_basis          TEXT,
  offence_date         TIMESTAMPTZ,
  offence_location     TEXT,
  offence_location_gps TEXT,
  zone_id              UUID        REFERENCES public.zones(id) ON DELETE SET NULL,
  observation_id       UUID,        -- no FK: observations PK is observation_id; id is a nullable secondary column
  breach_alert_id      UUID        REFERENCES public.breach_alerts(id) ON DELETE SET NULL,
  amount_cents         INTEGER,
  fee_amount           NUMERIC(10,2),
  due_date             DATE,
  payment_deadline     DATE,
  payment_methods      JSONB       DEFAULT '["bank_transfer","online"]'::jsonb,
  payment_reference    TEXT,
  service_method       TEXT        CHECK (service_method IN ('hand', 'post', 'email')),
  summary_of_rights    TEXT,
  delivery_evidence    JSONB       DEFAULT '{}'::jsonb,
  recipient_name       TEXT,
  recipient_address    TEXT,
  recipient_email      TEXT,
  served_at            TIMESTAMPTZ,
  status               TEXT        NOT NULL DEFAULT 'draft'
                                   CHECK (status IN ('draft','issued','paid','reminder_sent','court_referred','withdrawn','cancelled')),
  issued_by            UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  issued_at            TIMESTAMPTZ,
  created_by           UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  reminder_sent_at     TIMESTAMPTZ,
  court_referral_date  DATE,
  withdrawn_reason     TEXT,
  notice_pdf_url       TEXT,
  notice_pdf_hash      TEXT,
  evidence_bundle_url  TEXT,
  evidence_bundle_hash TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS (idempotent)
ALTER TABLE public.infringement_notices ENABLE ROW LEVEL SECURITY;

-- 1. Add missing columns (safe, idempotent — no-op if table was just created above)
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

-- 6. Add FK from case_id → enforcement_cases only if that table exists.
--    (enforcement_cases is created in 20260220000005; on some remotes it may
--    have been repair-marked but never applied, so we guard here.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name   = 'enforcement_cases'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
       WHERE table_schema    = 'public'
         AND table_name      = 'infringement_notices'
         AND constraint_name = 'infringement_notices_case_id_fkey'
    ) THEN
      ALTER TABLE public.infringement_notices
        ADD CONSTRAINT infringement_notices_case_id_fkey
        FOREIGN KEY (case_id) REFERENCES public.enforcement_cases(id) ON DELETE CASCADE;
      RAISE NOTICE '✅ infringement_notices_case_id_fkey constraint added';
    ELSE
      RAISE NOTICE '✅ infringement_notices_case_id_fkey already exists, skipping';
    END IF;
  ELSE
    RAISE NOTICE '⚠️  enforcement_cases does not exist; skipping case_id FK (will be added by 20260220000005 when it runs)';
  END IF;
END;
$$;

DO $$
BEGIN
  RAISE NOTICE '✅ infringement_notices: amount_cents, due_date, created_by columns added and backfilled';
END;
$$;
