-- =============================================================================
-- Enforce organization linkage for sites, zones, and locations of interest
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_client_site_org_linkage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_zone_org_id UUID;
  v_loi_org_id UUID;
BEGIN
  IF NEW.zone_id IS NOT NULL THEN
    SELECT z.organization_id
      INTO v_zone_org_id
    FROM public.zones z
    WHERE z.id = NEW.zone_id;

    IF v_zone_org_id IS NULL THEN
      RAISE EXCEPTION 'client_sites.zone_id (%) does not exist', NEW.zone_id;
    END IF;

    IF v_zone_org_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'client_sites.zone_id (%) belongs to org %, expected %',
        NEW.zone_id, v_zone_org_id, NEW.organization_id;
    END IF;
  END IF;

  IF NEW.loi_id IS NOT NULL THEN
    SELECT l.organization_id
      INTO v_loi_org_id
    FROM public.locations_of_interest l
    WHERE l.id = NEW.loi_id;

    IF v_loi_org_id IS NULL THEN
      RAISE EXCEPTION 'client_sites.loi_id (%) does not exist', NEW.loi_id;
    END IF;

    IF v_loi_org_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'client_sites.loi_id (%) belongs to org %, expected %',
        NEW.loi_id, v_loi_org_id, NEW.organization_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_sites_enforce_org_linkage ON public.client_sites;
CREATE TRIGGER trg_client_sites_enforce_org_linkage
  BEFORE INSERT OR UPDATE OF organization_id, zone_id, loi_id
  ON public.client_sites
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_client_site_org_linkage();

CREATE OR REPLACE FUNCTION public.enforce_zone_loi_org_linkage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_loi_org_id UUID;
BEGIN
  IF NEW.loi_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT l.organization_id
    INTO v_loi_org_id
  FROM public.locations_of_interest l
  WHERE l.id = NEW.loi_id;

  IF v_loi_org_id IS NULL THEN
    RAISE EXCEPTION 'zones.loi_id (%) does not exist', NEW.loi_id;
  END IF;

  IF v_loi_org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'zones.loi_id (%) belongs to org %, expected %',
      NEW.loi_id, v_loi_org_id, NEW.organization_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zones_enforce_loi_org_linkage ON public.zones;
CREATE TRIGGER trg_zones_enforce_loi_org_linkage
  BEFORE INSERT OR UPDATE OF organization_id, loi_id
  ON public.zones
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_zone_loi_org_linkage();

-- Keep existing rows valid by clearing cross-org references.
UPDATE public.client_sites s
SET zone_id = NULL
WHERE zone_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.zones z
    WHERE z.id = s.zone_id
      AND z.organization_id = s.organization_id
  );

UPDATE public.client_sites s
SET loi_id = NULL
WHERE loi_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.locations_of_interest l
    WHERE l.id = s.loi_id
      AND l.organization_id = s.organization_id
  );

UPDATE public.zones z
SET loi_id = NULL
WHERE loi_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.locations_of_interest l
    WHERE l.id = z.loi_id
      AND l.organization_id = z.organization_id
  );
