-- =============================================================================
-- Enforce Zone -> LOI Linkage
-- Date: 2026-07-12
-- =============================================================================
-- Purpose
--   Ensure every active zone is represented by a canonical LOI record and
--   linked via zones.loi_id. This makes zone lookup and CRM/POI/LOI/VOI flows
--   converge on LOI as the location source of truth.
--
-- Notes
--   - Additive and backward-compatible.
--   - Handles LOI schema variants where address may be `display_address`
--     or `address_full`.
-- =============================================================================

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS loi_id UUID
    REFERENCES public.locations_of_interest(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_zones_loi_id
  ON public.zones(loi_id)
  WHERE loi_id IS NOT NULL;

COMMENT ON COLUMN public.zones.loi_id IS
  'Canonical LOI record for this zone. Active zones should always resolve to LOI.';

CREATE OR REPLACE FUNCTION public.ensure_zone_loi_linkage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_addr_col TEXT;
  v_zone_label TEXT;
  v_loi_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations_of_interest'
      AND column_name = 'display_address'
  ) THEN
    v_addr_col := 'display_address';
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'locations_of_interest'
      AND column_name = 'address_full'
  ) THEN
    v_addr_col := 'address_full';
  ELSE
    RAISE EXCEPTION 'locations_of_interest requires display_address or address_full';
  END IF;

  v_zone_label := CASE
    WHEN NEW.name IS NOT NULL AND btrim(NEW.name) <> '' THEN 'Zone: ' || btrim(NEW.name)
    ELSE 'Zone: ' || NEW.id::text
  END;

  IF NEW.loi_id IS NULL THEN
    EXECUTE format(
      'SELECT id
       FROM public.locations_of_interest
       WHERE organization_id = $1
         AND lower(coalesce(%I, '''')) = lower($2)
       ORDER BY created_at ASC
       LIMIT 1',
      v_addr_col
    )
    INTO v_loi_id
    USING NEW.organization_id, v_zone_label;

    IF v_loi_id IS NULL THEN
      EXECUTE format(
        'INSERT INTO public.locations_of_interest (
           organization_id,
           name,
           loi_kind,
           %I,
           gps_lat,
           gps_lng,
           geo_zone_ids,
           geocoder_source,
           geocoder_confidence
         ) VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           $6,
           CASE WHEN $7 IS NULL THEN ''{}''::uuid[] ELSE ARRAY[$7]::uuid[] END,
           ''zone_backfill'',
           0.8
         )
         RETURNING id',
        v_addr_col
      )
      INTO v_loi_id
      USING NEW.organization_id,
            NEW.name,
            CASE
              WHEN lower(coalesce(NEW.zone_type, '')) IN ('freedom_camp', 'freedom_camping', 'freedom_camping_zone', 'camping')
                THEN 'freedom_camp'
              ELSE 'poi'
            END,
            v_zone_label,
            NEW.location_lat,
            NEW.location_lng,
            NEW.geo_zone_id;
    END IF;

    NEW.loi_id := v_loi_id;
  END IF;

  IF NEW.loi_id IS NOT NULL THEN
    PERFORM 1
    FROM public.locations_of_interest l
    WHERE l.id = NEW.loi_id
      AND l.organization_id = NEW.organization_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'zones.loi_id (%) must belong to same organization (%)', NEW.loi_id, NEW.organization_id;
    END IF;

    UPDATE public.locations_of_interest l
    SET
      name = COALESCE(l.name, NEW.name),
      gps_lat = COALESCE(l.gps_lat, NEW.location_lat),
      gps_lng = COALESCE(l.gps_lng, NEW.location_lng),
      geo_zone_ids = CASE
        WHEN NEW.geo_zone_id IS NULL THEN l.geo_zone_ids
        ELSE (
          SELECT ARRAY(
            SELECT DISTINCT x
            FROM unnest(COALESCE(l.geo_zone_ids, '{}'::uuid[]) || ARRAY[NEW.geo_zone_id]::uuid[]) AS x
          )
        )
      END
    WHERE l.id = NEW.loi_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zones_ensure_loi_linkage ON public.zones;
CREATE TRIGGER trg_zones_ensure_loi_linkage
  BEFORE INSERT OR UPDATE OF organization_id, name, zone_type, location_lat, location_lng, geo_zone_id, loi_id
  ON public.zones
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_zone_loi_linkage();

-- Backfill existing zones that are missing LOI links.
UPDATE public.zones
SET name = name
WHERE loi_id IS NULL;

-- Enforce active zones must have an LOI link. Kept NOT VALID initially to avoid
-- blocking deployment if legacy rows remain; validate once org cleanup is complete.
ALTER TABLE public.zones
  DROP CONSTRAINT IF EXISTS zones_active_requires_loi;

ALTER TABLE public.zones
  ADD CONSTRAINT zones_active_requires_loi
  CHECK (COALESCE(is_active, true) = false OR loi_id IS NOT NULL)
  NOT VALID;
