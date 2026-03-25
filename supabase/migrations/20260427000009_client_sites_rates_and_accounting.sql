-- Migration: Client Sites — pay rates, charge rates, and Microsoft 365 accounting link
--
-- Adds financial fields to client_sites so the roster planner can inherit
-- correct pay/charge rates when building shifts for a site, and the site
-- CRM can carry a Microsoft 365 / Business Central customer reference for
-- seamless invoice/billing integration.

ALTER TABLE public.client_sites
  -- Workforce costing (InTime-style: default pay rate per site)
  ADD COLUMN IF NOT EXISTS default_pay_rate        NUMERIC(10, 4),  -- Officer pay rate ($/hr) for this site
  ADD COLUMN IF NOT EXISTS default_charge_rate     NUMERIC(10, 4),  -- Client charge rate ($/hr) billed to client
  ADD COLUMN IF NOT EXISTS overtime_pay_multiplier NUMERIC(4, 2)  DEFAULT 1.5,  -- e.g. 1.5× for OT
  ADD COLUMN IF NOT EXISTS currency_code           TEXT           DEFAULT 'NZD',

  -- Microsoft 365 / Business Central accounting integration
  ADD COLUMN IF NOT EXISTS m365_customer_id        TEXT,  -- M365 BC Customer No. (e.g. "C00042")
  ADD COLUMN IF NOT EXISTS m365_contract_ref       TEXT,  -- Contract/project reference for invoice line
  ADD COLUMN IF NOT EXISTS m365_cost_centre        TEXT,  -- Cost centre code

  -- Contract metadata
  ADD COLUMN IF NOT EXISTS contract_start_date     DATE,
  ADD COLUMN IF NOT EXISTS contract_end_date       DATE,
  ADD COLUMN IF NOT EXISTS invoice_frequency       TEXT   CHECK (invoice_frequency IN ('weekly','fortnightly','monthly','on_completion')) DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS purchase_order_number   TEXT;

COMMENT ON COLUMN public.client_sites.default_pay_rate        IS 'Default officer pay rate ($/hr) used when creating roster shifts for this site. Overridable per shift.';
COMMENT ON COLUMN public.client_sites.default_charge_rate     IS 'Default client charge rate ($/hr) billed for work at this site. Overridable per shift.';
COMMENT ON COLUMN public.client_sites.m365_customer_id        IS 'Microsoft 365 Business Central Customer Number for automated invoice sync.';
COMMENT ON COLUMN public.client_sites.m365_contract_ref       IS 'M365 project/contract reference number for invoice line items.';
