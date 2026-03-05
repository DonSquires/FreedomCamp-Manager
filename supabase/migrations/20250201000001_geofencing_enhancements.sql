-- Geofencing Enhancements
-- 1. Ensure all zones have geofencing capability
-- 2. Create "Other Location" system zone for out-of-bounds observations
-- 3. Update RLS policies for zone management
-- 4. Add helper functions for geofence detection

-- Add comment to geometry column
COMMENT ON COLUMN public.zones.geometry IS 'GeoJSON geometry for geofence boundary - supports Polygon or Point (with radius)';

-- Ensure all active zones either have geometry or center point
DO $$
DECLARE
  zone_record RECORD;
BEGIN
  FOR zone_record IN 
    SELECT id, name, organization_id 
    FROM public.zones 
    WHERE is_active = true 
      AND geometry IS NULL 
      AND (location_lat IS NULL OR location_lng IS NULL)
  LOOP
    RAISE WARNING 'Zone "%" (%) has no geofence or center point configured', zone_record.name, zone_record.id;
  END LOOP;
END $$;

-- Create "Other Location" system zone for each organization (if not exists)
DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM public.organizations WHERE is_active = true
  LOOP
    -- Check if "Other Location" zone already exists for this org
    IF NOT EXISTS (
      SELECT 1 FROM public.zones 
      WHERE organization_id = org_record.id 
        AND name = 'Other Location'
    ) THEN
      INSERT INTO public.zones (
        organization_id,
        name,
        description,
        self_contained_required,
        nights_per_month,
        max_consecutive_nights,
        day_visit_only,
        is_active,
        location_lat,
        location_lng,
        geometry
      ) VALUES (
        org_record.id,
        'Other Location',
        'System zone for observations recorded outside geofenced areas',
        true,
        28,
        3,
        false,
        true,
        NULL, -- No center point
        NULL,
        NULL  -- No geofence
      );
      
      RAISE NOTICE 'Created "Other Location" zone for organization %', org_record.id;
    END IF;
  END LOOP;
END $$;

-- Function to find zone by GPS coordinates (improved version)
CREATE OR REPLACE FUNCTION public.find_zone_by_gps(
  p_latitude NUMERIC,
  p_longitude NUMERIC,
  p_organization_id UUID DEFAULT NULL
)
RETURNS TABLE (
  zone_id UUID,
  zone_name TEXT,
  match_type TEXT,  -- 'geofence' | 'proximity' | 'other_location'
  distance_meters INTEGER
) LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_point GEOMETRY;
  v_zone_record RECORD;
  v_min_distance INTEGER := 999999;
  v_closest_zone UUID;
  v_closest_zone_name TEXT;
  v_other_location_id UUID;
