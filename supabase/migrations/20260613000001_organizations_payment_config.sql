-- ============================================================================
-- Add payment_config JSONB column to organizations
-- Date: 2026-06-13
--
-- Adds a per-organisation payment routing configuration.
-- Supports three payment modes:
--   1. redirect      – hand-off to council's existing payment portal
--   2. windcave_api  – BYOG: use organisation's own Windcave API credentials
--   3. stripe_api    – BYOG: use organisation's own Stripe credentials
--   4. bank_transfer – display manual bank transfer instructions
--
-- API keys are NEVER stored in this column.  The column holds only the
-- mode discriminator, public/display values, and the *name* of the
-- Railway environment secret that holds the actual key.
--
-- See docs/PAYMENT_FLOW.md for the full architecture.
-- ============================================================================

-- ── 1. Add the column ────────────────────────────────────────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS payment_config JSONB DEFAULT NULL;

COMMENT ON COLUMN public.organizations.payment_config IS
  'Multi-tenant payment routing configuration. '
  'Null = payment feature not enabled for this org. '
  'Discriminator field: payment_config->>''type'' '
  '  redirect      = link to council legacy portal '
  '  windcave_api  = BYOG Windcave (api_key_secret_name stores Railway secret name) '
  '  stripe_api    = BYOG Stripe (secret_key_secret_name stores Railway secret name) '
  '  bank_transfer = display manual bank transfer instructions '
  'See docs/PAYMENT_FLOW.md §3 for full JSON schema.';

-- ── 2. Index for quick lookup by payment type ─────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_organizations_payment_type
  ON public.organizations ((payment_config->>'type'))
  WHERE payment_config IS NOT NULL;

-- ── 3. Check constraint: type must be a known value when set ─────────────────

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_payment_config_type_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_payment_config_type_check CHECK (
    payment_config IS NULL
    OR (payment_config->>'type') IN (
      'redirect',
      'windcave_api',
      'stripe_api',
      'bank_transfer'
    )
  );

-- ── 4. Summary ───────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE 'Migration 20260613000001: organizations.payment_config';
  RAISE NOTICE '  Column added:    payment_config JSONB DEFAULT NULL';
  RAISE NOTICE '  Index added:     idx_organizations_payment_type';
  RAISE NOTICE '  Constraint added: organizations_payment_config_type_check';
  RAISE NOTICE '  Permitted types: redirect, windcave_api, stripe_api, bank_transfer';
  RAISE NOTICE '  See docs/PAYMENT_FLOW.md for usage.';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
END $$;
