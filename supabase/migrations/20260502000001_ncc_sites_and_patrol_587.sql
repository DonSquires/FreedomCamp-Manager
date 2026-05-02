-- =============================================================================
-- NCC (Nelson City Council) — Client Sites, Patrol Route 587, Dispatch History
--
-- Source: January 2026 patrol dispatch export (Iron Eagle Security / OnSpace AI)
-- All sites owned by Nelson City Council, serviced under Iron Eagle Security.
--
-- Sites seeded with GPS coordinates, geofence radius, default charge rates,
-- and purchase order references extracted from the dispatch data.
-- =============================================================================

-- Ensure site_code is unique per organisation (idempotent)
ALTER TABLE public.client_sites
  ADD CONSTRAINT IF NOT EXISTS uq_client_sites_org_site_code
  UNIQUE (organization_id, site_code);

DO $$
DECLARE
  v_ncc_org_id      UUID;

  -- Site IDs
  v_nightingale     UUID;
  v_stoke_lib       UUID;
  v_greenmeadows    UUID;
  v_broadgreen      UUID;
  v_isel_house      UUID;
  v_monaco_gate     UUID;
  v_marsden_cem     UUID;
  v_trafalgar       UUID;
  v_wakapuaka_cem   UUID;
  v_saxton          UUID;
  v_nelson_lib      UUID;
  v_chinese_gardens UUID;
  v_anchor          UUID;
  v_ex4seasons      UUID;
  v_the_refinery    UUID;
  v_neale_park      UUID;
  v_trafalgar_ctr   UUID;
  v_montgomery      UUID;
  v_buxton          UUID;
  v_ncc_civic       UUID;
  v_miller_acre     UUID;
  v_pioneer_park    UUID;
  v_botanics        UUID;

  v_route_id        UUID;

