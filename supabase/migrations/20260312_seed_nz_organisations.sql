-- ============================================================================
-- Seed: NZ Territorial Authorities, Regional Councils & Crown Entities
-- Date: 2026-03-12
--
-- Iron Eagle Security (Level 1 Owner) and First Security (Level 2 Service
-- Provider) may already exist. If First Security is missing, this migration
-- will create it before seeding client organisations.
--
-- This migration idempotently inserts all 78+ NZ organisations as Level-3
-- client organisations whose parent is First Security, then calls
-- ensure_other_location_zone() for each so that every organisation has its
-- default "Other Location" zone ready for field officers.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_first_security_id  uuid;
  v_owner_org_id       uuid;
  v_org                record;
  v_inserted           integer := 0;
  v_zones_called       integer := 0;
  v_backfilled         integer := 0;

  -- Full list of NZ Territorial Authorities, Regional Councils & Crown Entities
  v_orgs text[] := ARRAY[
    -- Territorial Authorities
    'Auckland Council',
    'Bay of Plenty Regional Council',
    'Canterbury Regional Council',
    'Christchurch City Council',
    'Clutha District Council',
    'Dunedin City Council',
    'Far North District Council',
    'Gisborne District Council',
    'Gore District Council',
    'Grey District Council',
    'Hamilton City Council',
    'Hastings District Council',
    'Hauraki District Council',
    'Horowhenua District Council',
    'Hurunui District Council',
    'Hutt City Council',
    'Invercargill City Council',
    'Kaikōura District Council',
    'Kapiti Coast District Council',
    'Kawerau District Council',
    'Mackenzie District Council',
    'Manawatu District Council',
    'Marlborough District Council',
    'Masterton District Council',
    'Matamata-Piako District Council',
    'Napier City Council',
    'Nelson City Council',
    'New Plymouth District Council',
    'Ōpōtiki District Council',
    'Ōtorohanga District Council',
    'Palmerston North City Council',
    'Porirua City Council',
    'Queenstown-Lakes District Council',
    'Rangitīkei District Council',
    'Rotorua Lakes Council',
    'Ruapehu District Council',
    'Selwyn District Council',
    'South Taranaki District Council',
    'South Waikato District Council',
    'South Wairarapa District Council',
    'Southland District Council',
    'Stratford District Council',
    'Tararua District Council',
    'Tasman District Council',
    'Taupō District Council',
    'Tauranga City Council',
    'Thames-Coromandel District Council',
    'Timaru District Council',
    'Upper Hutt City Council',
    'Waikato District Council',
    'Waikato Regional Council',
    'Waimakariri District Council',
    'Waimate District Council',
    'Waipa District Council',
    'Wairoa District Council',
    'Waitaki District Council',
    'Waitomo District Council',
    'Wellington City Council',
    'Western Bay of Plenty District Council',
    'Westland District Council',
    'Whakatāne District Council',
    'Whanganui District Council',
    'Whangarei District Council',
    -- Additional Regional Councils
    'Hawke''s Bay Regional Council',
    'Horizons Regional Council',
    'Northland Regional Council',
    'Otago Regional Council',
    'Southland Regional Council',
    'Taranaki Regional Council',
    'Wellington Regional Council',
    'West Coast Regional Council',
    -- Additional Territorial Authorities
    'Buller District Council',
    'Carterton District Council',
    'Central Hawkes Bay District Council',
    'Central Otago District Council',
    -- Crown Entities
    'Department of Conservation (DOC)',
    'LINZ - Land Information New Zealand'
  ];

BEGIN
  -- -------------------------------------------------------------------------
  -- 1. Resolve First Security ID (create if missing)
  -- -------------------------------------------------------------------------
  SELECT id INTO v_first_security_id
  FROM organizations
  WHERE name = 'First Security'
  LIMIT 1;

  IF v_first_security_id IS NULL THEN
    SELECT id INTO v_owner_org_id
    FROM organizations
    WHERE name IN ('Iron Eagle Security', 'Iron Eagle')
    ORDER BY name
    LIMIT 1;

    INSERT INTO organizations (
      name,
      organization_type,
      organization_level,
      parent_organization_id,
      is_active
    ) VALUES (
      'First Security',
      'service_provider',
      2,
      v_owner_org_id,
      true
    )
    ON CONFLICT (name) DO NOTHING;

    SELECT id INTO v_first_security_id
    FROM organizations
    WHERE name = 'First Security'
    LIMIT 1;

    IF v_first_security_id IS NULL THEN
      RAISE EXCEPTION
        'Unable to resolve or create First Security organisation.';
    END IF;

    RAISE NOTICE 'Created missing First Security organisation: %', v_first_security_id;
  END IF;

  RAISE NOTICE 'First Security ID: %', v_first_security_id;

  -- -------------------------------------------------------------------------
  -- 2. Insert organisations that do not already exist (by name)
  -- -------------------------------------------------------------------------
  INSERT INTO organizations (
    name,
    organization_type,
    organization_level,
    parent_organization_id,
    is_active
  )
  SELECT
    org_name,
    'client',
    3,
    v_first_security_id,
    true
  FROM unnest(v_orgs) AS org_name
  WHERE NOT EXISTS (
    SELECT 1 FROM organizations WHERE name = org_name
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE '✅ Organisations inserted: %, already existed (skipped): %',
               v_inserted,
               array_length(v_orgs, 1) - v_inserted;

  -- -------------------------------------------------------------------------
  -- 3. Backfill hierarchy fields for any orgs that already existed but were
  --    not yet linked to First Security as Level-3 clients
  -- -------------------------------------------------------------------------
  UPDATE organizations
  SET
    organization_type      = 'client',
    organization_level     = 3,
    parent_organization_id = v_first_security_id
  WHERE name = ANY(v_orgs)
    AND (
      organization_level     IS DISTINCT FROM 3
      OR organization_type   IS DISTINCT FROM 'client'
      OR parent_organization_id IS DISTINCT FROM v_first_security_id
    );

  GET DIAGNOSTICS v_backfilled = ROW_COUNT;
  IF v_backfilled > 0 THEN
    RAISE NOTICE '✅ Backfilled hierarchy for % pre-existing organisations', v_backfilled;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4. Ensure every org has an "Other Location" zone
  -- -------------------------------------------------------------------------
  FOR v_org IN
    SELECT id, name
    FROM organizations
    WHERE name = ANY(v_orgs)
    ORDER BY name
  LOOP
    PERFORM ensure_other_location_zone(v_org.id);
    v_zones_called := v_zones_called + 1;
  END LOOP;

  RAISE NOTICE '✅ ensure_other_location_zone() called for % organisations', v_zones_called;
  RAISE NOTICE '✅ 20260312_seed_nz_organisations applied successfully';

END;
$$;

COMMIT;
