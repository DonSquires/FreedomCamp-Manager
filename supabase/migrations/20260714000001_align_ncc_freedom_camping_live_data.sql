-- =============================================================================
-- Align NCC Freedom Camping Live Data with Canonical Org IDs and New Platform
-- Date: 2026-07-14
--
-- Purpose:
-- 1) Reconcile synthetic IDs from early seed scripts to canonical organization IDs
-- 2) Ensure First Security -> Nelson/Queenstown branch -> NCC/Downer hierarchy
-- 3) Backfill NCC freedom-camping zones + geo_zones + client_sites for UI/UX testing
-- 4) Keep migration idempotent and safe to re-run
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_fs_root_id         UUID := 'b8566654-4b1b-4cea-b55e-73791ec418ea';
  v_fs_nelson_id       UUID := '11111111-0001-0001-0001-000000000002';
  v_fs_queenstown_id   UUID := '11111111-0001-0001-0001-000000000003';
  v_ncc_id             UUID := 'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993';
  v_downer_linz_id     UUID := '57804ca8-ecc2-4b0b-91a7-3b54ad513191';

  -- old synthetic IDs from early seed
  v_seed_fs_root_old   UUID := '11111111-0001-0001-0001-000000000001';
  v_seed_ncc_old       UUID := '11111111-0001-0001-0001-000000000010';
  v_seed_downer_old    UUID := '11111111-0001-0001-0001-000000000011';

  r record;
