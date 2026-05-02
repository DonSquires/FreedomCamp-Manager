-- =============================================================================
-- NCC Noise Control Historical Import (Jan 2025)
-- - Inserts complaint/offending locations into locations_of_interest (LOI)
-- - Inserts complainants into persons_of_interest (POI)
-- - Links POI/LOI to dispatch_jobs for noise complaints
-- =============================================================================

-- Add explicit linkage fields (idempotent)
ALTER TABLE public.persons_of_interest
  ADD COLUMN IF NOT EXISTS address_loi_id UUID REFERENCES public.locations_of_interest(id) ON DELETE SET NULL;

ALTER TABLE public.vehicles_of_interest
  ADD COLUMN IF NOT EXISTS address_loi_id UUID REFERENCES public.locations_of_interest(id) ON DELETE SET NULL;

ALTER TABLE public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS complainant_poi_id UUID REFERENCES public.persons_of_interest(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS complainant_voi_id UUID REFERENCES public.vehicles_of_interest(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS complainant_loi_id UUID REFERENCES public.locations_of_interest(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offending_loi_id UUID REFERENCES public.locations_of_interest(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_poi_address_loi_id ON public.persons_of_interest(address_loi_id) WHERE address_loi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voi_address_loi_id ON public.vehicles_of_interest(address_loi_id) WHERE address_loi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_complainant_poi_id ON public.dispatch_jobs(complainant_poi_id) WHERE complainant_poi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_complainant_loi_id ON public.dispatch_jobs(complainant_loi_id) WHERE complainant_loi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_offending_loi_id ON public.dispatch_jobs(offending_loi_id) WHERE offending_loi_id IS NOT NULL;

DO $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE name ILIKE '%Nelson City Council%'
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Nelson City Council organization not found';
  END IF;

  -- Source rows from the provided NCC Noise Control extract.
  WITH raw_noise AS (
    SELECT * FROM (
      VALUES
        ('54011208', '2025-01-01 01:55'::timestamp, 12, 9, 88.00::numeric, '587',
         'NOISY STEREO BASS 2 ELLIOT STREET THE WOOD NELSON',
         NULL,
         NULL, NULL, NULL,
         '2 ELLIOT STREET, THE WOOD, NELSON'),

        ('54011236', '2025-01-01 02:31'::timestamp, 17, 18, 88.00::numeric, '587',
         'SUZIE ANDREWS, 0226088781, 49 SCOTIA STREET WAKATU, NELSON, LOUD MUSIC COMING FROM 47 SCOTIA ST, WAKATU NELSON',
         'THEY SAW ME TURN UP AND THEY TURN IT DOWN.',
         'SUZIE ANDREWS', '0226088781', '49 SCOTIA STREET, WAKATU, NELSON',
         '47 SCOTIA ST, WAKATU, NELSON'),

        ('54011327', '2025-01-01 04:48'::timestamp, 4, 17, 88.00::numeric, '587',
         'RYAN O''CONNOR 02108243314, 128 DODSON VALLEY ROAD NELSON, NOISY MUSIC 21 HODGSON PLACE NELSON',
         'NO NOISE ON ARRIVAL',
         'RYAN O''CONNOR', '02108243314', '128 DODSON VALLEY ROAD, NELSON',
         '21 HODGSON PLACE, NELSON'),

        ('54011331', '2025-01-01 04:52'::timestamp, 39, 6, 88.00::numeric, '587',
         'SUZIE ANDREWS 0226088781, 49 SCOTIA STREET WAKATU NELSON, LOUD MUSIC COMING FROM 47 SCOTIA ST WAKATU NELSON',
         'NOISE IS AT A REASONABLE LEVEL.',
         'SUZIE ANDREWS', '0226088781', '49 SCOTIA STREET, WAKATU, NELSON',
         '47 SCOTIA ST, WAKATU, NELSON'),

        ('54011379', '2025-01-01 07:15'::timestamp, 52, 1, 88.00::numeric, '585',
         'NOISE CONTROL - LOUD MUSIC COMING FROM 47 SCOTIA ST, WAKATU NELSON',
         'NO NOISE ON ARRIVAL',
         'SUZIE ANDREWS', '0226088781', '49 SCOTIA STREET, WAKATU, NELSON',
         '47 SCOTIA ST, WAKATU, NELSON'),

        ('54011506', '2025-01-01 11:53'::timestamp, 51, 9, 88.00::numeric, '585',
         '128 DODSON VALLEY ROAD NELSON, NOISY MUSIC AT 21 HODGSON PLACE NELSON',
         'VOLUME 2, TIME 1, TONE 1 TOTAL 4. NOISE ACCEPTABLE.',
         NULL, NULL, '128 DODSON VALLEY ROAD, NELSON',
         '21 HODGSON PLACE, NELSON'),

        ('54022295', '2025-01-01 23:53'::timestamp, 29, 5, 88.00::numeric, '587',
         'LOUD BASS MUSIC COMING FROM 117 TIPAHI STREET, NELSON SOUTH',
         'NO NOISE ON ARRIVAL',
         NULL, NULL, NULL,
         '117 TIPAHI STREET, NELSON SOUTH'),

        ('54026610', '2025-01-02 17:46'::timestamp, 65, 10, 88.00::numeric, '584',
         'SOPHIE GLENDORRAN 0276440905 BASS IS LOUD COMING FROM ISEL PARK',
         'ON GOING ISEL PARK MARKET ACTIVITIES WITH LIVE MUSIC.',
         'SOPHIE GLENDORRAN', '0276440905', NULL,
         'ISEL PARK, STOKE, NELSON'),

        ('54033594', '2025-01-02 22:58'::timestamp, 16, 1, 88.00::numeric, '584',
         'MR NAM FROM 3 ANN BIRD COURT STOKE NELSON IN REGARDS TO 11 ANN BIRD COURT STOKE NELSON',
         'NO NOISE FROM PROPERTY ON ARRIVAL.',
         'MR NAM', NULL, '3 ANN BIRD COURT, STOKE, NELSON',
         '11 ANN BIRD COURT, STOKE, NELSON'),

        ('54046101', '2025-01-03 20:49'::timestamp, 32, 5, 88.00::numeric, '587',
         'JORDAN AT 1 PIKO STREET TOI TOI NELSON CALLED RE LOUD BASS MUSIC COMING FROM 55 EMANO STREET TOI TOI NELSON',
         'NO NOISE ON ARRIVAL',
         'JORDAN', NULL, '1 PIKO STREET, TOI TOI, NELSON',
         '55 EMANO STREET, TOI TOI, NELSON'),

        ('54046490', '2025-01-04 10:59'::timestamp, 22, 12, 88.00::numeric, '585',
         'TINA 02102462738 NOISE COMPLAINT LOUD MUSIC HEAVY BASS SINCE 7AM ADDRESS OF NOISE 2/52 WASHINGTON ROAD',
         'NO ACTION NEEDED',
         'TINA', '02102462738', NULL,
         '2/52 WASHINGTON ROAD, WASHINGTON VALLEY, NELSON'),

        ('54058825', '2025-01-04 22:46'::timestamp, 20, 6, 88.00::numeric, '584',
         'TREVOR OMLO 0220880694, 72 NORWICH STREET STOKE NELSON, LOUD MUSIC FROM 74 NORWICH STREET STOKE NELSON',
         'TOLD THEM TO TURN NOISE DOWN THEY COMPLIED',
         'TREVOR OMLO', '0220880694', '72 NORWICH STREET, STOKE, NELSON',
         '74 NORWICH STREET, STOKE, NELSON'),

        ('54063169', '2025-01-05 18:17'::timestamp, 75, 4, 88.00::numeric, '582',
         'NEIL THOMPSON 0210798333 NOISE COMPLAINT LOUD BASS COMING FROM 45 KINGSFORD DRIVE STOKE NELSON',
         'NOISE ASSESSED FROM ROADSIDE. NOT EXCESSIVE.',
         'NEIL THOMPSON', '0210798333', '51 KINGSFORD DRIVE, STOKE, NELSON',
         '45 KINGSFORD DRIVE, STOKE, NELSON'),

        ('54069724', '2025-01-05 19:25'::timestamp, 7, 4, 88.00::numeric, '582',
         'NOISE COMPLAINT 5 BREMNER CRESCENT STOKE LOUD MUSIC FROM 3 BREMNER CRESCENT STOKE',
         'ASSESSED FROM ROADSIDE NOISE ACCEPTABLE',
         NULL, NULL, '5 BREMNER CRESCENT, STOKE, NELSON',
         '3 BREMNER CRESCENT, STOKE, NELSON'),

        ('54069878', '2025-01-05 23:38'::timestamp, 18, 19, 88.00::numeric, '587',
         'KATHY CONNOR 02040272289, 5A RENWICK PLACE NELSON, LOUD MUSIC COMING FROM 72 WELLINGTON ST',
         'HOUSE OWNER TURNED IT DOWN',
         'KATHY CONNOR', '02040272289', '5A RENWICK PLACE, NELSON',
         '72 WELLINGTON ST, NELSON'),

        ('54069891', '2025-01-06 00:09'::timestamp, 115, 34, 176.00::numeric, '584',
         'MICHAEL JACKSON, 0278086077, 19A POLSTEAD ROAD STOKE, NOISY STEREO 17 POLSTEAD ROAD STOKE',
         'COULD NOT LOCATE AREA BUT THERE IS NO NOISE',
         'MICHAEL JACKSON', '0278086077', '19A POLSTEAD ROAD, STOKE, NELSON',
         '17 POLSTEAD ROAD, STOKE, NELSON'),

        ('54069930', '2025-01-06 01:50'::timestamp, 16, 5, 88.00::numeric, '587',
         'KATHY CONNOR 02040272289 5A RENWICK PLACE NELSON LOUD MUSIC FROM 72 WELLINGTON ST',
         'NOISE IS AT A REASONABLE LEVEL',
         'KATHY CONNOR', '02040272289', '5A RENWICK PLACE, NELSON',
         '72 WELLINGTON ST, NELSON'),

        ('54080823', '2025-01-07 01:36'::timestamp, 26, 1, 88.00::numeric, '584',
         'FIONA WATTS, 021340025, 187B PRINCES DRIVE, NOISY STEREO BASS ABOUT 4 OR 6 BANFF WAY',
         'OCCUPANTS COMPLIANT',
         'FIONA WATTS', '021340025', '187B PRINCES DRIVE, NELSON',
         'BANFF WAY, NELSON'),

        ('54091685', '2025-01-07 22:52'::timestamp, 19, 5, 88.00::numeric, '587',
         'LOUD PARTY NOISE AT 43 TAHUNANUI DRIVE, NELSON',
         'NO NOISE ON ARRIVAL',
         NULL, NULL, NULL,
         '43 TAHUNANUI DRIVE, NELSON'),

        ('54102599', '2025-01-09 00:52'::timestamp, 25, 5, 88.00::numeric, '586',
         'JORDAN MCGILLIVRAY, 02102951017, 32 DICKENS STREET STOKE, NOISY MUSIC 30 DICKENS STREET STOKE',
         'VERBAL WARNING ISSUED NOISE UNACCEPTABLE',
         'JORDAN MCGILLIVRAY', '02102951017', '32 DICKENS STREET, STOKE, NELSON',
         '30 DICKENS STREET, STOKE, NELSON'),

        ('54113675', '2025-01-09 23:13'::timestamp, 16, 5, 88.00::numeric, '587',
         'LOUD BAND AND BASS NOISE FROM WAKA BAR 58 COLLINGWOOD STREET OR DELANEYS BAR',
         'NO FURTHER ACTION REQUIRED',
         NULL, NULL, NULL,
         '58 COLLINGWOOD STREET, NELSON'),

        ('54113701', '2025-01-09 23:53'::timestamp, 21, 5, 88.00::numeric, '586',
         'NOISE COMPLAINT LOUD MUSIC COMING FROM 17 POLSTEAD ROAD STOKE',
         'NO NOISE ON ARRIVAL',
         NULL, NULL, NULL,
         '17 POLSTEAD ROAD, STOKE, NELSON'),

        ('54126655', '2025-01-11 12:30'::timestamp, 17, 1, 88.00::numeric, '585',
         'NOISE FROM 21 MARLOWE STREET STOKE, CALLING FROM 2/22 KIPLING CRESCENT STOKE',
         'NOISE LEVEL DOES NOT MATCH CRITERIA FOR END',
         NULL, NULL, '2/22 KIPLING CRESCENT, STOKE, NELSON',
         '21 MARLOWE STREET, STOKE, NELSON'),

        ('54138815', '2025-01-11 21:46'::timestamp, 5, 1, 88.00::numeric, '584',
         'ANN FROM 3/4 WILLOW AVENUE STOKE IN REGARDS TO TURF HOTEL 228 SONGER STREET STOKE',
         'BAND LEVELS MODERATE',
         'ANN', NULL, '3/4 WILLOW AVENUE, STOKE, NELSON',
         '228 SONGER STREET, STOKE, NELSON'),

        ('54138886', '2025-01-11 22:50'::timestamp, 19, 45, 176.00::numeric, '587',
         'BRONWYN WALKER 035485691 LOUD BASS MUSIC FROM AMBER COURT MOTEL 190 ANNESBROOK DRIVE',
         'END NOTICE ISSUED #11117',
         'BRONWYN WALKER', '035485691', NULL,
         '190 ANNESBROOK DRIVE, TAHUNANUI, NELSON'),

        ('54138986', '2025-01-12 00:58'::timestamp, 18, 7, 88.00::numeric, '587',
         'NOISE COMPLAINT LOUD MUSIC COMING FROM 96 DODSON VALLEY ROAD, ATAWHAI',
         'VERBAL WARNING GIVEN',
         NULL, NULL, NULL,
         '96 DODSON VALLEY ROAD, ATAWHAI, NELSON'),

        ('54139198', '2025-01-12 10:57'::timestamp, 6, 1, 88.00::numeric, '585',
         'TINA 02102462738 LOUD MUSIC WITH LOUD BASS AT 2/52 WASHINGTON ROAD NELSON',
         'NOISE DOES NOT MEET CRITERIA FOR END',
         'TINA', '02102462738', NULL,
         '2/52 WASHINGTON ROAD, NELSON'),

        ('54149831', '2025-01-12 19:58'::timestamp, 12, 6, 88.00::numeric, '587',
         '7 RENTONE ST LOUD MUSIC FROM 10 RENTONE STREET',
         'NO NOISE ON ARRIVAL',
         NULL, NULL, '7 RENTONE ST, NELSON',
         '10 RENTONE STREET, NELSON'),

        ('54149892', '2025-01-12 21:36'::timestamp, 11, 4, 88.00::numeric, '587',
         'PEOPLE IN TRAFALGAR PARK PLAYING LOUD MUSIC',
         'NO NOISE ON ARRIVAL IN CARPARK',
         'JOHN FRANCIS', '0272561971', '4 ELLIOTT STREET, THE WOOD, NELSON',
         'TRAFALGAR PARK, NELSON')
    ) AS t(
      dispatch_no,
      alarm_ts,
      response_mins,
      onsite_mins,
      charge_total,
      dispatch_zone,
      despatch_comments,
      follow_up,
      complainant_name,
      complainant_phone,
      complainant_address,
      offending_address
    )
  ),

  parsed_noise AS (
    SELECT
      r.*,
      CASE
        WHEN upper(coalesce(r.despatch_comments, '')) ~ '(PLATE|REGO|REGISTRATION)'
          THEN (
            regexp_match(
              upper(coalesce(r.despatch_comments, '') || ' ' || coalesce(r.follow_up, '')),
              '\m([A-Z]{2,3}[0-9]{2,4}|[A-Z0-9]{5,7})\M'
            )
          )[1]
        ELSE NULL
      END AS inferred_plate
    FROM raw_noise r
  ),

  offending_loi AS (
    INSERT INTO public.locations_of_interest (
      organization_id,
      display_address,
      city,
      country_code,
      notes,
      geocode_source,
      is_verified,
      is_active
    )
    SELECT DISTINCT
      v_org_id,
      r.offending_address,
      'Nelson',
      'NZ',
      'Imported from NCC Noise Control historical dispatch extract (offending location).',
      'manual',
      false,
      true
    FROM parsed_noise r
    WHERE r.offending_address IS NOT NULL AND btrim(r.offending_address) <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM public.locations_of_interest l
        WHERE l.organization_id = v_org_id
          AND lower(l.display_address) = lower(r.offending_address)
      )
    RETURNING id, display_address
  ),

  complainant_loi AS (
    INSERT INTO public.locations_of_interest (
      organization_id,
      display_address,
      city,
      country_code,
      notes,
      geocode_source,
      is_verified,
      is_active
    )
    SELECT DISTINCT
      v_org_id,
      r.complainant_address,
      'Nelson',
      'NZ',
      'Imported from NCC Noise Control historical dispatch extract (complainant location).',
      'manual',
      false,
      true
    FROM parsed_noise r
    WHERE r.complainant_address IS NOT NULL AND btrim(r.complainant_address) <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM public.locations_of_interest l
        WHERE l.organization_id = v_org_id
          AND lower(l.display_address) = lower(r.complainant_address)
      )
    RETURNING id, display_address
  ),

  poi_upsert AS (
    INSERT INTO public.persons_of_interest (
      organization_id,
      full_name,
      contact_phone,
      address,
      status,
      reason,
      notes,
      site_specific,
      active,
      privacy_notice_given,
      privacy_lawful_purpose,
      address_loi_id
    )
    SELECT DISTINCT
      v_org_id,
      r.complainant_name,
      r.complainant_phone,
      r.complainant_address,
      'poi',
      'noise_control_complainant',
      'Imported from NCC Noise Control historical data (dispatch ' || r.dispatch_no || ').',
      false,
      true,
      false,
      'Operational contact for noise complaint response and call-back workflow',
      (
        SELECT l.id
        FROM public.locations_of_interest l
        WHERE l.organization_id = v_org_id
          AND r.complainant_address IS NOT NULL
          AND lower(l.display_address) = lower(r.complainant_address)
        LIMIT 1
      )
    FROM parsed_noise r
    WHERE r.complainant_name IS NOT NULL AND btrim(r.complainant_name) <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM public.persons_of_interest p
        WHERE p.organization_id = v_org_id
          AND lower(p.full_name) = lower(r.complainant_name)
          AND coalesce(lower(p.contact_phone), '') = coalesce(lower(r.complainant_phone), '')
      )
    RETURNING id, full_name, contact_phone
  ),

  voi_upsert AS (
    INSERT INTO public.vehicles_of_interest (
      organization_id,
      plate_number,
      status,
      reason,
      notes,
      active,
      address_loi_id
    )
    SELECT DISTINCT
      v_org_id,
      r.inferred_plate,
      'voi',
      'noise_control_complainant_context',
      'Imported from NCC Noise Control historical data (dispatch ' || r.dispatch_no || ').',
      true,
      (
        SELECT l.id
        FROM public.locations_of_interest l
        WHERE l.organization_id = v_org_id
          AND r.complainant_address IS NOT NULL
          AND lower(l.display_address) = lower(r.complainant_address)
        LIMIT 1
      )
    FROM parsed_noise r
    WHERE r.inferred_plate IS NOT NULL AND btrim(r.inferred_plate) <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM public.vehicles_of_interest v
        WHERE v.organization_id = v_org_id
          AND upper(v.plate_number) = upper(r.inferred_plate)
      )
    RETURNING id, plate_number
  )

  INSERT INTO public.dispatch_jobs (
    organization_id,
    job_number,
    job_type,
    priority,
    title,
    description,
    caller_name,
    caller_phone,
    address,
    status,
    dispatched_at,
    on_scene_at,
    completed_at,
    completion_notes,
    response_sla_minutes,
    complainant_poi_id,
    complainant_voi_id,
    complainant_loi_id,
    offending_loi_id
  )
  SELECT
    v_org_id,
    'J-NCC-NOISE-' || r.dispatch_no,
    'noise_complaint',
    CASE WHEN r.response_mins >= 60 THEN 'high' ELSE 'normal' END,
    'NCC Noise Complaint ' || r.dispatch_no,
    r.despatch_comments,
    r.complainant_name,
    r.complainant_phone,
    r.offending_address,
    'completed',
    r.alarm_ts,
    r.alarm_ts + make_interval(mins => r.response_mins),
    r.alarm_ts + make_interval(mins => r.response_mins + r.onsite_mins),
    coalesce(r.follow_up, 'No follow-up note provided') ||
      E'\nCharge ex GST: ' || r.charge_total::text ||
      E'\nDispatch zone: ' || r.dispatch_zone,
    60,
    (
      SELECT p.id
      FROM public.persons_of_interest p
      WHERE p.organization_id = v_org_id
        AND r.complainant_name IS NOT NULL
        AND lower(p.full_name) = lower(r.complainant_name)
        AND coalesce(lower(p.contact_phone), '') = coalesce(lower(r.complainant_phone), '')
      ORDER BY p.created_at DESC
      LIMIT 1
    ),
    (
      SELECT v.id
      FROM public.vehicles_of_interest v
      WHERE v.organization_id = v_org_id
        AND r.inferred_plate IS NOT NULL
        AND upper(v.plate_number) = upper(r.inferred_plate)
      ORDER BY v.created_at DESC
      LIMIT 1
    ),
    (
      SELECT l.id
      FROM public.locations_of_interest l
      WHERE l.organization_id = v_org_id
        AND r.complainant_address IS NOT NULL
        AND lower(l.display_address) = lower(r.complainant_address)
      LIMIT 1
    ),
    (
      SELECT l.id
      FROM public.locations_of_interest l
      WHERE l.organization_id = v_org_id
        AND r.offending_address IS NOT NULL
        AND lower(l.display_address) = lower(r.offending_address)
      LIMIT 1
    )
  FROM parsed_noise r
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.dispatch_jobs d
    WHERE d.job_number = 'J-NCC-NOISE-' || r.dispatch_no
  );

  RAISE NOTICE 'NCC noise historical import completed with POI/LOI linkage.';
END $$;
