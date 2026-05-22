-- =============================================================================
-- Migration: LOI Service Domains (Multi-Select)
-- Date: 2026-07-21
-- =============================================================================
--
-- Adds service_domains array to locations_of_interest to support LOI assignment
-- to multiple service types (patrol, alarm_response, noise_control, parking,
-- freedom_camping, biosecurity) simultaneously.
--
-- Schema:
--   service_domains: TEXT[] — array of domain strings
--   Examples: '{"patrol"}', '{"patrol","alarm_response"}', '{"noise_control","parking"}'
--
-- Special value: '*' (or 'all') marks LOI as usable across all domains
--
-- =============================================================================

ALTER TABLE public.locations_of_interest
  ADD COLUMN IF NOT EXISTS service_domains TEXT[] DEFAULT '{}';

-- Index for efficient filtering by domain (uses GIN for array containment)
CREATE INDEX IF NOT EXISTS idx_loi_service_domains
  ON public.locations_of_interest USING gin(service_domains)
  WHERE is_active = true;

-- Functional index for common queries like "patrol domain"
CREATE INDEX IF NOT EXISTS idx_loi_org_domain
  ON public.locations_of_interest(organization_id)
  WHERE is_active = true;

-- Constraint: ensure service_domains contains only valid values or empty
-- Valid domains: 'patrol', 'alarm_response', 'noise_control', 'parking', 'freedom_camping', 'biosecurity', 'static_guard', '*'
ALTER TABLE public.locations_of_interest
  ADD CONSTRAINT loi_service_domains_valid CHECK (
    service_domains IS NULL
    OR service_domains = '{}'::TEXT[]
    OR (
      array_length(service_domains, 1) > 0
      AND (service_domains <@ ARRAY['patrol', 'alarm_response', 'noise_control', 'parking', 'freedom_camping', 'biosecurity', 'static_guard', '*']::TEXT[])
    )
  );

COMMENT ON COLUMN public.locations_of_interest.service_domains IS
  'Array of service domains this LOI serves (patrol, alarm_response, noise_control, parking, freedom_camping, biosecurity, static_guard). Use ''*'' or ''all'' for multi-domain LOI. Empty array = no domains assigned yet.';

-- Helper function: check if LOI serves a given domain
CREATE OR REPLACE FUNCTION public.loi_serves_domain(
  p_loi_id UUID,
  p_domain TEXT
)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT
    CASE
      WHEN '*' = ANY((SELECT service_domains FROM locations_of_interest WHERE id = p_loi_id))
        THEN TRUE
      ELSE p_domain = ANY((SELECT service_domains FROM locations_of_interest WHERE id = p_loi_id))
    END;
$$;

COMMENT ON FUNCTION public.loi_serves_domain(UUID, TEXT) IS
  'Returns TRUE if LOI is assigned to the given service domain or to ''*'' (all domains).';

DO $$
BEGIN
  RAISE NOTICE '✅ locations_of_interest.service_domains added with multi-select support';
END $$;
