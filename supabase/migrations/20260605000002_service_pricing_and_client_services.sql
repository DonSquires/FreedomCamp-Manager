-- =============================================================================
-- SERVICE PRICING & CLIENT SERVICE ASSIGNMENTS
-- =============================================================================
-- Two tables to power the card-based admin hub:
--
--   1. client_org_services   — which service types are enabled for each client org.
--                              Drives what officers can access when rostered to that client.
--
--   2. service_pricing        — per-client per-service pricing.
--                              Supports hourly rate, per-service flat fee, and distance/travel
--                              charges for invoicing purposes.
-- =============================================================================

-- =============================================================================
-- 1. CLIENT ORG SERVICES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.client_org_services (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The client organisation this assignment belongs to
  organization_id  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Service type code — matches roster_shifts.service_type + extended list
  service_type     TEXT        NOT NULL CHECK (service_type IN (
    'freedom_camping',
    'guarding',
    'parking',
    'noise_control',
    'patrol',
    'alarm_response',
    'ems',
    'access_control',
    'building_checks',
    'person_of_interest',
    'vehicle_of_interest',
    'identity_verification',
    'investigation',
    'dispatch',
    'site_risk_assessment',
    'escort',
    'key_holding'
  )),

  -- Whether this service is currently active for the client
  is_enabled       BOOLEAN     NOT NULL DEFAULT TRUE,

  -- Optional notes (e.g., "NCC — full city jurisdiction")
  notes            TEXT,

  -- Optional call-sign override for this service at this client
  default_call_sign TEXT,

  -- Audit
  created_by       UUID        REFERENCES public.user_profiles(id),
  updated_by       UUID        REFERENCES public.user_profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Each client can have each service type only once
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_org_services_unique
  ON public.client_org_services(organization_id, service_type);

CREATE INDEX IF NOT EXISTS idx_client_org_services_org
  ON public.client_org_services(organization_id);

CREATE INDEX IF NOT EXISTS idx_client_org_services_enabled
  ON public.client_org_services(organization_id, is_enabled) WHERE is_enabled = TRUE;

COMMENT ON TABLE public.client_org_services IS
  'Service type assignments for client organisations. Controls which modules officers can access when rostered to a client.';

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_client_org_services_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_org_services_updated_at ON public.client_org_services;
CREATE TRIGGER trg_client_org_services_updated_at
  BEFORE UPDATE ON public.client_org_services
  FOR EACH ROW EXECUTE FUNCTION public.set_client_org_services_updated_at();

-- =============================================================================
-- 2. SERVICE PRICING
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.service_pricing (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Provider and client pairing
  provider_organization_id UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_organization_id  UUID          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- The service this price applies to
  service_type            TEXT          NOT NULL CHECK (service_type IN (
    'freedom_camping',
    'guarding',
    'parking',
    'noise_control',
    'patrol',
    'alarm_response',
    'ems',
    'access_control',
    'building_checks',
    'person_of_interest',
    'vehicle_of_interest',
    'identity_verification',
    'investigation',
    'dispatch',
    'site_risk_assessment',
    'escort',
    'key_holding'
  )),

  -- Pricing models (any combination can be used simultaneously)

  -- Hourly charge rate (what the client is billed per hour)
  hourly_charge_rate      NUMERIC(10,2),
  -- Hourly pay rate (what the officer is paid per hour — internal)
  hourly_pay_rate         NUMERIC(10,2),

  -- Per-service flat fee (e.g. $X per alarm response call-out)
  per_service_charge      NUMERIC(10,2),
  per_service_pay         NUMERIC(10,2),

  -- Minimum billable hours per call-out (e.g. 1 hour minimum)
  minimum_hours           NUMERIC(4,2),

  -- Distance / travel charges
  travel_charge_enabled   BOOLEAN       NOT NULL DEFAULT FALSE,
  -- Rate per kilometre charged to client
  travel_charge_per_km    NUMERIC(10,4),
  -- Flat call-out travel fee (in addition to per-km)
  travel_call_out_fee     NUMERIC(10,2),
  -- Maximum travel km included before per-km kicks in
  travel_free_km          NUMERIC(6,2),

  -- Currency
  currency                TEXT          NOT NULL DEFAULT 'NZD',

  -- Effective dates (NULL = always active)
  effective_from          DATE,
  effective_to            DATE,

  -- Notes for the billing team
  notes                   TEXT,

  -- Status
  is_active               BOOLEAN       NOT NULL DEFAULT TRUE,

  -- Audit
  created_by              UUID          REFERENCES public.user_profiles(id),
  updated_by              UUID          REFERENCES public.user_profiles(id),
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- One active price per provider/client/service
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_pricing_unique_active
  ON public.service_pricing(provider_organization_id, client_organization_id, service_type)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_service_pricing_client
  ON public.service_pricing(client_organization_id);

CREATE INDEX IF NOT EXISTS idx_service_pricing_provider
  ON public.service_pricing(provider_organization_id);

COMMENT ON TABLE public.service_pricing IS
  'Per-client per-service pricing configuration. Supports hourly, per-service flat fee, and distance/travel charges.';

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_service_pricing_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_pricing_updated_at ON public.service_pricing;
CREATE TRIGGER trg_service_pricing_updated_at
  BEFORE UPDATE ON public.service_pricing
  FOR EACH ROW EXECUTE FUNCTION public.set_service_pricing_updated_at();

-- =============================================================================
-- 3. ROW-LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.client_org_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_pricing      ENABLE ROW LEVEL SECURITY;

-- client_org_services: admins/masters can manage; officers can read (to know their services)
DROP POLICY IF EXISTS "admins_manage_client_org_services" ON public.client_org_services;
CREATE POLICY "admins_manage_client_org_services"
  ON public.client_org_services FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'master', 'grand_master')
    )
  );

DROP POLICY IF EXISTS "officers_read_client_org_services" ON public.client_org_services;
CREATE POLICY "officers_read_client_org_services"
  ON public.client_org_services FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('officer', 'admin_officer')
    )
  );

-- service_pricing: admins/masters only (confidential rate information)
DROP POLICY IF EXISTS "admins_manage_service_pricing" ON public.service_pricing;
CREATE POLICY "admins_manage_service_pricing"
  ON public.service_pricing FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'master', 'grand_master')
    )
  );

-- =============================================================================
-- 4. GRANTS
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_org_services TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_pricing      TO authenticated;

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================