BEGIN
  -- Create point from coordinates
  v_point := ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326);

  -- First: Try exact geofence match (polygon)
  FOR v_zone_record IN
    SELECT 
      z.id,
      z.name,
      z.organization_id,
      z.geometry
    FROM public.zones z
    WHERE z.is_active = true
      AND z.geometry IS NOT NULL
      AND z.geometry->>'type' = 'Polygon'
      AND (p_organization_id IS NULL OR z.organization_id = p_organization_id)
      AND z.name != 'Other Location'  -- Exclude Other Location from geofence matching
  LOOP
    -- Parse GeoJSON polygon and check if point is inside
    DECLARE
      v_coords JSONB;
      v_polygon GEOMETRY;
    BEGIN
      v_coords := v_zone_record.geometry->'coordinates'->0;
      
      -- Build WKT polygon string
      DECLARE
        v_wkt TEXT := 'POLYGON((';
        v_coord JSONB;
      BEGIN
        FOR v_coord IN SELECT * FROM jsonb_array_elements(v_coords)
        LOOP
          IF v_wkt != 'POLYGON((' THEN
            v_wkt := v_wkt || ',';
          END IF;
          v_wkt := v_wkt || (v_coord->>0) || ' ' || (v_coord->>1);
        END LOOP;
        v_wkt := v_wkt || '))';
        
        v_polygon := ST_GeomFromText(v_wkt, 4326);
        
        IF ST_Contains(v_polygon, v_point) THEN
          -- Point is inside this geofence
          zone_id := v_zone_record.id;
          zone_name := v_zone_record.name;
          match_type := 'geofence';
          distance_meters := 0;
          RETURN NEXT;
          RETURN; -- Found exact match, exit
        END IF;
      END;
    END;
  END LOOP;

  -- Second: Try circle geofence match
  FOR v_zone_record IN
    SELECT 
      z.id,
      z.name,
      z.organization_id,
      z.geometry
    FROM public.zones z
    WHERE z.is_active = true
      AND z.geometry IS NOT NULL
      AND z.geometry->>'type' = 'Point'
      AND (p_organization_id IS NULL OR z.organization_id = p_organization_id)
      AND z.name != 'Other Location'
  LOOP
    DECLARE
      v_center_lng NUMERIC := (v_zone_record.geometry->'coordinates'->>0)::NUMERIC;
      v_center_lat NUMERIC := (v_zone_record.geometry->'coordinates'->>1)::NUMERIC;
      v_radius INTEGER := (v_zone_record.geometry->>'radius')::INTEGER;
      v_center_point GEOMETRY;
      v_distance NUMERIC;
    BEGIN
      v_center_point := ST_SetSRID(ST_MakePoint(v_center_lng, v_center_lat), 4326);
      v_distance := ST_Distance(v_center_point::geography, v_point::geography);
      
      IF v_distance <= v_radius THEN
        -- Point is inside circle
        zone_id := v_zone_record.id;
        zone_name := v_zone_record.name;
        match_type := 'geofence';
        distance_meters := ROUND(v_distance)::INTEGER;
        RETURN NEXT;
        RETURN; -- Found exact match, exit
      END IF;
    END;
  END LOOP;

  -- Third: Try proximity to zone center (500m threshold)
  FOR v_zone_record IN
    SELECT 
      z.id,
      z.name,
      z.organization_id,
      z.location_lat,
      z.location_lng
    FROM public.zones z
    WHERE z.is_active = true
      AND z.location_lat IS NOT NULL
      AND z.location_lng IS NOT NULL
      AND (p_organization_id IS NULL OR z.organization_id = p_organization_id)
      AND z.name != 'Other Location'
  LOOP
    DECLARE
      v_zone_point GEOMETRY;
      v_distance NUMERIC;
    BEGIN
      v_zone_point := ST_SetSRID(
        ST_MakePoint(v_zone_record.location_lng, v_zone_record.location_lat), 
        4326
      );
      v_distance := ST_Distance(v_zone_point::geography, v_point::geography);
      
      IF v_distance < v_min_distance THEN
        v_min_distance := ROUND(v_distance)::INTEGER;
        v_closest_zone := v_zone_record.id;
        v_closest_zone_name := v_zone_record.name;
      END IF;
    END;
  END LOOP;

  -- If found within 500m, return as proximity match
  IF v_closest_zone IS NOT NULL AND v_min_distance <= 500 THEN
    zone_id := v_closest_zone;
    zone_name := v_closest_zone_name;
    match_type := 'proximity';
    distance_meters := v_min_distance;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Fourth: No match - return "Other Location" for this organization
  IF p_organization_id IS NOT NULL THEN
    SELECT z.id, z.name 
    INTO v_other_location_id, v_closest_zone_name
    FROM public.zones z
    WHERE z.organization_id = p_organization_id
      AND z.name = 'Other Location'
      AND z.is_active = true
    LIMIT 1;
    
    IF v_other_location_id IS NOT NULL THEN
      zone_id := v_other_location_id;
      zone_name := v_closest_zone_name;
      match_type := 'other_location';
      distance_meters := NULL;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- No zone found at all
  RETURN;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.find_zone_by_gps TO authenticated, anon;

COMMENT ON FUNCTION public.find_zone_by_gps IS 'Find zone by GPS coordinates using geofence matching, proximity, or Other Location fallback';

-- Update RLS policies for zones to allow admins to manage their org zones
-- Masters can manage all zones

-- Drop existing policies if they exist
DROP POLICY IF EXISTS admins_manage_zones ON public.zones;
DROP POLICY IF EXISTS users_view_zones ON public.zones;
DROP POLICY IF EXISTS super_delete_zones ON public.zones;

-- Recreate with correct permissions
CREATE POLICY admins_create_zones ON public.zones
  FOR INSERT
  WITH CHECK (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin', 'master'])) AND
    ((get_user_role(auth.uid()) = 'master') OR (organization_id = get_user_organization_id(auth.uid())))
  );

CREATE POLICY admins_update_zones ON public.zones
  FOR UPDATE
  USING (
    (get_user_role(auth.uid()) = ANY (ARRAY['admin', 'master'])) AND
    ((get_user_role(auth.uid()) = 'master') OR (organization_id = get_user_organization_id(auth.uid())))
  );

CREATE POLICY users_view_zones ON public.zones
  FOR SELECT
  USING (
    ((get_user_role(auth.uid()) = 'master') OR (organization_id = get_user_organization_id(auth.uid())))
  );

CREATE POLICY super_delete_zones ON public.zones
  FOR DELETE
  USING (
    (EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND email = 'don.squire@firstsecurity.co.nz'
        AND permissions @> '["super_delete"]'::jsonb
    ))
  );

-- Create index for faster geometry searches
CREATE INDEX IF NOT EXISTS idx_zones_geometry ON public.zones USING GIN (geometry);
CREATE INDEX IF NOT EXISTS idx_zones_location ON public.zones(location_lat, location_lng) WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL;

-- Add check to ensure "Other Location" zones cannot be deleted
CREATE OR REPLACE FUNCTION prevent_other_location_deletion()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.name = 'Other Location' THEN
    RAISE EXCEPTION 'Cannot delete "Other Location" system zone';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_other_location_deletion_trigger ON public.zones;
CREATE TRIGGER prevent_other_location_deletion_trigger
  BEFORE DELETE ON public.zones
  FOR EACH ROW
  EXECUTE FUNCTION prevent_other_location_deletion();

-- Verify scheduled zone correction job still exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'daily-gps-zone-correction'
  ) THEN
    RAISE WARNING 'Scheduled zone correction job not found! Run 20250124_schedule_zone_correction.sql to create it.';
  ELSE
    RAISE NOTICE 'Scheduled zone correction job verified - runs daily at 3am NZ time';
  END IF;
END $$;
