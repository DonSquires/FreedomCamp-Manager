-- =============================================================================
-- Seed: First Security national org, Nelson + Queenstown branches,
--       Nelson City Council and Downer/LINZ client orgs, and known sites.
--
-- Source data:  historical patrol exports provided 2026-05-14
-- Provenance:   First Security Nelson (FSG-NCC / FSGS-NSN-*)
--               First Security Queenstown (Downer/LINZ)
-- Idempotent:   uses INSERT … ON CONFLICT DO NOTHING throughout.
-- Safe to re-run after any environment reset.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: Stable UUIDs (used as cross-references throughout this file)
-- ─────────────────────────────────────────────────────────────────────────────
-- We use gen_random_uuid() seeded via a deterministic DO block so the IDs are
-- stable across re-runs. Because Postgres gen_random_uuid() is non-deterministic
-- we use named literal UUIDs and rely on ON CONFLICT DO NOTHING to keep them
-- safe on re-run.

DO $$
DECLARE
  v_fs_national_id   UUID := 'b8566654-4b1b-4cea-b55e-73791ec418ea';
  v_fs_nelson_id     UUID := '11111111-0001-0001-0001-000000000002';
  v_fs_queenstown_id UUID := '11111111-0001-0001-0001-000000000003';
  v_ncc_id           UUID := 'bd59679c-f0b5-4b4f-9cb6-847dfc3f5993';
  v_downer_linz_id   UUID := '57804ca8-ecc2-4b0b-91a7-3b54ad513191';

  -- Zone-dispatch codes extracted from real Nelson patrol data
  v_zone_585_id UUID := '22222222-0001-0001-0585-000000000001';  -- Nelson day shift
  v_zone_584_id UUID := '22222222-0001-0001-0584-000000000001';  -- Nelson night/alt shift
  v_zone_587_id UUID := '22222222-0001-0001-0587-000000000001';  -- Nelson noise control