BEGIN
  -- ---------------------------------------------------------------------------
  -- A) Ensure canonical organizations exist and hierarchy is correct
  -- ---------------------------------------------------------------------------
  INSERT INTO public.organizations
    (id, name, organization_type, organization_level, parent_organization_id,
     enforcement_workflow, is_active)
  VALUES
    (v_fs_root_id, 'First Security', 'security_company', 1, NULL, 'hybrid', true)
  ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      organization_type = EXCLUDED.organization_type,
      organization_level = EXCLUDED.organization_level,
      enforcement_workflow = COALESCE(public.organizations.enforcement_workflow, EXCLUDED.enforcement_workflow),
      is_active = true,
      updated_at = now();

  INSERT INTO public.organizations
    (id, name, organization_type, organization_level, parent_organization_id,
     address, enforcement_workflow, is_active)
  VALUES
    (v_fs_nelson_id, 'First Security Nelson', 'service_provider', 2,
     v_fs_root_id, 'Nelson, Tasman, New Zealand', 'hybrid', true),
    (v_fs_queenstown_id, 'First Security Queenstown', 'service_provider', 2,
     v_fs_root_id, 'Queenstown, Otago, New Zealand', 'hybrid', true)
  ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      organization_type = EXCLUDED.organization_type,
      organization_level = EXCLUDED.organization_level,
      parent_organization_id = EXCLUDED.parent_organization_id,
      address = COALESCE(public.organizations.address, EXCLUDED.address),
      is_active = true,
      updated_at = now();

  INSERT INTO public.organizations
    (id, name, organization_type, organization_level, parent_organization_id,
     address, enforcement_workflow, is_active)
  VALUES
    (v_ncc_id, 'Nelson City Council', 'client', 3,
     v_fs_nelson_id, 'Civic House, 110 Trafalgar Street, Nelson 7010', 'admin_first', true),
    (v_downer_linz_id, 'Downer / LINZ', 'client', 3,
     v_fs_queenstown_id, 'Queenstown, Otago, New Zealand', 'admin_first', true)
  ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      organization_type = EXCLUDED.organization_type,
      organization_level = EXCLUDED.organization_level,
      parent_organization_id = EXCLUDED.parent_organization_id,
      address = COALESCE(public.organizations.address, EXCLUDED.address),
      is_active = true,
      updated_at = now();

  -- ---------------------------------------------------------------------------
  -- B) Build merge map for known duplicates/synthetic IDs and same-name variants
  -- ---------------------------------------------------------------------------
  CREATE TEMP TABLE org_merge_map (
    old_id UUID PRIMARY KEY,
    new_id UUID NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO org_merge_map (old_id, new_id)
  SELECT old_id, new_id
  FROM (
    VALUES
      (v_seed_fs_root_old, v_fs_root_id),
      (v_seed_ncc_old, v_ncc_id),
      (v_seed_downer_old, v_downer_linz_id)
  ) s(old_id, new_id)
  WHERE old_id <> new_id
    AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = s.old_id)
    AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = s.new_id)
  ON CONFLICT (old_id) DO NOTHING;

  INSERT INTO org_merge_map (old_id, new_id)
  SELECT o.id, v_fs_nelson_id
  FROM public.organizations o
  WHERE lower(o.name) IN ('first security - nelson', 'first security nelson')
    AND o.id <> v_fs_nelson_id
  ON CONFLICT (old_id) DO NOTHING;

  INSERT INTO org_merge_map (old_id, new_id)
  SELECT o.id, v_fs_queenstown_id
  FROM public.organizations o
  WHERE lower(o.name) IN ('first security - queenstown', 'first security queenstown')
    AND o.id <> v_fs_queenstown_id
  ON CONFLICT (old_id) DO NOTHING;

  INSERT INTO org_merge_map (old_id, new_id)
  SELECT o.id, v_ncc_id
  FROM public.organizations o
  WHERE lower(o.name) IN ('nelson city council', 'nelson')
    AND o.id <> v_ncc_id
    AND o.organization_type = 'client'
  ON CONFLICT (old_id) DO NOTHING;

  INSERT INTO org_merge_map (old_id, new_id)
  SELECT o.id, v_downer_linz_id
  FROM public.organizations o
  WHERE lower(o.name) IN ('downer / linz', 'downer/linz')
    AND o.id <> v_downer_linz_id
  ON CONFLICT (old_id) DO NOTHING;

  -- ---------------------------------------------------------------------------
  -- C) Repoint all organization FKs and array references
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT
      ns.nspname AS schema_name,
      cls.relname AS table_name,
      att.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON TRUE
    JOIN pg_attribute att ON att.attrelid = cls.oid AND att.attnum = ck.attnum
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.organizations'::regclass
      AND ns.nspname = 'public'
  LOOP
    EXECUTE format(
      'UPDATE %I.%I t
         SET %I = m.new_id
        FROM org_merge_map m
       WHERE t.%I = m.old_id',
      r.schema_name,
      r.table_name,
      r.column_name,
      r.column_name
    );
  END LOOP;

  UPDATE public.organizations o
  SET parent_organization_id = m.new_id
  FROM org_merge_map m
  WHERE o.parent_organization_id = m.old_id;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
      AND column_name = 'authorized_work_locations'
  ) THEN
    UPDATE public.user_profiles up
    SET authorized_work_locations = (
      SELECT COALESCE(array_agg(DISTINCT COALESCE(m.new_id, x.val)), ARRAY[]::UUID[])
      FROM unnest(COALESCE(up.authorized_work_locations, ARRAY[]::UUID[])) AS x(val)
      LEFT JOIN org_merge_map m ON m.old_id = x.val
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
      AND column_name = 'organization_ids'
  ) THEN
    EXECUTE $sql$
      UPDATE public.user_profiles up
      SET organization_ids = (
        SELECT COALESCE(array_agg(DISTINCT COALESCE(m.new_id, x.val)), ARRAY[]::UUID[])
        FROM unnest(COALESCE(up.organization_ids, ARRAY[]::UUID[])) AS x(val)
        LEFT JOIN org_merge_map m ON m.old_id = x.val
      )
    $sql$;
  END IF;

  UPDATE public.organizations o
  SET is_active = false,
      updated_at = now(),
      name = CASE
        WHEN o.name LIKE '% [MERGED %]%' THEN o.name
        ELSE o.name || ' [MERGED ' || to_char(now(), 'YYYY-MM-DD') || ']'
      END
  FROM org_merge_map m
  WHERE o.id = m.old_id;

  -- ---------------------------------------------------------------------------
  -- D) Ensure Nelson dispatch zones used by patrol/noise imports exist
  -- ---------------------------------------------------------------------------
  INSERT INTO public.zones
    (id, organization_id, name, description, is_active, location_lat, location_lng)
  VALUES
    ('22222222-0001-0001-0582-000000000001', v_fs_nelson_id, 'Nelson Zone 582', 'Nelson patrol/noise zone 582.', true, -41.2706, 173.2840),
    ('22222222-0001-0001-0584-000000000001', v_fs_nelson_id, 'Nelson Zone 584', 'Nelson patrol/noise zone 584.', true, -41.2706, 173.2840),
    ('22222222-0001-0001-0585-000000000001', v_fs_nelson_id, 'Nelson Zone 585', 'Nelson patrol/noise zone 585.', true, -41.2706, 173.2840),
    ('22222222-0001-0001-0586-000000000001', v_fs_nelson_id, 'Nelson Zone 586', 'Nelson patrol/noise zone 586.', true, -41.2706, 173.2840),
    ('22222222-0001-0001-0587-000000000001', v_fs_nelson_id, 'Nelson Zone 587', 'Nelson patrol/noise zone 587.', true, -41.2706, 173.2840)
  ON CONFLICT (id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      is_active = true,
      updated_at = now();

  -- ---------------------------------------------------------------------------
  -- E) Add NCC freedom-camping geo_zones for live UI/pipeline validation
  -- ---------------------------------------------------------------------------
  INSERT INTO public.geo_zones
    (id, organization_id, name, short_code, description,
     geometry_geojson, center_lat, center_lng,
     land_managing_agency, jurisdiction_org_id, bylaw_reference,
     task_types, color, icon, is_active)
  VALUES
    (
      '44444444-0001-0001-0001-000000000001',
      v_ncc_id,
      'Washington Valley Reserve Freedom Camping Area',
      'NCC-FC-WASH',
      'Designated freedom camping area for NCC operational checks.',
      '{"type":"Polygon","coordinates":[[[173.2680,-41.2845],[173.2720,-41.2845],[173.2720,-41.2815],[173.2680,-41.2815],[173.2680,-41.2845]]]}',
      -41.2830,
      173.2700,
      'council',
      v_ncc_id,
      'Nelson City Council Freedom Camping Bylaw 2015',
      ARRAY['freedom_camping','noise','bylaw_enforcement'],
      '#16A34A',
      'tent',
      true
    ),
    (
      '44444444-0001-0001-0001-000000000002',
      v_ncc_id,
      'Tahunanui Beach Freedom Camping Area',
      'NCC-FC-TAHU',
      'Tahunanui beachfront freedom-camping enforcement area.',
      '{"type":"Polygon","coordinates":[[[173.2240,-41.3040],[173.2320,-41.3040],[173.2320,-41.2985],[173.2240,-41.2985],[173.2240,-41.3040]]]}',
      -41.3010,
      173.2280,
      'council',
      v_ncc_id,
      'Nelson City Council Freedom Camping Bylaw 2015',
      ARRAY['freedom_camping','noise','bylaw_enforcement'],
      '#16A34A',
      'tent',
      true
    ),
    (
      '44444444-0001-0001-0001-000000000003',
      v_ncc_id,
      'Annesbrook Drive Campsite Area',
      'NCC-FC-ANNE',
      'Annesbrook corridor campsite enforcement area.',
      '{"type":"Polygon","coordinates":[[[173.2145,-41.3015],[173.2220,-41.3015],[173.2220,-41.2965],[173.2145,-41.2965],[173.2145,-41.3015]]]}',
      -41.2992,
      173.2183,
      'council',
      v_ncc_id,
      'Nelson City Council Freedom Camping Bylaw 2015',
      ARRAY['freedom_camping','noise','bylaw_enforcement'],
      '#16A34A',
      'tent',
      true
    )
  ON CONFLICT (id) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      name = EXCLUDED.name,
      short_code = EXCLUDED.short_code,
      description = EXCLUDED.description,
      geometry_geojson = EXCLUDED.geometry_geojson,
      center_lat = EXCLUDED.center_lat,
      center_lng = EXCLUDED.center_lng,
      land_managing_agency = EXCLUDED.land_managing_agency,
      jurisdiction_org_id = EXCLUDED.jurisdiction_org_id,
      bylaw_reference = EXCLUDED.bylaw_reference,
      task_types = EXCLUDED.task_types,
      color = EXCLUDED.color,
      icon = EXCLUDED.icon,
      is_active = true,
      updated_at = now();

  -- ---------------------------------------------------------------------------
  -- F) Bridge legacy zones -> geo_zones so old/new UI paths both work
  -- ---------------------------------------------------------------------------
  UPDATE public.zones
  SET geo_zone_id = '44444444-0001-0001-0001-000000000001',
      zone_kind = 'both',
      zone_type = COALESCE(zone_type, 'freedom_camping'),
      geometry = '{"type":"Polygon","coordinates":[[[173.2680,-41.2845],[173.2720,-41.2845],[173.2720,-41.2815],[173.2680,-41.2815],[173.2680,-41.2845]]]}'::jsonb,
      location_lat = COALESCE(location_lat, -41.2830),
      location_lng = COALESCE(location_lng, 173.2700),
      updated_at = now()
  WHERE id = '22222222-0001-0001-0585-000000000001';

  UPDATE public.zones
  SET geo_zone_id = '44444444-0001-0001-0001-000000000002',
      zone_kind = 'both',
      zone_type = COALESCE(zone_type, 'freedom_camping'),
      geometry = '{"type":"Polygon","coordinates":[[[173.2240,-41.3040],[173.2320,-41.3040],[173.2320,-41.2985],[173.2240,-41.2985],[173.2240,-41.3040]]]}'::jsonb,
      location_lat = COALESCE(location_lat, -41.3010),
      location_lng = COALESCE(location_lng, 173.2280),
      updated_at = now()
  WHERE id = '22222222-0001-0001-0584-000000000001';

  UPDATE public.zones
  SET geo_zone_id = '44444444-0001-0001-0001-000000000003',
      zone_kind = 'both',
      zone_type = COALESCE(zone_type, 'freedom_camping'),
      geometry = '{"type":"Polygon","coordinates":[[[173.2145,-41.3015],[173.2220,-41.3015],[173.2220,-41.2965],[173.2145,-41.2965],[173.2145,-41.3015]]]}'::jsonb,
      location_lat = COALESCE(location_lat, -41.2992),
      location_lng = COALESCE(location_lng, 173.2183),
      updated_at = now()
  WHERE id = '22222222-0001-0001-0587-000000000001';

  -- ---------------------------------------------------------------------------
  -- G) Ensure NCC client_sites exist for freedom-camping + service-map locations
  -- ---------------------------------------------------------------------------
  INSERT INTO public.client_sites
    (organization_id, zone_id, name, site_code, site_type,
     address, city, gps_lat, gps_lng, notes, is_active)
  SELECT
    v_ncc_id,
    s.zone_id,
    s.name,
    s.site_code,
    s.site_type,
    s.address,
    s.city,
    s.gps_lat,
    s.gps_lng,
    s.notes,
    true
  FROM (
    VALUES
      ('22222222-0001-0001-0585-000000000001'::UUID, 'Washington Valley Reserve', NULL, 'freedom_camping', 'Washington Valley, Nelson', 'Nelson', -41.2830::DOUBLE PRECISION, 173.2700::DOUBLE PRECISION, 'NCC freedom-camping designated area for patrol checks.'),
      ('22222222-0001-0001-0584-000000000001'::UUID, 'Tahunanui Beach', NULL, 'freedom_camping', 'Tahunanui Beach, Nelson', 'Nelson', -41.3010::DOUBLE PRECISION, 173.2280::DOUBLE PRECISION, 'NCC freedom-camping designated area near beachfront.'),
      ('22222222-0001-0001-0587-000000000001'::UUID, 'Annesbrook Drive Campsite', NULL, 'freedom_camping', 'Annesbrook Drive, Nelson', 'Nelson', -41.2992::DOUBLE PRECISION, 173.2183::DOUBLE PRECISION, 'NCC freedom-camping and bylaw monitoring corridor.'),
      ('22222222-0001-0001-0585-000000000001'::UUID, 'Founders Park', NULL, 'general', '87 Atawhai Drive, Nelson', 'Nelson', -41.2630::DOUBLE PRECISION, 173.2987::DOUBLE PRECISION, 'Ad hoc security breach/callout location per NCC service map.'),
      ('22222222-0001-0001-0585-000000000001'::UUID, '27 Bridge Street', NULL, 'general', '27 Bridge Street, Nelson', 'Nelson', -41.2720::DOUBLE PRECISION, 173.2860::DOUBLE PRECISION, 'Ad hoc security breach/callout location per NCC service map.'),
      ('22222222-0001-0001-0585-000000000001'::UUID, 'Wakapuaka Crematorium', NULL, 'general', 'Wakapuaka Road, Nelson', 'Nelson', -41.2310::DOUBLE PRECISION, 173.3300::DOUBLE PRECISION, 'Ad hoc security breach/callout location per NCC service map.'),
      ('22222222-0001-0001-0585-000000000001'::UUID, 'Lions Playground Toilet', NULL, 'general', 'Tahunanui Reserve, Nelson', 'Nelson', -41.3008::DOUBLE PRECISION, 173.2300::DOUBLE PRECISION, 'Tahunanui Reserve lock/unlock service location.'),
      ('22222222-0001-0001-0585-000000000001'::UUID, 'Sports Field Toilet/Changing Shed', NULL, 'general', 'Tahunanui Reserve, Nelson', 'Nelson', -41.3013::DOUBLE PRECISION, 173.2290::DOUBLE PRECISION, 'Tahunanui Reserve lock/unlock service location.'),
      ('22222222-0001-0001-0585-000000000001'::UUID, 'Beach Cafe Toilet', NULL, 'general', 'Tahunanui Reserve, Nelson', 'Nelson', -41.3002::DOUBLE PRECISION, 173.2311::DOUBLE PRECISION, 'Tahunanui Reserve lock/unlock service location.'),
      ('22222222-0001-0001-0585-000000000001'::UUID, 'BMX Track/Modellers Playground Toilet', NULL, 'general', 'Tahunanui Reserve, Nelson', 'Nelson', -41.3021::DOUBLE PRECISION, 173.2278::DOUBLE PRECISION, 'Tahunanui Reserve lock/unlock service location.'),
      ('22222222-0001-0001-0585-000000000001'::UUID, 'Rear Roller Skating Rink Toilet', NULL, 'general', 'Tahunanui Reserve, Nelson', 'Nelson', -41.3018::DOUBLE PRECISION, 173.2288::DOUBLE PRECISION, 'Tahunanui Reserve lock/unlock service location.')
  ) AS s(zone_id, name, site_code, site_type, address, city, gps_lat, gps_lng, notes)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.client_sites cs
    WHERE cs.organization_id = v_ncc_id
      AND lower(cs.name) = lower(s.name)
  );

  RAISE NOTICE 'NCC freedom-camping alignment complete. root=%, nelson=%, ncc=%', v_fs_root_id, v_fs_nelson_id, v_ncc_id;
END $$;

COMMIT;