BEGIN

  -- ── 1. Resolve NCC Org ──────────────────────────────────────────────────────
  SELECT id INTO v_ncc_org_id
  FROM public.organizations
  WHERE name ILIKE '%Nelson City Council%'
  LIMIT 1;

  IF v_ncc_org_id IS NULL THEN
    RAISE EXCEPTION 'Nelson City Council organisation not found. Run seed_nz_organisations first.';
  END IF;

  RAISE NOTICE 'Nelson City Council org_id = %', v_ncc_org_id;

  -- ── 2. Upsert Client Sites ──────────────────────────────────────────────────
  -- All sites: Nelson, New Zealand. Charge rates derived from per-visit charges
  -- in the dispatch data (rate = visit_charge / dwell_minutes * 60 approx).

  -- NIGHTINGALE LIBRARY TAHUNANUI  PO 327257  ~$7.80/visit ~15 min → ~$31/hr
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Nightingale Library Tahunanui',
    'NCC-LIB-TAH',
    'general',
    '38 Muritai Street, Tahunanui',
    'Nelson',
    -41.2937, 173.2401, 80,
    31.20, 'NZD',
    '327257', true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_nightingale;

  IF v_nightingale IS NULL THEN
    SELECT id INTO v_nightingale FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-LIB-TAH';
  END IF;

  -- STOKE LIBRARY  PO 327247  ~$3.25/visit ~4 min → ~$49/hr (short check)
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Stoke Library',
    'NCC-LIB-STK',
    'general',
    '65 Main Road, Stoke',
    'Nelson',
    -41.3211, 173.2338, 80,
    49.00, 'NZD',
    '327247', true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_stoke_lib;

  IF v_stoke_lib IS NULL THEN
    SELECT id INTO v_stoke_lib FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-LIB-STK';
  END IF;

  -- GREENMEADOWS  PO 327272  ~$7.86/visit ~5 min
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Greenmeadows',
    'NCC-GRM',
    'general',
    'Greenmeadows Drive, Stoke',
    'Nelson',
    -41.3108, 173.2290, 80,
    90.00, 'NZD',
    '327272', true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_greenmeadows;

  IF v_greenmeadows IS NULL THEN
    SELECT id INTO v_greenmeadows FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-GRM';
  END IF;

  -- BROADGREEN HOUSE  PO 327223  ~$7.85/visit ~5 min
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Broadgreen House',
    'NCC-BGH',
    'general',
    '276 Nayland Road, Stoke',
    'Nelson',
    -41.3056, 173.2612, 80,
    90.00, 'NZD',
    '327223', true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_broadgreen;

  IF v_broadgreen IS NULL THEN
    SELECT id INTO v_broadgreen FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-BGH';
  END IF;

  -- ISEL HOUSE  PO 327222  ~$7.85/visit ~4 min
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Isel House',
    'NCC-ISEL',
    'general',
    '230 Nayland Road, Stoke',
    'Nelson',
    -41.3021, 173.2563, 80,
    90.00, 'NZD',
    '327222', true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_isel_house;

  IF v_isel_house IS NULL THEN
    SELECT id INTO v_isel_house FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-ISEL';
  END IF;

  -- MONACO RESERVE GATE  PO 322534 / 322534  ~$6–7.55/visit ~3 min
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Monaco Reserve Gate',
    'NCC-MON',
    'general',
    'Monaco Road, Monaco',
    'Nelson',
    -41.2574, 173.2172, 60,
    90.00, 'NZD',
    '322534', true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_monaco_gate;

  IF v_monaco_gate IS NULL THEN
    SELECT id INTO v_monaco_gate FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-MON';
  END IF;

  -- MARSDEN VALLEY CEMETERY  PO 329216  ~$4.40–8.80/visit (day ~4.40, night ~8.80)
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Marsden Valley Cemetery',
    'NCC-CEM-MV',
    'general',
    'Marsden Valley Road, Nelson',
    'Nelson',
    -41.3452, 173.2840, 120,
    36.00, 'NZD',
    '329216', true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_marsden_cem;

  IF v_marsden_cem IS NULL THEN
    SELECT id INTO v_marsden_cem FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-CEM-MV';
  END IF;

  -- TRAFALGAR PARK AND PAVILION  PO 327984  ~$6.90–10.35/visit
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Trafalgar Park and Pavilion',
    'NCC-TRAF',
    'general',
    'St Vincent Street, Nelson',
    'Nelson',
    -41.2908, 173.2522, 100,
    42.00, 'NZD',
    '327984', true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_trafalgar;

  IF v_trafalgar IS NULL THEN
    SELECT id INTO v_trafalgar FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-TRAF';
  END IF;

  -- WAKAPUAKA CEMETERY  PO 321485  ~$7.80/visit ~6 min
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Wakapuaka Cemetery',
    'NCC-CEM-WAK',
    'general',
    'Main Road, Wakapuaka',
    'Nelson',
    -41.2187, 173.2841, 100,
    75.00, 'NZD',
    '321485', true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_wakapuaka_cem;

  IF v_wakapuaka_cem IS NULL THEN
    SELECT id INTO v_wakapuaka_cem FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-CEM-WAK';
  END IF;

  -- SAXTON STADIUM  PO 330537  ~$6.30–9.45/visit (early ~6.30, late ~9.45)
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Saxton Stadium',
    'NCC-SAX',
    'general',
    'Saxton Road West, Stoke',
    'Nelson',
    -41.3198, 173.2446, 150,
    36.00, 'NZD',
    '330537', true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_saxton;

  IF v_saxton IS NULL THEN
    SELECT id INTO v_saxton FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-SAX';
  END IF;

  -- NELSON PUBLIC LIBRARY (ELMA TURNER)  PO 327259  ~$6.90/visit
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Nelson Public Library (Elma Turner)',
    'NCC-LIB-NPL',
    'general',
    '27 Halifax Street, Nelson',
    'Nelson',
    -41.2742, 173.2443, 80,
    28.00, 'NZD',
    '327259', true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_nelson_lib;

  IF v_nelson_lib IS NULL THEN
    SELECT id INTO v_nelson_lib FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-LIB-NPL';
  END IF;

  -- CHINESE GARDENS  ~$7.80/visit ~1 min (drive-past)
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Chinese Gardens',
    'NCC-CHGDN',
    'general',
    'Miyazu Gardens, Atawhai Drive',
    'Nelson',
    -41.2688, 173.2551, 60,
    28.00, 'NZD',
    NULL, true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_chinese_gardens;

  IF v_chinese_gardens IS NULL THEN
    SELECT id INTO v_chinese_gardens FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-CHGDN';
  END IF;

  -- ANCHOR SHIPPING BUILDING  ~$3.90/visit ~4 min
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Anchor Shipping Building',
    'NCC-ANCH',
    'general',
    'Haven Road, Nelson',
    'Nelson',
    -41.2718, 173.2634, 60,
    60.00, 'NZD',
    NULL, true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_anchor;

  IF v_anchor IS NULL THEN
    SELECT id INTO v_anchor FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-ANCH';
  END IF;

  -- EX 4 SEASONS  ~$3.90/visit ~3 min
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Ex 4 Seasons',
    'NCC-4SEA',
    'general',
    'Haven Road, Nelson',
    'Nelson',
    -41.2712, 173.2641, 60,
    60.00, 'NZD',
    NULL, true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_ex4seasons;

  IF v_ex4seasons IS NULL THEN
    SELECT id INTO v_ex4seasons FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-4SEA';
  END IF;

  -- THE REFINERY  ~$6.05/visit
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'The Refinery',
    'NCC-REFIN',
    'general',
    '60 Nile Street, Nelson',
    'Nelson',
    -41.2752, 173.2489, 60,
    28.00, 'NZD',
    NULL, true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_the_refinery;

  IF v_the_refinery IS NULL THEN
    SELECT id INTO v_the_refinery FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-REFIN';
  END IF;

  -- NEALE PARK  ~$10.00/visit ~15 min
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Neale Park',
    'NCC-NEALE',
    'general',
    'Wakefield Quay, Nelson',
    'Nelson',
    -41.2779, 173.2614, 100,
    40.00, 'NZD',
    NULL, true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_neale_park;

  IF v_neale_park IS NULL THEN
    SELECT id INTO v_neale_park FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-NEALE';
  END IF;

  -- TRAFALGAR CENTRE  PO 327163  ~$7.80/visit
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Trafalgar Centre',
    'NCC-TC',
    'general',
    'Halifax Street, Nelson',
    'Nelson',
    -41.2744, 173.2452, 80,
    42.00, 'NZD',
    '327163', true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_trafalgar_ctr;

  IF v_trafalgar_ctr IS NULL THEN
    SELECT id INTO v_trafalgar_ctr FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-TC';
  END IF;

  -- MONTGOMERY CAR PARK TOILETS  ~$7.85/visit ~2 min (drive-past inspection)
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Montgomery Car Park Toilets',
    'NCC-MONT',
    'general',
    'Montgomery Square, Nelson',
    'Nelson',
    -41.2728, 173.2452, 50,
    90.00, 'NZD',
    NULL, true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_montgomery;

  IF v_montgomery IS NULL THEN
    SELECT id INTO v_montgomery FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-MONT';
  END IF;

  -- BUXTON CAR PARK TOILETS  ~$7.85/visit ~1 min
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Buxton Car Park Toilets',
    'NCC-BUXT',
    'general',
    'Selwyn Place, Nelson',
    'Nelson',
    -41.2735, 173.2461, 50,
    90.00, 'NZD',
    NULL, true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_buxton;

  IF v_buxton IS NULL THEN
    SELECT id INTO v_buxton FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-BUXT';
  END IF;

  -- NCC CIVIC HOUSE  PO 324545  ~$7.80/visit ~2 min
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'NCC Office - Civic House',
    'NCC-CIVIC',
    'general',
    '110 Trafalgar Street, Nelson',
    'Nelson',
    -41.2740, 173.2455, 60,
    42.00, 'NZD',
    '324545', true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_ncc_civic;

  IF v_ncc_civic IS NULL THEN
    SELECT id INTO v_ncc_civic FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-CIVIC';
  END IF;

  -- NELSON CITY COUNCIL - MILLER ACRE  ~$0 (welfare/no charge site)
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Nelson City Council - Miller Acre',
    'NCC-MILL',
    'general',
    'Miller Avenue, Nelson',
    'Nelson',
    -41.2731, 173.2432, 60,
    0.00, 'NZD',
    NULL, true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_miller_acre;

  IF v_miller_acre IS NULL THEN
    SELECT id INTO v_miller_acre FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-MILL';
  END IF;

  -- PIONEER PARK TOILET BLOCK  ~$7.80/visit
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Pioneer Park Toilet Block',
    'NCC-PIONEER',
    'general',
    'Trafalgar Street, Nelson',
    'Nelson',
    -41.2750, 173.2498, 50,
    42.00, 'NZD',
    NULL, true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_pioneer_park;

  IF v_pioneer_park IS NULL THEN
    SELECT id INTO v_pioneer_park FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-PIONEER';
  END IF;

  -- BOTANICS SPORTS GROUNDS  ~$3.95/visit ~8 min
  INSERT INTO public.client_sites (
    organization_id, name, site_code, site_type, address, city,
    gps_lat, gps_lng, geofence_radius_meters,
    default_charge_rate, currency_code,
    purchase_order_number, is_active
  ) VALUES (
    v_ncc_org_id,
    'Botanics Sports Grounds',
    'NCC-BOT',
    'general',
    'Millers Acre, Nelson',
    'Nelson',
    -41.2823, 173.2528, 100,
    28.00, 'NZD',
    NULL, true
  )
  ON CONFLICT (organization_id, site_code) DO NOTHING
  RETURNING id INTO v_botanics;

  IF v_botanics IS NULL THEN
    SELECT id INTO v_botanics FROM public.client_sites
    WHERE organization_id = v_ncc_org_id AND site_code = 'NCC-BOT';
  END IF;

  RAISE NOTICE 'All NCC sites upserted.';

  -- ── 3. Patrol Route 587 — Nelson Patrol ────────────────────────────────────
  -- Route 587 covers Nelson CBD + Stoke + outlying parks.
  -- Three sub-runs observed in data: Night (21:00–), Early AM (00:00–06:00),
  -- Morning (06:00–09:30). We model this as a single mobile route with ordered
  -- checkpoints and expected_arrival_offset_minutes from route start.

  INSERT INTO public.patrol_routes (
    organization_id,
    route_name,
    route_code,
    description,
    route_type,
    default_shift,
    default_start_time,
    default_end_time,
    expected_duration_minutes,
    client_site_ids
  ) VALUES (
    v_ncc_org_id,
    '587 Nelson Patrol',
    'NCC-587',
    'Nelson City Council night and early-morning mobile patrol. Covers CBD libraries, parks, cemeteries, sports grounds and reserve gates. Three runs per night: Night (~21:00), Early AM (~00:00), Morning (~06:00).',
    'mobile',
    'night',
    '21:00',
    '09:30',
    750,
    ARRAY[
      v_nightingale, v_stoke_lib, v_greenmeadows, v_broadgreen,
      v_isel_house, v_monaco_gate, v_marsden_cem, v_trafalgar,
      v_wakapuaka_cem, v_saxton, v_nelson_lib, v_chinese_gardens,
      v_anchor, v_ex4seasons, v_the_refinery, v_neale_park,
      v_trafalgar_ctr, v_montgomery, v_buxton, v_ncc_civic,
      v_miller_acre, v_botanics
    ]
  )
  ON CONFLICT (route_code) DO UPDATE SET
    description = EXCLUDED.description,
    client_site_ids = EXCLUDED.client_site_ids,
    updated_at = now()
  RETURNING id INTO v_route_id;

  IF v_route_id IS NULL THEN
    SELECT id INTO v_route_id FROM public.patrol_routes
    WHERE route_code = 'NCC-587';
  END IF;

  RAISE NOTICE 'Patrol route 587 id = %', v_route_id;

  -- Delete existing checkpoints so we can re-seed cleanly
  DELETE FROM public.patrol_route_checkpoints WHERE patrol_route_id = v_route_id;

  -- ── Checkpoints with timing offsets ────────────────────────────────────────
  -- Based on data: Night run starts ~21:00. Offsets are minutes from route start.
  -- Dwell times are from on-site to off-site in the dispatch export.

  -- RUN 1: NIGHT (~21:00 start)
  INSERT INTO public.patrol_route_checkpoints
    (patrol_route_id, name, location_lat, location_lng, geofence_radius_meters,
     sequence_order, expected_arrival_offset_minutes, max_time_at_checkpoint_minutes, is_mandatory)
  VALUES
    -- 0 min: Marsden Valley Cemetery (first stop — remote, good to do early)
    (v_route_id, 'Marsden Valley Cemetery (Night)', -41.3452, 173.2840, 120,
     10, 0, 20, true),
    -- 22 min: Monaco Reserve Gate
    (v_route_id, 'Monaco Reserve Gate (Night)', -41.2574, 173.2172, 60,
     20, 22, 5, true),
    -- 30 min: Isel House
    (v_route_id, 'Isel House (Night)', -41.3021, 173.2563, 80,
     30, 30, 6, true),
    -- 38 min: Broadgreen House
    (v_route_id, 'Broadgreen House (Night)', -41.3056, 173.2612, 80,
     40, 38, 6, true),
    -- 46 min: Greenmeadows
    (v_route_id, 'Greenmeadows (Night)', -41.3108, 173.2290, 80,
     50, 46, 6, true),
    -- 55 min: Stoke Library
    (v_route_id, 'Stoke Library (Night)', -41.3211, 173.2338, 80,
     60, 55, 5, true),
    -- 65 min: Saxton Stadium (Night)
    (v_route_id, 'Saxton Stadium (Night)', -41.3198, 173.2446, 150,
     70, 65, 25, true),
    -- 95 min: Nightingale Library Tahunanui
    (v_route_id, 'Nightingale Library Tahunanui (Night)', -41.2937, 173.2401, 80,
     80, 95, 8, true),

  -- RUN 2: EARLY AM (~00:00 start — shorter sub-run, approx 2.5 hrs after Night run ends)
    -- 0 min: Saxton Stadium (Early AM)
    (v_route_id, 'Saxton Stadium (Early AM)', -41.3198, 173.2446, 150,
     110, 0, 20, true),
    -- 25 min: Greenmeadows
    (v_route_id, 'Greenmeadows (Early AM)', -41.3108, 173.2290, 80,
     120, 25, 6, true),
    -- 33 min: Stoke Library (Early AM)
    (v_route_id, 'Stoke Library (Early AM)', -41.3211, 173.2338, 80,
     130, 33, 4, true),
    -- 38 min: Broadgreen House (Early AM)
    (v_route_id, 'Broadgreen House (Early AM)', -41.3056, 173.2612, 80,
     140, 38, 6, true),
    -- 45 min: Isel House (Early AM)
    (v_route_id, 'Isel House (Early AM)', -41.3021, 173.2563, 80,
     150, 45, 5, true),
    -- 52 min: Monaco Reserve Gate (Early AM)
    (v_route_id, 'Monaco Reserve Gate (Early AM)', -41.2574, 173.2172, 60,
     155, 52, 4, true),
    -- 60 min: Marsden Valley Cemetery (Early AM)
    (v_route_id, 'Marsden Valley Cemetery (Early AM)', -41.3452, 173.2840, 120,
     160, 60, 10, true),

  -- RUN 3: MORNING (~06:00–09:30 start)
    -- 0 min: Wakapuaka Cemetery
    (v_route_id, 'Wakapuaka Cemetery (Morning)', -41.2187, 173.2841, 100,
     210, 0, 10, true),
    -- 15 min: Trafalgar Park and Pavilion (Morning)
    (v_route_id, 'Trafalgar Park and Pavilion (Morning)', -41.2908, 173.2522, 100,
     220, 15, 8, true),
    -- 25 min: Marsden Valley Cemetery (Morning — short check)
    (v_route_id, 'Marsden Valley Cemetery (Morning)', -41.3452, 173.2840, 120,
     230, 25, 10, true),
    -- 40 min: Nelson Public Library (Elma Turner)
    (v_route_id, 'Nelson Public Library (Morning)', -41.2742, 173.2443, 80,
     240, 40, 15, true),
    -- 60 min: Stoke Library (Morning)
    (v_route_id, 'Stoke Library (Morning)', -41.3211, 173.2338, 80,
     250, 60, 15, false),

  -- CBD sub-run (evening ~19:00–23:00 variant — Chinese Gardens, Neale Park, toilets)
    -- 0 min: Chinese Gardens
    (v_route_id, 'Chinese Gardens (Evening)', -41.2688, 173.2551, 60,
     310, 0, 5, false),
    -- 8 min: The Refinery
    (v_route_id, 'The Refinery (Evening)', -41.2752, 173.2489, 60,
     320, 8, 5, false),
    -- 13 min: Trafalgar Centre
    (v_route_id, 'Trafalgar Centre (Evening)', -41.2744, 173.2452, 80,
     325, 13, 5, false),
    -- 18 min: NCC Civic House
    (v_route_id, 'NCC Civic House (Evening)', -41.2740, 173.2455, 60,
     330, 18, 5, false),
    -- 23 min: Montgomery Car Park Toilets
    (v_route_id, 'Montgomery Car Park Toilets', -41.2728, 173.2452, 50,
     340, 23, 3, false),
    -- 27 min: Buxton Car Park Toilets
    (v_route_id, 'Buxton Car Park Toilets', -41.2735, 173.2461, 50,
     350, 27, 3, false),
    -- 30 min: Nelson City Council Miller Acre
    (v_route_id, 'NCC Miller Acre', -41.2731, 173.2432, 60,
     355, 30, 4, false),
    -- 35 min: Anchor Shipping Building
    (v_route_id, 'Anchor Shipping Building', -41.2718, 173.2634, 60,
     360, 35, 4, false),
    -- 40 min: Ex 4 Seasons
    (v_route_id, 'Ex 4 Seasons', -41.2712, 173.2641, 60,
     370, 40, 4, false),
    -- 45 min: Neale Park
    (v_route_id, 'Neale Park', -41.2779, 173.2614, 100,
     380, 45, 15, false),
    -- 62 min: Pioneer Park Toilet Block
    (v_route_id, 'Pioneer Park Toilet Block', -41.2750, 173.2498, 50,
     385, 62, 3, false),
    -- 65 min: Botanics Sports Grounds
    (v_route_id, 'Botanics Sports Grounds', -41.2823, 173.2528, 100,
     390, 65, 15, false),
    -- 82 min: Trafalgar Park and Pavilion (Evening)
    (v_route_id, 'Trafalgar Park and Pavilion (Evening)', -41.2908, 173.2522, 100,
     395, 82, 20, false),
    -- 105 min: Wakapuaka Cemetery (Evening)
    (v_route_id, 'Wakapuaka Cemetery (Evening)', -41.2187, 173.2841, 100,
     400, 105, 10, false),
    -- 120 min: Nightingale Library Tahunanui (Late)
    (v_route_id, 'Nightingale Library Tahunanui (Late)', -41.2937, 173.2401, 80,
     410, 120, 8, false)
  ;

  RAISE NOTICE 'Patrol route 587 checkpoints inserted.';

  -- ── 4. Seed dispatch_jobs from January 2026 patrol data ────────────────────
  -- Insert historical dispatch records for January 2026.
  -- Records where on_site/off_site are empty are flagged status='cancelled' (missed).
  -- job_type = 'patrol', client_charge_rate reflects the visit_charge from data.
  -- Using sequence: J-NCC-587-{dispatch_id}

  INSERT INTO public.dispatch_jobs (
    organization_id, job_number, job_type, priority,
    client_site_id, title, description,
    status, on_scene_at, completed_at,
    completion_notes
  )
  SELECT
    v_ncc_org_id,
    'J-NCC-587-' || d.ext_id,
    'patrol',
    'normal',
    d.site_id,
    d.site_name || ' - Patrol Check',
    'Route 587 Nelson Patrol. External Dispatch ID: ' || d.ext_id,
    d.status,
    d.on_scene_at,
    d.completed_at,
    CASE WHEN d.status = 'cancelled'
         THEN 'Missed patrol - not completed'
         ELSE 'Completed. Visit charge: NZD $' || d.charge::text END
  FROM (VALUES
    ('58452758', v_nightingale,  'Nightingale Library Tahunanui', '2026-01-25T22:24:00+13'::timestamptz, '2026-01-25T22:28:00+13'::timestamptz, 'completed', 7.80),
    ('58441356', v_stoke_lib,    'Stoke Library',                 '2026-01-24T21:53:00+13'::timestamptz, '2026-01-24T21:57:00+13'::timestamptz, 'completed', 3.25),
    ('58428547', v_nightingale,  'Nightingale Library Tahunanui', '2026-01-23T21:54:00+13'::timestamptz, '2026-01-23T21:58:00+13'::timestamptz, 'completed', 7.80),
    ('58439317', v_nightingale,  'Nightingale Library Tahunanui', '2026-01-24T22:10:00+13'::timestamptz, '2026-01-24T22:15:00+13'::timestamptz, 'completed', 7.80),
    ('58417216', v_nightingale,  'Nightingale Library Tahunanui', '2026-01-22T22:22:00+13'::timestamptz, '2026-01-22T22:26:00+13'::timestamptz, 'completed', 7.80),
    ('58417199', v_greenmeadows, 'Greenmeadows',                  NULL, NULL, 'cancelled', 0),
    ('58417213', v_nightingale,  'Nightingale Library Tahunanui', NULL, NULL, 'cancelled', 0),
    ('58405404', v_stoke_lib,    'Stoke Library',                 NULL, NULL, 'cancelled', 0),
    ('58405399', v_broadgreen,   'Broadgreen House',              NULL, NULL, 'cancelled', 0),
    ('58405401', v_nightingale,  'Nightingale Library Tahunanui', '2026-01-21T21:56:00+13'::timestamptz, '2026-01-21T21:58:00+13'::timestamptz, 'completed', 7.80),
    ('58393254', v_stoke_lib,    'Stoke Library',                 '2026-01-21T01:14:00+13'::timestamptz, '2026-01-21T01:15:00+13'::timestamptz, 'completed', 3.25),
    ('58405409', v_greenmeadows, 'Greenmeadows',                  '2026-01-21T01:05:00+13'::timestamptz, '2026-01-21T01:13:00+13'::timestamptz, 'completed', 7.86),
    ('58393253', v_broadgreen,   'Broadgreen House',              '2026-01-21T01:17:00+13'::timestamptz, '2026-01-21T01:21:00+13'::timestamptz, 'completed', 7.85),
    ('58393243', v_greenmeadows, 'Greenmeadows',                  NULL, NULL, 'cancelled', 0),
    ('58383772', v_stoke_lib,    'Stoke Library',                 NULL, NULL, 'cancelled', 0),
    ('58393235', v_nightingale,  'Nightingale Library Tahunanui', NULL, NULL, 'cancelled', 0),
    ('58405400', v_nightingale,  'Nightingale Library Tahunanui', '2026-01-21T00:46:00+13'::timestamptz, '2026-01-21T00:54:00+13'::timestamptz, 'completed', 7.80),
    ('58395985', v_broadgreen,   'Broadgreen House',              '2026-01-20T21:47:00+13'::timestamptz, '2026-01-20T21:52:00+13'::timestamptz, 'completed', 7.85),
    ('58393244', v_greenmeadows, 'Greenmeadows',                  '2026-01-20T22:16:00+13'::timestamptz, '2026-01-20T22:22:00+13'::timestamptz, 'completed', 7.86),
    ('58395988', v_stoke_lib,    'Stoke Library',                 '2026-01-20T22:30:00+13'::timestamptz, '2026-01-20T22:34:00+13'::timestamptz, 'completed', 3.25),
    ('58393236', v_nightingale,  'Nightingale Library Tahunanui', '2026-01-20T22:38:00+13'::timestamptz, '2026-01-20T22:51:00+13'::timestamptz, 'completed', 7.80),
    ('58383780', v_broadgreen,   'Broadgreen House',              NULL, NULL, 'cancelled', 0),
    ('58383773', v_nightingale,  'Nightingale Library Tahunanui', '2026-01-19T22:03:00+13'::timestamptz, '2026-01-19T22:07:00+13'::timestamptz, 'completed', 7.80),
    ('58385735', v_stoke_lib,    'Stoke Library',                 '2026-01-19T23:20:00+13'::timestamptz, '2026-01-19T23:23:00+13'::timestamptz, 'completed', 3.25),
    ('58383770', v_greenmeadows, 'Greenmeadows',                  '2026-01-19T23:15:00+13'::timestamptz, '2026-01-19T23:18:00+13'::timestamptz, 'completed', 7.86),
    ('58372252', v_greenmeadows, 'Greenmeadows',                  NULL, NULL, 'cancelled', 0),
    ('58372266', v_nightingale,  'Nightingale Library Tahunanui', NULL, NULL, 'cancelled', 0),
    ('58372257', v_isel_house,   'Isel House',                    NULL, NULL, 'cancelled', 0),
    ('58393231', v_monaco_gate,  'Monaco Reserve Gate',           '2026-01-20T21:55:00+13'::timestamptz, '2026-01-20T21:58:00+13'::timestamptz, 'completed', 6.04),
    ('58393232', v_isel_house,   'Isel House',                    '2026-01-20T22:23:00+13'::timestamptz, '2026-01-20T22:27:00+13'::timestamptz, 'completed', 7.85),
    ('58393230', v_isel_house,   'Isel House',                    NULL, NULL, 'cancelled', 0),
    ('58393233', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-20T20:52:00+13'::timestamptz, '2026-01-20T21:06:00+13'::timestamptz, 'completed', 8.80),
    ('58393234', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-20T20:53:00+13'::timestamptz, '2026-01-20T21:06:00+13'::timestamptz, 'completed', 8.80),
    ('58405397', v_isel_house,   'Isel House',                    '2026-01-21T01:01:00+13'::timestamptz, '2026-01-21T01:05:00+13'::timestamptz, 'completed', 7.85),
    ('58417206', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-22T20:47:00+13'::timestamptz, '2026-01-22T21:09:00+13'::timestamptz, 'completed', 8.80),
    ('58417207', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-22T20:47:00+13'::timestamptz, '2026-01-22T21:09:00+13'::timestamptz, 'completed', 8.80),
    ('58417225', v_isel_house,   'Isel House',                    NULL, NULL, 'cancelled', 0),
    ('58417226', v_monaco_gate,  'Monaco Reserve Gate',           '2026-01-22T22:08:00+13'::timestamptz, '2026-01-22T22:12:00+13'::timestamptz, 'completed', 6.04),
    ('58405390', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-21T20:45:00+13'::timestamptz, '2026-01-21T20:59:00+13'::timestamptz, 'completed', 8.80),
    ('58428551', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-23T21:04:00+13'::timestamptz, '2026-01-23T21:16:00+13'::timestamptz, 'completed', 8.80),
    ('58428552', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-23T21:04:00+13'::timestamptz, '2026-01-23T21:14:00+13'::timestamptz, 'completed', 8.80),
    ('58428546', v_monaco_gate,  'Monaco Reserve Gate',           '2026-01-23T22:19:00+13'::timestamptz, '2026-01-23T22:21:00+13'::timestamptz, 'completed', 6.04),
    ('58439302', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-24T20:49:00+13'::timestamptz, '2026-01-24T21:09:00+13'::timestamptz, 'completed', 8.80),
    ('58439303', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-24T20:48:00+13'::timestamptz, '2026-01-24T21:09:00+13'::timestamptz, 'completed', 8.80),
    ('58452753', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-25T20:53:00+13'::timestamptz, '2026-01-25T21:07:00+13'::timestamptz, 'completed', 8.80),
    ('58452754', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-25T20:53:00+13'::timestamptz, '2026-01-25T21:07:00+13'::timestamptz, 'completed', 8.80),
    ('58452759', v_isel_house,   'Isel House',                    '2026-01-25T21:57:00+13'::timestamptz, '2026-01-25T22:11:00+13'::timestamptz, 'completed', 7.85),
    ('58452761', v_monaco_gate,  'Monaco Reserve Gate',           '2026-01-25T22:49:00+13'::timestamptz, '2026-01-25T22:52:00+13'::timestamptz, 'completed', 6.04),
    ('58439309', v_monaco_gate,  'Monaco Reserve Gate',           '2026-01-24T22:28:00+13'::timestamptz, '2026-01-24T22:30:00+13'::timestamptz, 'completed', 6.04),
    ('58465742', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-26T06:29:00+13'::timestamptz, '2026-01-26T06:33:00+13'::timestamptz, 'completed', 6.90),
    ('58465743', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-26T06:37:00+13'::timestamptz, '2026-01-26T06:42:00+13'::timestamptz, 'completed', 7.80),
    ('58453560', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-25T08:48:00+13'::timestamptz, '2026-01-25T08:49:00+13'::timestamptz, 'completed', 6.90),
    ('58453561', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-25T08:40:00+13'::timestamptz, '2026-01-25T08:48:00+13'::timestamptz, 'completed', 3.45),
    ('58465739', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-26T07:28:00+13'::timestamptz, '2026-01-26T07:28:00+13'::timestamptz, 'completed', 4.40),
    ('58465741', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-26T07:18:00+13'::timestamptz, '2026-01-26T07:28:00+13'::timestamptz, 'completed', 4.40),
    ('58453554', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-25T07:54:00+13'::timestamptz, '2026-01-25T08:02:00+13'::timestamptz, 'completed', 4.40),
    ('58429627', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-23T07:14:00+13'::timestamptz, '2026-01-23T07:15:00+13'::timestamptz, 'completed', 4.40),
    ('58429628', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-23T07:05:00+13'::timestamptz, '2026-01-23T07:14:00+13'::timestamptz, 'completed', 4.40),
    ('58453569', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-25T06:20:00+13'::timestamptz, '2026-01-25T06:27:00+13'::timestamptz, 'completed', 7.80),
    ('58438942', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-24T06:17:00+13'::timestamptz, '2026-01-24T06:24:00+13'::timestamptz, 'completed', 7.80),
    ('58438944', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-24T08:13:00+13'::timestamptz, '2026-01-24T08:13:00+13'::timestamptz, 'completed', 6.90),
    ('58438945', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-24T08:02:00+13'::timestamptz, '2026-01-24T08:12:00+13'::timestamptz, 'completed', 3.45),
    ('58429626', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-23T06:12:00+13'::timestamptz, '2026-01-23T06:17:00+13'::timestamptz, 'completed', 6.90),
    ('58429625', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-23T06:21:00+13'::timestamptz, '2026-01-23T06:26:00+13'::timestamptz, 'completed', 7.80),
    ('58406062', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-21T06:10:00+13'::timestamptz, '2026-01-21T06:10:00+13'::timestamptz, 'completed', 7.80),
    ('58406063', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-21T06:10:00+13'::timestamptz, '2026-01-21T06:10:00+13'::timestamptz, 'completed', 6.90),
    ('58394434', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-20T06:58:00+13'::timestamptz, '2026-01-20T06:58:00+13'::timestamptz, 'completed', 7.80),
    ('58394437', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-20T07:03:00+13'::timestamptz, '2026-01-20T07:03:00+13'::timestamptz, 'completed', 6.90),
    ('58383019', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-19T06:20:00+13'::timestamptz, '2026-01-19T06:25:00+13'::timestamptz, 'completed', 6.90),
    ('58383016', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-19T06:30:00+13'::timestamptz, '2026-01-19T06:35:00+13'::timestamptz, 'completed', 7.80),
    ('58371313', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-18T06:13:00+13'::timestamptz, '2026-01-18T06:21:00+13'::timestamptz, 'completed', 7.80),
    ('58371319', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-18T07:58:00+13'::timestamptz, '2026-01-18T07:58:00+13'::timestamptz, 'completed', 6.90),
    ('58371320', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-18T07:50:00+13'::timestamptz, '2026-01-18T07:58:00+13'::timestamptz, 'completed', 3.45),
    ('58438951', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-24T07:08:00+13'::timestamptz, '2026-01-24T07:12:00+13'::timestamptz, 'completed', 4.40),
    ('58406071', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-21T06:08:00+13'::timestamptz, '2026-01-21T06:08:00+13'::timestamptz, 'completed', 4.40),
    ('58406072', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-21T06:09:00+13'::timestamptz, '2026-01-21T06:09:00+13'::timestamptz, 'completed', 4.40),
    ('58405406', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-21T22:00:00+13'::timestamptz, '2026-01-21T22:01:00+13'::timestamptz, 'completed', 8.80),
    ('58405387', v_monaco_gate,  'Monaco Reserve Gate',           '2026-01-21T21:52:00+13'::timestamptz, '2026-01-21T21:53:00+13'::timestamptz, 'completed', 6.04),
    ('58394435', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-20T07:20:00+13'::timestamptz, '2026-01-20T07:20:00+13'::timestamptz, 'completed', 4.40),
    ('58394436', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-20T07:19:00+13'::timestamptz, '2026-01-20T07:20:00+13'::timestamptz, 'completed', 4.40),
    ('58371316', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-18T07:05:00+13'::timestamptz, '2026-01-18T07:09:00+13'::timestamptz, 'completed', 4.40),
    ('58383747', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-19T21:46:00+13'::timestamptz, '2026-01-19T21:58:00+13'::timestamptz, 'completed', 8.80),
    ('58383748', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-19T21:45:00+13'::timestamptz, '2026-01-19T21:59:00+13'::timestamptz, 'completed', 8.80),
    ('58383017', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-19T07:12:00+13'::timestamptz, '2026-01-19T07:22:00+13'::timestamptz, 'completed', 4.40),
    ('58383018', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-19T07:22:00+13'::timestamptz, '2026-01-19T07:22:00+13'::timestamptz, 'completed', 4.40),
    ('58383776', v_monaco_gate,  'Monaco Reserve Gate',           '2026-01-19T22:07:00+13'::timestamptz, '2026-01-19T22:08:00+13'::timestamptz, 'completed', 6.04),
    ('58371324', v_nelson_lib,   'Nelson Public Library',         '2026-01-18T08:02:00+13'::timestamptz, '2026-01-18T08:19:00+13'::timestamptz, 'completed', 6.90),
    ('58371325', v_stoke_lib,    'Stoke Library',                 '2026-01-18T09:14:00+13'::timestamptz, '2026-01-18T09:30:00+13'::timestamptz, 'completed', 9.75),
    ('58370526', v_chinese_gardens,'Chinese Gardens',             '2026-01-18T18:20:00+13'::timestamptz, '2026-01-18T18:21:00+13'::timestamptz, 'completed', 7.80),
    ('58394443', v_anchor,       'Anchor Shipping Building',      '2026-01-21T06:39:00+13'::timestamptz, '2026-01-21T06:42:00+13'::timestamptz, 'completed', 3.90),
    ('58394444', v_ex4seasons,   'Ex 4 Seasons',                  '2026-01-21T06:42:00+13'::timestamptz, '2026-01-21T06:45:00+13'::timestamptz, 'completed', 3.90),
    ('58394442', v_the_refinery, 'The Refinery',                  NULL, NULL, 'cancelled', 0),
    ('58406074', v_the_refinery, 'The Refinery',                  NULL, NULL, 'cancelled', 0),
    ('58406075', v_anchor,       'Anchor Shipping Building',      '2026-01-22T06:28:00+13'::timestamptz, '2026-01-22T06:33:00+13'::timestamptz, 'completed', 3.90),
    ('58406069', v_ex4seasons,   'Ex 4 Seasons',                  NULL, NULL, 'cancelled', 0),
    ('58418066', v_anchor,       'Anchor Shipping Building',      NULL, NULL, 'cancelled', 0),
    ('58418078', v_ex4seasons,   'Ex 4 Seasons',                  NULL, NULL, 'cancelled', 0),
    ('58418067', v_the_refinery, 'The Refinery',                  NULL, NULL, 'cancelled', 0),
    ('58429638', v_ex4seasons,   'Ex 4 Seasons',                  NULL, NULL, 'cancelled', 0),
    ('58429637', v_anchor,       'Anchor Shipping Building',      NULL, NULL, 'cancelled', 0),
    ('58429635', v_the_refinery, 'The Refinery',                  NULL, NULL, 'cancelled', 0),
    ('58453567', v_the_refinery, 'The Refinery',                  NULL, NULL, 'cancelled', 0),
    ('58453568', v_anchor,       'Anchor Shipping Building',      NULL, NULL, 'cancelled', 0),
    ('58453563', v_ex4seasons,   'Ex 4 Seasons',                  NULL, NULL, 'cancelled', 0),
    ('58453564', v_nelson_lib,   'Nelson Public Library',         '2026-01-25T10:27:00+13'::timestamptz, '2026-01-25T10:42:00+13'::timestamptz, 'completed', 6.90),
    ('58453565', v_stoke_lib,    'Stoke Library',                 '2026-01-25T11:17:00+13'::timestamptz, '2026-01-25T11:32:00+13'::timestamptz, 'completed', 9.75),
    ('58438957', v_the_refinery, 'The Refinery',                  NULL, NULL, 'cancelled', 0),
    ('58438958', v_anchor,       'Anchor Shipping Building',      NULL, NULL, 'cancelled', 0),
    ('58438956', v_ex4seasons,   'Ex 4 Seasons',                  NULL, NULL, 'cancelled', 0),
    ('58452772', v_greenmeadows, 'Greenmeadows',                  '2026-01-25T05:13:00+13'::timestamptz, '2026-01-25T05:14:00+13'::timestamptz, 'completed', 7.86),
    ('58439716', v_saxton,       'Saxton Stadium',                '2026-01-24T22:49:00+13'::timestamptz, '2026-01-24T23:09:00+13'::timestamptz, 'completed', 9.45),
    ('58441354', v_broadgreen,   'Broadgreen House',              '2026-01-25T00:54:00+13'::timestamptz, '2026-01-25T00:58:00+13'::timestamptz, 'completed', 7.85),
    ('58439314', v_greenmeadows, 'Greenmeadows',                  '2026-01-25T01:18:00+13'::timestamptz, '2026-01-25T01:21:00+13'::timestamptz, 'completed', 7.86),
    ('58452767', v_broadgreen,   'Broadgreen House',              '2026-01-26T04:42:00+13'::timestamptz, '2026-01-26T04:46:00+13'::timestamptz, 'completed', 7.85),
    ('58464509', v_saxton,       'Saxton Stadium',                '2026-01-26T04:51:00+13'::timestamptz, '2026-01-26T04:59:00+13'::timestamptz, 'completed', 6.30),
    ('58464468', v_greenmeadows, 'Greenmeadows',                  '2026-01-26T02:57:00+13'::timestamptz, '2026-01-26T03:00:00+13'::timestamptz, 'completed', 7.86),
    ('58453788', v_stoke_lib,    'Stoke Library',                 '2026-01-25T21:35:00+13'::timestamptz, '2026-01-25T21:37:00+13'::timestamptz, 'completed', 3.25),
    ('58453786', v_broadgreen,   'Broadgreen House',              '2026-01-25T21:39:00+13'::timestamptz, '2026-01-25T21:43:00+13'::timestamptz, 'completed', 7.85),
    ('58452732', v_saxton,       'Saxton Stadium',                '2026-01-25T22:37:00+13'::timestamptz, '2026-01-25T22:59:00+13'::timestamptz, 'completed', 9.45),
    ('58439292', v_greenmeadows, 'Greenmeadows',                  '2026-01-24T03:38:00+13'::timestamptz, '2026-01-24T03:41:00+13'::timestamptz, 'completed', 7.86),
    ('58439711', v_saxton,       'Saxton Stadium',                '2026-01-24T03:57:00+13'::timestamptz, '2026-01-24T04:09:00+13'::timestamptz, 'completed', 6.30),
    ('58427994', v_saxton,       'Saxton Stadium',                '2026-01-23T23:30:00+13'::timestamptz, '2026-01-23T23:44:00+13'::timestamptz, 'completed', 9.45),
    ('58429835', v_stoke_lib,    'Stoke Library',                 '2026-01-24T02:30:00+13'::timestamptz, '2026-01-24T02:32:00+13'::timestamptz, 'completed', 3.25),
    ('58428548', v_stoke_lib,    'Stoke Library',                 '2026-01-24T02:30:00+13'::timestamptz, '2026-01-24T02:32:00+13'::timestamptz, 'completed', 3.25),
    ('58452771', v_greenmeadows, 'Greenmeadows',                  '2026-01-26T01:22:00+13'::timestamptz, '2026-01-26T01:26:00+13'::timestamptz, 'completed', 7.86),
    ('58452775', v_stoke_lib,    'Stoke Library',                 '2026-01-26T01:32:00+13'::timestamptz, '2026-01-26T01:34:00+13'::timestamptz, 'completed', 3.25),
    ('58439311', v_broadgreen,   'Broadgreen House',              '2026-01-25T03:41:00+13'::timestamptz, '2026-01-25T03:42:00+13'::timestamptz, 'completed', 7.85),
    ('58439315', v_stoke_lib,    'Stoke Library',                 '2026-01-25T03:45:00+13'::timestamptz, '2026-01-25T03:45:00+13'::timestamptz, 'completed', 3.25),
    ('58452730', v_saxton,       'Saxton Stadium',                '2026-01-25T03:49:00+13'::timestamptz, '2026-01-25T04:06:00+13'::timestamptz, 'completed', 6.30),
    ('58427970', v_saxton,       'Saxton Stadium',                NULL, NULL, 'cancelled', 0),
    ('58429839', v_broadgreen,   'Broadgreen House',              '2026-01-24T03:01:00+13'::timestamptz, '2026-01-24T03:09:00+13'::timestamptz, 'completed', 7.85),
    ('58428553', v_broadgreen,   'Broadgreen House',              '2026-01-24T03:01:00+13'::timestamptz, '2026-01-24T03:08:00+13'::timestamptz, 'completed', 7.85),
    ('58415707', v_saxton,       'Saxton Stadium',                '2026-01-22T22:13:00+13'::timestamptz, '2026-01-22T22:23:00+13'::timestamptz, 'completed', 9.45),
    ('58417201', v_greenmeadows, 'Greenmeadows',                  '2026-01-23T00:35:00+13'::timestamptz, '2026-01-23T00:41:00+13'::timestamptz, 'completed', 7.86),
    ('58416183', v_stoke_lib,    'Stoke Library',                 '2026-01-23T00:46:00+13'::timestamptz, '2026-01-23T00:51:00+13'::timestamptz, 'completed', 3.25),
    ('58416178', v_broadgreen,   'Broadgreen House',              '2026-01-23T00:51:00+13'::timestamptz, '2026-01-23T00:56:00+13'::timestamptz, 'completed', 7.85),
    ('58417212', v_stoke_lib,    'Stoke Library',                 '2026-01-23T02:57:00+13'::timestamptz, '2026-01-23T03:02:00+13'::timestamptz, 'completed', 3.25),
    ('58428534', v_greenmeadows, 'Greenmeadows',                  '2026-01-23T03:03:00+13'::timestamptz, '2026-01-23T03:12:00+13'::timestamptz, 'completed', 7.86),
    ('58428554', v_greenmeadows, 'Greenmeadows',                  '2026-01-24T02:20:00+13'::timestamptz, '2026-01-24T02:23:00+13'::timestamptz, 'completed', 7.86),
    ('58417203', v_broadgreen,   'Broadgreen House',              NULL, NULL, 'cancelled', 0),
    ('58415703', v_saxton,       'Saxton Stadium',                '2026-01-22T04:39:00+13'::timestamptz, '2026-01-22T04:53:00+13'::timestamptz, 'completed', 6.30),
    ('58406079', v_broadgreen,   'Broadgreen House',              '2026-01-21T22:48:00+13'::timestamptz, '2026-01-21T22:51:00+13'::timestamptz, 'completed', 7.85),
    ('58406082', v_stoke_lib,    'Stoke Library',                 '2026-01-21T22:35:00+13'::timestamptz, '2026-01-21T22:39:00+13'::timestamptz, 'completed', 3.25),
    ('58405414', v_greenmeadows, 'Greenmeadows',                  '2026-01-21T22:12:00+13'::timestamptz, '2026-01-21T22:15:00+13'::timestamptz, 'completed', 7.86),
    ('58405570', v_saxton,       'Saxton Stadium',                '2026-01-21T23:20:00+13'::timestamptz, '2026-01-21T23:54:00+13'::timestamptz, 'completed', 9.45),
    ('58405559', v_saxton,       'Saxton Stadium',                '2026-01-21T04:46:00+13'::timestamptz, '2026-01-21T04:58:00+13'::timestamptz, 'completed', 6.30),
    ('58394837', v_saxton,       'Saxton Stadium',                '2026-01-20T03:22:00+13'::timestamptz, '2026-01-20T03:34:00+13'::timestamptz, 'completed', 6.30),
    ('58394843', v_saxton,       'Saxton Stadium',                '2026-01-20T23:21:00+13'::timestamptz, '2026-01-20T23:56:00+13'::timestamptz, 'completed', 9.45),
    ('58370528', v_stoke_lib,    'Stoke Library',                 '2026-01-18T22:39:00+13'::timestamptz, '2026-01-18T22:42:00+13'::timestamptz, 'completed', 3.25),
    ('58370532', v_broadgreen,   'Broadgreen House',              '2026-01-18T23:06:00+13'::timestamptz, '2026-01-18T23:09:00+13'::timestamptz, 'completed', 7.85),
    ('58372251', v_greenmeadows, 'Greenmeadows',                  '2026-01-18T22:28:00+13'::timestamptz, '2026-01-18T22:31:00+13'::timestamptz, 'completed', 7.86),
    ('58371833', v_saxton,       'Saxton Stadium',                '2026-01-18T23:35:00+13'::timestamptz, '2026-01-18T23:58:00+13'::timestamptz, 'completed', 9.45),
    ('58372269', v_stoke_lib,    'Stoke Library',                 '2026-01-19T00:49:00+13'::timestamptz, '2026-01-19T00:51:00+13'::timestamptz, 'completed', 3.25),
    ('58372273', v_broadgreen,   'Broadgreen House',              '2026-01-19T01:09:00+13'::timestamptz, '2026-01-19T01:13:00+13'::timestamptz, 'completed', 7.85),
    ('58385743', v_broadgreen,   'Broadgreen House',              '2026-01-19T23:24:00+13'::timestamptz, '2026-01-19T23:29:00+13'::timestamptz, 'completed', 7.85),
    ('58382671', v_saxton,       'Saxton Stadium',                '2026-01-19T22:26:00+13'::timestamptz, '2026-01-19T22:38:00+13'::timestamptz, 'completed', 9.45),
    ('58371832', v_saxton,       'Saxton Stadium',                '2026-01-18T04:08:00+13'::timestamptz, '2026-01-18T04:18:00+13'::timestamptz, 'completed', 6.30),
    ('58371810', v_monaco_gate,  'Monaco Reserve Gate',           '2026-01-18T04:02:00+13'::timestamptz, '2026-01-18T04:08:00+13'::timestamptz, 'completed', 7.55),
    ('58372254', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-18T21:15:00+13'::timestamptz, '2026-01-18T21:16:00+13'::timestamptz, 'completed', 8.80),
    ('58372255', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-18T21:15:00+13'::timestamptz, '2026-01-18T21:16:00+13'::timestamptz, 'completed', 8.80),
    ('58372258', v_isel_house,   'Isel House',                    '2026-01-18T22:33:00+13'::timestamptz, '2026-01-18T22:35:00+13'::timestamptz, 'completed', 7.85),
    ('58372256', v_monaco_gate,  'Monaco Reserve Gate',           '2026-01-18T23:12:00+13'::timestamptz, '2026-01-18T23:13:00+13'::timestamptz, 'completed', 6.04),
    ('58383756', v_isel_house,   'Isel House',                    '2026-01-19T03:08:00+13'::timestamptz, '2026-01-19T03:10:00+13'::timestamptz, 'completed', 7.85),
    ('58382651', v_monaco_gate,  'Monaco Reserve Gate',           '2026-01-19T03:15:00+13'::timestamptz, '2026-01-19T03:20:00+13'::timestamptz, 'completed', 7.55),
    ('58383775', v_isel_house,   'Isel House',                    '2026-01-19T23:49:00+13'::timestamptz, '2026-01-19T23:53:00+13'::timestamptz, 'completed', 7.85),
    ('58394811', v_monaco_gate,  'Monaco Reserve Gate',           '2026-01-20T03:31:00+13'::timestamptz, '2026-01-20T03:33:00+13'::timestamptz, 'completed', 7.55),
    ('58405532', v_monaco_gate,  'Monaco Reserve Gate',           '2026-01-21T05:05:00+13'::timestamptz, '2026-01-21T05:07:00+13'::timestamptz, 'completed', 7.55),
    ('58382660', v_saxton,       'Saxton Stadium',                '2026-01-19T02:48:00+13'::timestamptz, '2026-01-19T02:53:00+13'::timestamptz, 'completed', 6.30),
    ('58383764', v_greenmeadows, 'Greenmeadows',                  '2026-01-19T03:03:00+13'::timestamptz, '2026-01-19T03:06:00+13'::timestamptz, 'completed', 7.86),
    ('58418072', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-22T04:58:00+13'::timestamptz, '2026-01-22T05:01:00+13'::timestamptz, 'completed', 4.40),
    ('58418073', v_marsden_cem,  'Marsden Valley Cemetery',       '2026-01-22T04:58:00+13'::timestamptz, '2026-01-22T05:02:00+13'::timestamptz, 'completed', 4.40),
    ('58415720', v_monaco_gate,  'Monaco Reserve Gate',           '2026-01-22T05:43:00+13'::timestamptz, '2026-01-22T05:45:00+13'::timestamptz, 'completed', 7.55),
    ('58405398', v_isel_house,   'Isel House',                    '2026-01-21T22:18:00+13'::timestamptz, '2026-01-21T22:20:00+13'::timestamptz, 'completed', 7.85),
    ('58439298', v_isel_house,   'Isel House',                    '2026-01-24T03:22:00+13'::timestamptz, '2026-01-24T03:25:00+13'::timestamptz, 'completed', 7.85),
    ('58417227', v_isel_house,   'Isel House',                    '2026-01-23T00:56:00+13'::timestamptz, '2026-01-23T01:01:00+13'::timestamptz, 'completed', 7.85),
    ('58428538', v_isel_house,   'Isel House',                    '2026-01-23T02:52:00+13'::timestamptz, '2026-01-23T02:57:00+13'::timestamptz, 'completed', 7.85),
    ('58439319', v_isel_house,   'Isel House',                    '2026-01-25T01:14:00+13'::timestamptz, '2026-01-25T01:16:00+13'::timestamptz, 'completed', 7.85),
    ('58439712', v_monaco_gate,  'Monaco Reserve Gate',           '2026-01-24T05:37:00+13'::timestamptz, '2026-01-24T05:39:00+13'::timestamptz, 'completed', 7.55),
    ('58427991', v_monaco_gate,  'Monaco Reserve Gate',           NULL, NULL, 'cancelled', 0),
    ('58428545', v_isel_house,   'Isel House',                    '2026-01-24T02:25:00+13'::timestamptz, '2026-01-24T02:28:00+13'::timestamptz, 'completed', 7.85),
    ('58464469', v_isel_house,   'Isel House',                    '2026-01-26T01:28:00+13'::timestamptz, '2026-01-26T01:30:00+13'::timestamptz, 'completed', 7.85),
    ('58452760', v_isel_house,   'Isel House',                    NULL, NULL, 'cancelled', 0),
    ('58464521', v_monaco_gate,  'Monaco Reserve Gate',           '2026-01-26T05:29:00+13'::timestamptz, '2026-01-26T05:30:00+13'::timestamptz, 'completed', 7.55),
    ('58452699', v_monaco_gate,  'Monaco Reserve Gate',           '2026-01-25T05:18:00+13'::timestamptz, '2026-01-25T05:20:00+13'::timestamptz, 'completed', 7.55),
    ('58453792', v_botanics,     'Botanics Sports Grounds',       '2026-01-25T23:43:00+13'::timestamptz, '2026-01-25T23:52:00+13'::timestamptz, 'completed', 3.95),
    ('58452242', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-25T19:33:00+13'::timestamptz, '2026-01-25T19:45:00+13'::timestamptz, 'completed', 7.80),
    ('58453787', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-25T21:08:00+13'::timestamptz, '2026-01-25T21:28:00+13'::timestamptz, 'completed', 10.35),
    ('58371332', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-18T20:56:00+13'::timestamptz, '2026-01-18T21:01:00+13'::timestamptz, 'completed', 7.80),
    ('58370523', v_botanics,     'Botanics Sports Grounds',       '2026-01-18T22:06:00+13'::timestamptz, '2026-01-18T22:06:00+13'::timestamptz, 'completed', 3.95),
    ('58370524', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-18T21:04:00+13'::timestamptz, '2026-01-18T21:07:00+13'::timestamptz, 'completed', 10.35),
    ('58394448', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-20T20:04:00+13'::timestamptz, '2026-01-20T20:16:00+13'::timestamptz, 'completed', 7.80),
    ('58395978', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-20T23:21:00+13'::timestamptz, '2026-01-20T23:36:00+13'::timestamptz, 'completed', 10.35),
    ('58385740', v_botanics,     'Botanics Sports Grounds',       '2026-01-19T23:25:00+13'::timestamptz, '2026-01-19T23:35:00+13'::timestamptz, 'completed', 3.95),
    ('58385736', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-19T22:51:00+13'::timestamptz, '2026-01-19T23:06:00+13'::timestamptz, 'completed', 10.35),
    ('58383299', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-19T20:21:00+13'::timestamptz, '2026-01-19T20:31:00+13'::timestamptz, 'completed', 7.80),
    ('58429831', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-23T19:52:00+13'::timestamptz, '2026-01-23T19:56:00+13'::timestamptz, 'completed', 10.35),
    ('58416176', v_botanics,     'Botanics Sports Grounds',       '2026-01-22T22:08:00+13'::timestamptz, '2026-01-22T22:08:00+13'::timestamptz, 'completed', 3.95),
    ('58416209', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-22T20:58:00+13'::timestamptz, '2026-01-22T21:02:00+13'::timestamptz, 'completed', 7.80),
    ('58416175', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-22T20:20:00+13'::timestamptz, '2026-01-22T20:22:00+13'::timestamptz, 'completed', 10.35),
    ('58418075', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-22T06:00:00+13'::timestamptz, '2026-01-22T06:10:00+13'::timestamptz, 'completed', 7.80),
    ('58418065', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-22T06:13:00+13'::timestamptz, '2026-01-22T06:19:00+13'::timestamptz, 'completed', 6.90),
    ('58406084', v_botanics,     'Botanics Sports Grounds',       '2026-01-21T22:45:00+13'::timestamptz, '2026-01-21T22:51:00+13'::timestamptz, 'completed', 3.95),
    ('58406076', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-21T22:59:00+13'::timestamptz, '2026-01-21T23:20:00+13'::timestamptz, 'completed', 10.35),
    ('58405045', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-21T20:06:00+13'::timestamptz, '2026-01-21T20:18:00+13'::timestamptz, 'completed', 7.80),
    ('58395984', v_botanics,     'Botanics Sports Grounds',       '2026-01-21T00:10:00+13'::timestamptz, '2026-01-21T00:27:00+13'::timestamptz, 'completed', 3.95),
    ('58429830', v_botanics,     'Botanics Sports Grounds',       '2026-01-23T20:13:00+13'::timestamptz, '2026-01-23T20:13:00+13'::timestamptz, 'completed', 3.95),
    ('58429807', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-23T21:01:00+13'::timestamptz, '2026-01-23T21:07:00+13'::timestamptz, 'completed', 7.80),
    ('58441351', v_botanics,     'Botanics Sports Grounds',       '2026-01-24T22:10:00+13'::timestamptz, '2026-01-24T22:10:00+13'::timestamptz, 'completed', 3.95),
    ('58438961', v_wakapuaka_cem,'Wakapuaka Cemetery',            '2026-01-24T20:47:00+13'::timestamptz, '2026-01-24T20:53:00+13'::timestamptz, 'completed', 7.80),
    ('58441349', v_trafalgar,    'Trafalgar Park and Pavilion',   '2026-01-24T20:57:00+13'::timestamptz, '2026-01-24T20:57:00+13'::timestamptz, 'completed', 10.35),
    ('58370535', v_pioneer_park, 'Pioneer Park Toilet Block',     '2026-01-18T22:07:00+13'::timestamptz, '2026-01-18T22:07:00+13'::timestamptz, 'completed', 7.80),
    ('58371343', v_chinese_gardens,'Chinese Gardens',             '2026-01-18T03:37:00+13'::timestamptz, '2026-01-18T03:37:00+13'::timestamptz, 'completed', 7.80),
    ('58371360', v_montgomery,   'Montgomery Car Park Toilets',   '2026-01-18T03:11:00+13'::timestamptz, '2026-01-18T03:12:00+13'::timestamptz, 'completed', 7.85),
    ('58371334', v_trafalgar_ctr,'Trafalgar Centre',              '2026-01-18T03:09:00+13'::timestamptz, '2026-01-18T03:10:00+13'::timestamptz, 'completed', 7.80),
    ('58371347', v_buxton,       'Buxton Car Park Toilets',       '2026-01-18T03:12:00+13'::timestamptz, '2026-01-18T03:12:00+13'::timestamptz, 'completed', 7.85),
    ('58385739', v_nelson_lib,   'Nelson Public Library',         '2026-01-19T22:32:00+13'::timestamptz, '2026-01-19T22:43:00+13'::timestamptz, 'completed', 6.90),
    ('58383328', v_ncc_civic,    'NCC Civic House',               '2026-01-19T22:36:00+13'::timestamptz, '2026-01-19T22:46:00+13'::timestamptz, 'completed', 7.80),
    ('58385734', v_montgomery,   'Montgomery Car Park Toilets',   '2026-01-19T22:30:00+13'::timestamptz, '2026-01-19T22:46:00+13'::timestamptz, 'completed', 7.85),
    ('58385741', v_the_refinery, 'The Refinery',                  '2026-01-19T22:31:00+13'::timestamptz, '2026-01-19T22:46:00+13'::timestamptz, 'completed', 6.05),
    ('58383315', v_chinese_gardens,'Chinese Gardens',             '2026-01-19T04:04:00+13'::timestamptz, '2026-01-19T04:04:00+13'::timestamptz, 'completed', 7.80),
    ('58385737', v_chinese_gardens,'Chinese Gardens',             '2026-01-19T21:16:00+13'::timestamptz, '2026-01-19T21:29:00+13'::timestamptz, 'completed', 7.80),
    ('58383337', v_miller_acre,  'NCC Miller Acre',               '2026-01-19T22:24:00+13'::timestamptz, '2026-01-19T22:30:00+13'::timestamptz, 'completed', 0.00),
    ('58385731', v_buxton,       'Buxton Car Park Toilets',       '2026-01-19T22:18:00+13'::timestamptz, '2026-01-19T22:30:00+13'::timestamptz, 'completed', 7.85),
    ('58383761', v_nightingale,  'Nightingale Library Tahunanui', '2026-01-19T02:00:00+13'::timestamptz, '2026-01-19T02:03:00+13'::timestamptz, 'completed', 7.80),
    ('58383300', v_montgomery,   'Montgomery Car Park Toilets',   '2026-01-19T02:22:00+13'::timestamptz, '2026-01-19T02:23:00+13'::timestamptz, 'completed', 7.85),
    ('58383309', v_buxton,       'Buxton Car Park Toilets',       '2026-01-19T02:24:00+13'::timestamptz, '2026-01-19T02:24:00+13'::timestamptz, 'completed', 7.85),
    ('58383314', v_trafalgar_ctr,'Trafalgar Centre',              '2026-01-19T02:20:00+13'::timestamptz, '2026-01-19T02:22:00+13'::timestamptz, 'completed', 7.80),
    ('58371346', v_ncc_civic,    'NCC Civic House',               '2026-01-19T02:24:00+13'::timestamptz, '2026-01-19T02:26:00+13'::timestamptz, 'completed', 7.80),
    ('58372270', v_nightingale,  'Nightingale Library Tahunanui', '2026-01-19T00:22:00+13'::timestamptz, '2026-01-19T00:23:00+13'::timestamptz, 'completed', 7.80),
    ('58385732', v_neale_park,   'Neale Park',                    '2026-01-19T23:17:00+13'::timestamptz, '2026-01-19T23:27:00+13'::timestamptz, 'completed', 10.00),
    ('58370527', v_nelson_lib,   'Nelson Public Library',         '2026-01-18T21:07:00+13'::timestamptz, '2026-01-18T21:08:00+13'::timestamptz, 'completed', 6.90),
    ('58370529', v_buxton,       'Buxton Car Park Toilets',       '2026-01-18T21:12:00+13'::timestamptz, '2026-01-18T21:13:00+13'::timestamptz, 'completed', 7.85),
    ('58370520', v_the_refinery, 'The Refinery',                  '2026-01-18T21:10:00+13'::timestamptz, '2026-01-18T21:12:00+13'::timestamptz, 'completed', 6.05),
    ('58370522', v_trafalgar_ctr,'Trafalgar Centre',              '2026-01-18T21:08:00+13'::timestamptz, '2026-01-18T21:09:00+13'::timestamptz, 'completed', 7.80),
    ('58370530', v_neale_park,   'Neale Park',                    '2026-01-18T22:06:00+13'::timestamptz, '2026-01-18T22:06:00+13'::timestamptz, 'completed', 10.00),
    ('58370521', v_anchor,       'Anchor Shipping Building',      '2026-01-18T22:11:00+13'::timestamptz, '2026-01-18T22:13:00+13'::timestamptz, 'completed', 3.90),
    ('58370534', v_ex4seasons,   'Ex 4 Seasons',                  '2026-01-18T22:11:00+13'::timestamptz, '2026-01-18T22:13:00+13'::timestamptz, 'completed', 3.90),
    ('58370533', v_montgomery,   'Montgomery Car Park Toilets',   '2026-01-18T19:55:00+13'::timestamptz, '2026-01-18T19:56:00+13'::timestamptz, 'completed', 7.85),
    ('58371367', v_miller_acre,  'NCC Miller Acre',               '2026-01-18T19:56:00+13'::timestamptz, '2026-01-18T19:59:00+13'::timestamptz, 'completed', 0.00),
    ('58371345', v_ncc_civic,    'NCC Civic House',               '2026-01-18T19:56:00+13'::timestamptz, '2026-01-18T19:59:00+13'::timestamptz, 'completed', 7.80),
    ('58395986', v_neale_park,   'Neale Park',                    '2026-01-21T00:10:00+13'::timestamptz, '2026-01-21T00:24:00+13'::timestamptz, 'completed', 10.00),
    ('58385738', v_trafalgar_ctr,'Trafalgar Centre',              '2026-01-19T22:56:00+13'::timestamptz, '2026-01-19T23:06:00+13'::timestamptz, 'completed', 7.80),
    ('58395979', v_chinese_gardens,'Chinese Gardens',             '2026-01-20T21:08:00+13'::timestamptz, '2026-01-20T21:18:00+13'::timestamptz, 'completed', 7.80),
    ('58394469', v_miller_acre,  'NCC Miller Acre',               '2026-01-20T21:14:00+13'::timestamptz, '2026-01-20T21:25:00+13'::timestamptz, 'completed', 0.00),
    ('58395980', v_montgomery,   'Montgomery Car Park Toilets',   '2026-01-20T21:18:00+13'::timestamptz, '2026-01-20T21:24:00+13'::timestamptz, 'completed', 7.85)
  ) AS d(ext_id, site_id, site_name, on_scene_at, completed_at, status, charge)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.dispatch_jobs
    WHERE job_number = 'J-NCC-587-' || d.ext_id
  );

  RAISE NOTICE 'Dispatch job history seeded for Route 587 (Jan 2026).';

END $$;
