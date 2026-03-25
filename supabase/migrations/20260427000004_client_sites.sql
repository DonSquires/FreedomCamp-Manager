-- Migration: Client Sites – service location CRM
-- Stores client sites (patrol locations, guarding posts, noise-control addresses)
-- that jobs/patrols can be linked to.  Each site can have multiple contacts and
-- belongs to an organisation.

CREATE TABLE IF NOT EXISTS public.client_sites (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id)  ON DELETE CASCADE,
  zone_id             UUID        REFERENCES public.zones(id)                   ON DELETE SET NULL,

  -- Site identity
  name                TEXT        NOT NULL,
  site_code           TEXT,                        -- optional client reference code
  site_type           TEXT        NOT NULL DEFAULT 'general'
                        CHECK (site_type IN (
                          'general', 'freedom_camping', 'guarding', 'parking',
                          'noise_control', 'event', 'infrastructure'
                        )),

  -- Location
  address             TEXT,
  city                TEXT,
  gps_lat             DOUBLE PRECISION,
  gps_lng             DOUBLE PRECISION,

  -- Operational details
  access_instructions TEXT,
  hazards             TEXT,
  special_instructions TEXT,
  notes               TEXT,

  -- Primary contact
  contact_name        TEXT,
  contact_phone       TEXT,
  contact_email       TEXT,

  -- After-hours / emergency contact
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,

  -- SLA defaults (overridable per job)
  default_response_minutes INTEGER DEFAULT 60,   -- target response time
  priority_override   TEXT CHECK (priority_override IN ('low','normal','high','urgent')),

  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_by          UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_sites_org ON public.client_sites(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_client_sites_zone ON public.client_sites(zone_id) WHERE zone_id IS NOT NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_client_sites_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_client_sites_updated_at
  BEFORE UPDATE ON public.client_sites
  FOR EACH ROW EXECUTE FUNCTION public.update_client_sites_updated_at();

ALTER TABLE public.client_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage client_sites"
  ON public.client_sites FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.organization_id = client_sites.organization_id
    )
  );
