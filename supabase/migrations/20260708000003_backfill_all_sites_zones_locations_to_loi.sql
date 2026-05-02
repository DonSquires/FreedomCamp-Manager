-- =============================================================================
-- Backfill all sites/zones/locations into LOI and link source rows
-- =============================================================================
-- Goal:
-- 1) Ensure every resolvable location in core operational tables has an LOI row.
-- 2) Ensure source records are linked back to LOI (client_sites.loi_id, zones.loi_id,
--    dispatch_jobs.loi_id, persons_of_interest.address_loi_id).
--
-- This migration is defensive across LOI schema variants by resolving whether
-- the canonical address column is `display_address` or `address_full` at runtime.

ALTER TABLE public.client_sites
  ADD COLUMN IF NOT EXISTS loi_id UUID REFERENCES public.locations_of_interest(id) ON DELETE SET NULL;

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS loi_id UUID REFERENCES public.locations_of_interest(id) ON DELETE SET NULL;

ALTER TABLE public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS loi_id UUID REFERENCES public.locations_of_interest(id) ON DELETE SET NULL;

ALTER TABLE public.persons_of_interest
  ADD COLUMN IF NOT EXISTS address_loi_id UUID REFERENCES public.locations_of_interest(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_client_sites_loi_id
  ON public.client_sites(loi_id) WHERE loi_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_zones_loi_id
  ON public.zones(loi_id) WHERE loi_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_loi_id
  ON public.dispatch_jobs(loi_id) WHERE loi_id IS NOT NULL;

DO $$
DECLARE
  v_loi_addr_col TEXT;
  v_has_loi_gps BOOLEAN;
  v_has_loi_kind BOOLEAN;
BEGIN
  -- Resolve canonical LOI address column across schema variants.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations_of_interest'
      AND column_name = 'display_address'
  ) THEN
    v_loi_addr_col := 'display_address';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations_of_interest'
      AND column_name = 'address_full'
  ) THEN
    v_loi_addr_col := 'address_full';
  ELSE
    RAISE EXCEPTION 'locations_of_interest requires display_address or address_full column';
  END IF;

  v_has_loi_gps := EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations_of_interest'
      AND column_name = 'gps_lat'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations_of_interest'
      AND column_name = 'gps_lng'
  );

  v_has_loi_kind := EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations_of_interest'
      AND column_name = 'loi_kind'
  );

  -- -------------------------------------------------------------------------
  -- A) Insert LOIs for client sites
  -- -------------------------------------------------------------------------
  EXECUTE format($sql$
    INSERT INTO public.locations_of_interest (organization_id, %I)
    SELECT DISTINCT
      s.organization_id,
      CASE
        WHEN s.address IS NOT NULL AND btrim(s.address) <> '' THEN btrim(s.address)
        ELSE 'Client Site: ' || btrim(s.name)
      END AS canonical_address
    FROM public.client_sites s
    WHERE s.organization_id IS NOT NULL
      AND (coalesce(btrim(s.address), '') <> '' OR coalesce(btrim(s.name), '') <> '')
      AND NOT EXISTS (
        SELECT 1
        FROM public.locations_of_interest l
        WHERE l.organization_id = s.organization_id
          AND lower(l.%I) = lower(
            CASE
              WHEN s.address IS NOT NULL AND btrim(s.address) <> '' THEN btrim(s.address)
              ELSE 'Client Site: ' || btrim(s.name)
            END
          )
      )
  $sql$, v_loi_addr_col, v_loi_addr_col);

  -- -------------------------------------------------------------------------
  -- B) Insert LOIs for zones
  -- -------------------------------------------------------------------------
  EXECUTE format($sql$
    INSERT INTO public.locations_of_interest (organization_id, %I)
    SELECT DISTINCT
      z.organization_id,
      CASE
        WHEN z.name IS NOT NULL AND btrim(z.name) <> '' THEN 'Zone: ' || btrim(z.name)
        ELSE 'Zone: ' || z.id::text
      END AS canonical_address
    FROM public.zones z
    WHERE z.organization_id IS NOT NULL
      AND (coalesce(btrim(z.name), '') <> '' OR z.id IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1
        FROM public.locations_of_interest l
        WHERE l.organization_id = z.organization_id
          AND lower(l.%I) = lower(
            CASE
              WHEN z.name IS NOT NULL AND btrim(z.name) <> '' THEN 'Zone: ' || btrim(z.name)
              ELSE 'Zone: ' || z.id::text
            END
          )
      )
  $sql$, v_loi_addr_col, v_loi_addr_col);

  -- -------------------------------------------------------------------------
  -- C) Insert LOIs for dispatch job addresses
  -- -------------------------------------------------------------------------
  EXECUTE format($sql$
    INSERT INTO public.locations_of_interest (organization_id, %I)
    SELECT DISTINCT
      d.organization_id,
      btrim(d.address)
    FROM public.dispatch_jobs d
    WHERE d.organization_id IS NOT NULL
      AND d.address IS NOT NULL
      AND btrim(d.address) <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM public.locations_of_interest l
        WHERE l.organization_id = d.organization_id
          AND lower(l.%I) = lower(btrim(d.address))
      )
  $sql$, v_loi_addr_col, v_loi_addr_col);

  -- -------------------------------------------------------------------------
  -- D) Insert LOIs for persons_of_interest addresses
  -- -------------------------------------------------------------------------
  EXECUTE format($sql$
    INSERT INTO public.locations_of_interest (organization_id, %I)
    SELECT DISTINCT
      p.organization_id,
      btrim(p.address)
    FROM public.persons_of_interest p
    WHERE p.organization_id IS NOT NULL
      AND p.address IS NOT NULL
      AND btrim(p.address) <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM public.locations_of_interest l
        WHERE l.organization_id = p.organization_id
          AND lower(l.%I) = lower(btrim(p.address))
      )
  $sql$, v_loi_addr_col, v_loi_addr_col);

  -- -------------------------------------------------------------------------
  -- E) Backfill GPS from client_sites and zones where LOI coords are empty
  -- -------------------------------------------------------------------------
  IF v_has_loi_gps THEN
    EXECUTE format($sql$
      UPDATE public.locations_of_interest l
      SET gps_lat = s.gps_lat,
          gps_lng = s.gps_lng
      FROM public.client_sites s
      WHERE l.organization_id = s.organization_id
        AND lower(l.%I) = lower(
          CASE
            WHEN s.address IS NOT NULL AND btrim(s.address) <> '' THEN btrim(s.address)
            ELSE 'Client Site: ' || btrim(s.name)
          END
        )
        AND l.gps_lat IS NULL
        AND l.gps_lng IS NULL
        AND s.gps_lat IS NOT NULL
        AND s.gps_lng IS NOT NULL
    $sql$, v_loi_addr_col);

    EXECUTE format($sql$
      UPDATE public.locations_of_interest l
      SET gps_lat = z.location_lat,
          gps_lng = z.location_lng
      FROM public.zones z
      WHERE l.organization_id = z.organization_id
        AND lower(l.%I) = lower(
          CASE
            WHEN z.name IS NOT NULL AND btrim(z.name) <> '' THEN 'Zone: ' || btrim(z.name)
            ELSE 'Zone: ' || z.id::text
          END
        )
        AND l.gps_lat IS NULL
        AND l.gps_lng IS NULL
        AND z.location_lat IS NOT NULL
        AND z.location_lng IS NOT NULL
    $sql$, v_loi_addr_col);

    EXECUTE format($sql$
      UPDATE public.locations_of_interest l
      SET gps_lat = d.gps_lat,
          gps_lng = d.gps_lng
      FROM public.dispatch_jobs d
      WHERE l.organization_id = d.organization_id
        AND d.address IS NOT NULL
        AND btrim(d.address) <> ''
        AND lower(l.%I) = lower(btrim(d.address))
        AND l.gps_lat IS NULL
        AND l.gps_lng IS NULL
        AND d.gps_lat IS NOT NULL
        AND d.gps_lng IS NOT NULL
    $sql$, v_loi_addr_col);
  END IF;

  -- -------------------------------------------------------------------------
  -- F) Optional LOI kind tagging where available
  -- -------------------------------------------------------------------------
  IF v_has_loi_kind THEN
    EXECUTE format($sql$
      UPDATE public.locations_of_interest l
      SET loi_kind = 'address'
      WHERE l.loi_kind IS NULL
        AND l.%I IS NOT NULL
        AND btrim(l.%I) <> ''
    $sql$, v_loi_addr_col, v_loi_addr_col);
  END IF;

  -- -------------------------------------------------------------------------
  -- G) Link source records back to LOI
  -- -------------------------------------------------------------------------
  EXECUTE format($sql$
    UPDATE public.client_sites s
    SET loi_id = l.id
    FROM public.locations_of_interest l
    WHERE s.loi_id IS NULL
      AND l.organization_id = s.organization_id
      AND lower(l.%I) = lower(
        CASE
          WHEN s.address IS NOT NULL AND btrim(s.address) <> '' THEN btrim(s.address)
          ELSE 'Client Site: ' || btrim(s.name)
        END
      )
  $sql$, v_loi_addr_col);

  EXECUTE format($sql$
    UPDATE public.zones z
    SET loi_id = l.id
    FROM public.locations_of_interest l
    WHERE z.loi_id IS NULL
      AND l.organization_id = z.organization_id
      AND lower(l.%I) = lower(
        CASE
          WHEN z.name IS NOT NULL AND btrim(z.name) <> '' THEN 'Zone: ' || btrim(z.name)
          ELSE 'Zone: ' || z.id::text
        END
      )
  $sql$, v_loi_addr_col);

  EXECUTE format($sql$
    UPDATE public.dispatch_jobs d
    SET loi_id = l.id
    FROM public.locations_of_interest l
    WHERE d.loi_id IS NULL
      AND d.address IS NOT NULL
      AND btrim(d.address) <> ''
      AND l.organization_id = d.organization_id
      AND lower(l.%I) = lower(btrim(d.address))
  $sql$, v_loi_addr_col);

  EXECUTE format($sql$
    UPDATE public.persons_of_interest p
    SET address_loi_id = l.id
    FROM public.locations_of_interest l
    WHERE p.address_loi_id IS NULL
      AND p.address IS NOT NULL
      AND btrim(p.address) <> ''
      AND l.organization_id = p.organization_id
      AND lower(l.%I) = lower(btrim(p.address))
  $sql$, v_loi_addr_col);

  RAISE NOTICE 'Backfill complete: sites/zones/dispatch/person addresses linked to LOI via %', v_loi_addr_col;
END $$;
