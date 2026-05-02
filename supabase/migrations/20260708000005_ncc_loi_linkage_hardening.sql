-- =============================================================================
-- NCC LOI Linkage Hardening
-- Ensures Nelson City Council sites and zones are represented in LOI and linked
-- =============================================================================

DO $$
DECLARE
  v_ncc_org_id UUID;
  v_loi_addr_col TEXT;
  v_has_loi_name BOOLEAN;
  v_has_loi_kind BOOLEAN;
  v_has_loi_gps BOOLEAN;
BEGIN
  SELECT id
  INTO v_ncc_org_id
  FROM public.organizations
  WHERE lower(name) = lower('Nelson City Council')
  LIMIT 1;

  IF v_ncc_org_id IS NULL THEN
    RAISE NOTICE 'NCC org not found; skipping NCC LOI linkage hardening';
    RETURN;
  END IF;

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

  v_has_loi_name := EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations_of_interest'
      AND column_name = 'name'
  );

  v_has_loi_kind := EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations_of_interest'
      AND column_name = 'loi_kind'
  );

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

  -- -------------------------------------------------------------------------
  -- A) Insert missing LOI rows for NCC client sites
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
    WHERE s.organization_id = %L::uuid
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
  $sql$, v_loi_addr_col, v_ncc_org_id::text, v_loi_addr_col);

  -- -------------------------------------------------------------------------
  -- B) Insert missing LOI rows for NCC zones
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
    WHERE z.organization_id = %L::uuid
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
  $sql$, v_loi_addr_col, v_ncc_org_id::text, v_loi_addr_col);

  -- -------------------------------------------------------------------------
  -- C) Backfill optional LOI metadata when available
  -- -------------------------------------------------------------------------
  IF v_has_loi_name THEN
    EXECUTE format($sql$
      UPDATE public.locations_of_interest l
      SET name = coalesce(l.name, s.name)
      FROM public.client_sites s
      WHERE l.organization_id = s.organization_id
        AND s.organization_id = %L::uuid
        AND lower(l.%I) = lower(
          CASE
            WHEN s.address IS NOT NULL AND btrim(s.address) <> '' THEN btrim(s.address)
            ELSE 'Client Site: ' || btrim(s.name)
          END
        )
    $sql$, v_ncc_org_id::text, v_loi_addr_col);

    EXECUTE format($sql$
      UPDATE public.locations_of_interest l
      SET name = coalesce(l.name, z.name)
      FROM public.zones z
      WHERE l.organization_id = z.organization_id
        AND z.organization_id = %L::uuid
        AND lower(l.%I) = lower(
          CASE
            WHEN z.name IS NOT NULL AND btrim(z.name) <> '' THEN 'Zone: ' || btrim(z.name)
            ELSE 'Zone: ' || z.id::text
          END
        )
    $sql$, v_ncc_org_id::text, v_loi_addr_col);
  END IF;

  IF v_has_loi_kind THEN
    EXECUTE format($sql$
      UPDATE public.locations_of_interest l
      SET loi_kind = CASE
        WHEN lower(coalesce(z.zone_type, '')) IN ('freedom_camp', 'freedom_camping', 'freedom_camping_zone', 'camping')
          THEN 'freedom_camp'
        ELSE coalesce(l.loi_kind, 'poi')
      END
      FROM public.zones z
      WHERE l.organization_id = z.organization_id
        AND z.organization_id = %L::uuid
        AND lower(l.%I) = lower(
          CASE
            WHEN z.name IS NOT NULL AND btrim(z.name) <> '' THEN 'Zone: ' || btrim(z.name)
            ELSE 'Zone: ' || z.id::text
          END
        )
    $sql$, v_ncc_org_id::text, v_loi_addr_col);
  END IF;

  IF v_has_loi_gps THEN
    EXECUTE format($sql$
      UPDATE public.locations_of_interest l
      SET gps_lat = s.gps_lat,
          gps_lng = s.gps_lng
      FROM public.client_sites s
      WHERE l.organization_id = s.organization_id
        AND s.organization_id = %L::uuid
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
    $sql$, v_ncc_org_id::text, v_loi_addr_col);

    EXECUTE format($sql$
      UPDATE public.locations_of_interest l
      SET gps_lat = z.location_lat,
          gps_lng = z.location_lng
      FROM public.zones z
      WHERE l.organization_id = z.organization_id
        AND z.organization_id = %L::uuid
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
    $sql$, v_ncc_org_id::text, v_loi_addr_col);
  END IF;

  -- -------------------------------------------------------------------------
  -- D) Ensure source rows link back to LOI
  -- -------------------------------------------------------------------------
  EXECUTE format($sql$
    UPDATE public.client_sites s
    SET loi_id = l.id
    FROM public.locations_of_interest l
    WHERE s.organization_id = %L::uuid
      AND s.loi_id IS NULL
      AND l.organization_id = s.organization_id
      AND lower(l.%I) = lower(
        CASE
          WHEN s.address IS NOT NULL AND btrim(s.address) <> '' THEN btrim(s.address)
          ELSE 'Client Site: ' || btrim(s.name)
        END
      )
  $sql$, v_ncc_org_id::text, v_loi_addr_col);

  EXECUTE format($sql$
    UPDATE public.zones z
    SET loi_id = l.id
    FROM public.locations_of_interest l
    WHERE z.organization_id = %L::uuid
      AND z.loi_id IS NULL
      AND l.organization_id = z.organization_id
      AND lower(l.%I) = lower(
        CASE
          WHEN z.name IS NOT NULL AND btrim(z.name) <> '' THEN 'Zone: ' || btrim(z.name)
          ELSE 'Zone: ' || z.id::text
        END
      )
  $sql$, v_ncc_org_id::text, v_loi_addr_col);
END;
$$;