BEGIN

  -- Guard: in long-lived environments these org names may already be linked in
  -- a hierarchy that would trigger loop checks when re-inserting branch parents.
  -- Skip this seed in that case to keep migration re-runnable.
  IF EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.name IN ('First Security', 'First Security Nelson', 'First Security Queenstown')
  ) THEN
    RAISE NOTICE 'First Security seed already present; skipping to avoid hierarchy loop on re-run.';
    RETURN;
  END IF;

  -- ── 1. First Security national (security_company / owner) ─────────────────
  INSERT INTO public.organizations
    (id, name, organization_type, organization_level, enforcement_workflow, is_active)
  VALUES
    (v_fs_national_id, 'First Security', 'security_company', 1, 'hybrid', true)
  ON CONFLICT (id) DO NOTHING;

  -- ── 2. First Security Nelson branch (service_provider, child of national) ──
  INSERT INTO public.organizations
    (id, name, organization_type, organization_level, parent_organization_id,
     address, enforcement_workflow, is_active)
  VALUES
    (v_fs_nelson_id, 'First Security Nelson', 'service_provider', 2,
     v_fs_national_id,
     'Nelson, Tasman, New Zealand', 'hybrid', true)
  ON CONFLICT (id) DO NOTHING;

  -- ── 3. First Security Queenstown branch (service_provider, child of national)
  INSERT INTO public.organizations
    (id, name, organization_type, organization_level, parent_organization_id,
     address, enforcement_workflow, is_active)
  VALUES
    (v_fs_queenstown_id, 'First Security Queenstown', 'service_provider', 2,
     v_fs_national_id,
     'Queenstown, Otago, New Zealand', 'hybrid', true)
  ON CONFLICT (id) DO NOTHING;

  -- ── 4. Nelson City Council (client, managed by First Security Nelson) ──────
  INSERT INTO public.organizations
    (id, name, organization_type, organization_level, parent_organization_id,
     address, enforcement_workflow, is_active)
  VALUES
    (v_ncc_id, 'Nelson City Council', 'client', 3, v_fs_nelson_id,
     'Civic House, 110 Trafalgar Street, Nelson 7010', 'admin_first', true)
  ON CONFLICT (id) DO NOTHING;

  -- ── 5. Downer / LINZ (client, managed by First Security Queenstown) ────────
  INSERT INTO public.organizations
    (id, name, organization_type, organization_level, parent_organization_id,
     address, enforcement_workflow, is_active)
  VALUES
    (v_downer_linz_id, 'Downer / LINZ', 'client', 3, v_fs_queenstown_id,
     'Queenstown, Otago, New Zealand', 'admin_first', true)
  ON CONFLICT (id) DO NOTHING;

  -- ── 6. Despatch zones (org = First Security Nelson) ───────────────────────
  -- These map to the "Despatch Zone" column in the patrol export (585, 584, 587).
  INSERT INTO public.zones
    (id, organization_id, name, description, is_active)
  VALUES
    (v_zone_585_id, v_fs_nelson_id,
     'Nelson Zone 585', 'Day-shift coverage zone (Nelson/Richmond/Motueka). Source: despatch zone 585.', true),
    (v_zone_584_id, v_fs_nelson_id,
     'Nelson Zone 584', 'Alternate/night coverage zone (Nelson area). Source: despatch zone 584.', true),
    (v_zone_587_id, v_fs_nelson_id,
     'Nelson Zone 587', 'Noise control zone (Nelson City Council). Source: despatch zone 587.', true)
  ON CONFLICT (id) DO NOTHING;

  -- ── 7. NCC client sites (sourced from Nelson patrol export client names) ───
  -- Site codes match the Client ID field from the dispatch export (NCC200 etc.)

  INSERT INTO public.client_sites
    (organization_id, zone_id, name, site_code, site_type,
     city, notes, is_active)
  VALUES
    -- Bureau FSG-NCC patrol sites
    (v_ncc_id, v_zone_585_id, 'The Refinery', 'NCC200',
     'general', 'Nelson',
     'Serviced under Nelson City Council security contract (FSG-NCC). Zone 585.', true),

    (v_ncc_id, v_zone_585_id, 'EX 4 Seasons', 'NCC400',
     'general', 'Nelson',
     'Serviced under Nelson City Council security contract (FSG-NCC). Zone 585.', true),

    (v_ncc_id, v_zone_585_id, 'Nayland College', 'NA5661',
     'general', 'Nelson',
     'Serviced under Nelson alarm response contract (FSGS-NSN-AR-DB). Zone 584/585. '
     || 'Missed patrols recorded — review scheduling.', true),

    (v_ncc_id, v_zone_585_id, 'Fulton Hogan Nelson', NULL,
     'infrastructure', 'Nelson',
     'Infrastructure client. Incident reports recorded (unlocked equipment). Zone 585.', true),

    -- Washington Valley sites observed in zone 585
    (v_ncc_id, v_zone_585_id, 'Washington Valley Reserve', NULL,
     'freedom_camping', 'Nelson',
     'Freedom camping patrol site — Nelson City Council bylaw jurisdiction. Zone 585.', true),

    -- Noise control sites (zone 587)
    (v_ncc_id, v_zone_587_id, 'Nelson Noise Control Patrol Area', 'NCCNOISE',
     'noise_control', 'Nelson',
     'NCC noise control contract (FSGS-NSN-NCO or NCCNOISE bureau). Zone 587.', true)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'First Security org/branch/client/site seed complete.';
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RAISE NOTICE 'First Security seed skipped due to existing hierarchy loop guard: %', SQLERRM;
END $$;

-- =============================================================================
-- TEMPLATE COMMENT — how to replicate this pattern for another organisation
-- =============================================================================
-- To onboard a new national security company and its clients:
--
-- 1. Add the national org (organization_type = 'security_company', level 1).
-- 2. Add each branch (organization_type = 'service_provider', level 2,
--    parent_organization_id = national org).
-- 3. Add each client council/crown entity (organization_type = 'client',
--    level 3, parent_organization_id = responsible branch).
-- 4. Add despatch zones (organization_id = branch, name from dispatch zone code).
-- 5. Add client_sites (organization_id = client, zone_id = matching zone,
--    site_code = client ID from dispatch export, site_type as appropriate).
--
-- Photo reingest:   run /photo-reingest scoped to the branch org to recover
--                   freedom camping observations from stored trial photos.
-- Historical import: use /import-historical with source_system = 'First Security'
--                   and client/bureau provenance to backfill patrol/alarm rows.
-- =============================================================================
