-- ============================================================================
-- First Security Nelson – 134 Client Locations with Zones & Geofences
-- Date: 2026-06-05
--
-- Adds every location in the "NSN" roster (plus the non-prefixed top entries)
-- as a direct client organisation under the "First Security - Nelson" branch,
-- then creates a zone with a GeoJSON polygon geofence and a client_site record
-- for each location.
--
-- Coordinates sourced from real NZ addresses (banks, courts, hospitals, etc.)
-- and from city-centre approximations for lesser-known sites.  Polygon sizes
-- are proportional to the physical footprint of each site:
--   • small  buildings (banks, shops)     ≈ ±33 m  (dlat=0.0003, dlng=0.0004)
--   • medium buildings (schools, halls)   ≈ ±67 m  (dlat=0.0006, dlng=0.0008)
--   • large  sites (hospitals, stadiums)  ≈ ±110 m (dlat=0.001,  dlng=0.0013)
--   • patrol routes / very large areas    ≈ ±5 km  (dlat=0.05,   dlng=0.065)
-- ============================================================================

DO $$
DECLARE
  v_nelson_id   UUID;
  v_org_id      UUID;
  v_zone_id     UUID;
  rec           RECORD;
BEGIN

  -- ── Resolve First Security - Nelson branch ──────────────────────────────────
  SELECT id INTO v_nelson_id
  FROM   public.organizations
  WHERE  name = 'First Security - Nelson'
  LIMIT  1;

  IF v_nelson_id IS NULL THEN
    -- Fallback: any First Security service_provider
    SELECT id INTO v_nelson_id
    FROM   public.organizations
    WHERE  lower(name) LIKE '%first security%'
      AND  organization_type = 'service_provider'
    ORDER  BY organization_level, created_at
    LIMIT  1;
  END IF;

  IF v_nelson_id IS NULL THEN
    RAISE EXCEPTION '❌  First Security - Nelson organisation not found; aborting.';
  END IF;

  -- ── Loop over location data ─────────────────────────────────────────────────
  --
  -- Columns: loc_name, site_type, lat, lng, dlat, dlng, address, city, areas_note
  --   dlat / dlng are the half-widths of the bounding-box polygon.
  FOR rec IN
    SELECT *
    FROM (VALUES

      -- ── Branch / Internal ────────────────────────────────────────────────────
      ('6600-Nelson',
       'guarding', -41.3080, 173.2630, 0.0003, 0.0004,
       '13 Forests Road', 'Stoke',
       'Branch Staff; BNZ Nelson; Original time'),

      ('CHC: Spark - R-GREY',
       'commercial', -43.5330, 172.6360, 0.0003, 0.0004,
       'Regent Street', 'Christchurch',
       'Ordinary Time'),

      -- ── Patrol Routes ────────────────────────────────────────────────────────
      ('NSN: 582 Nelson CC Patrol',
       'guarding', -41.2706, 173.2840, 0.05, 0.065,
       'Nelson City patrol area', 'Nelson',
       'Patrols; Site Inducted'),

      ('NSN: 583 FSO On-Call',
       'guarding', -41.3080, 173.2630, 0.0003, 0.0004,
       '13 Forests Road', 'Stoke',
       'On-Call'),

      ('NSN: 583 Motueka',
       'guarding', -41.1233, 173.0107, 0.05, 0.065,
       'Motueka patrol area', 'Motueka',
       'Patrols'),

      ('NSN: 583 Motueka (Nelson)',
       'guarding', -41.1233, 173.0107, 0.05, 0.065,
       'Motueka / Nelson patrol area', 'Motueka',
       'Patrols'),

      ('NSN: 584',
       'guarding', -41.2706, 173.2840, 0.05, 0.065,
       'Nelson 584 patrol area', 'Nelson',
       'Patrols; Ordinary Time; MOBIL PATROL - 584'),

      ('NSN: 584 Stoke',
       'guarding', -41.3080, 173.2630, 0.03, 0.04,
       'Stoke patrol area', 'Stoke',
       'Ordinary Time; MOBIL PATROL - 584; Patrols'),

      ('NSN: 585 Day Patrol',
       'guarding', -41.2706, 173.2840, 0.05, 0.065,
       'Nelson 585 day-patrol area', 'Nelson',
       'Patrols; EMS; On Call; Non Billable; Training'),

      ('NSN: 586',
       'guarding', -41.2706, 173.2840, 0.05, 0.065,
       'Nelson 586 patrol area', 'Nelson',
       'Patrols; MOBILE PATROL OFFICER; Training - 586'),

      ('NSN: 586 Tasman',
       'guarding', -41.2706, 173.2840, 0.07, 0.09,
       'Tasman district patrol area', 'Nelson',
       'NCR; MOBILE PATROL OFFICER; Patrols'),

      ('NSN: 587',
       'guarding', -41.2706, 173.2840, 0.05, 0.065,
       'Nelson 587 patrol area', 'Nelson',
       'MOBILE PATROL OFFICER; Patrols'),

      ('NSN: 587 Nelson',
       'guarding', -41.2706, 173.2840, 0.05, 0.065,
       'Nelson 587 patrol area', 'Nelson',
       'MOBILE PATROL OFFICER; Training; Patrols'),

      -- ── Commercial & Professional Services ───────────────────────────────────
      ('NSN: Alfred Taylor Developments LTD',
       'commercial', -41.2706, 173.2840, 0.0003, 0.0004,
       'Nelson CBD', 'Nelson',
       'Ordinary Time'),

      ('NSN: Aon Blenheim',
       'commercial', -41.5133, 173.9560, 0.0003, 0.0004,
       'Blenheim CBD', 'Blenheim',
       'Ordinary Time; CANCELLED'),

      ('NSN: Chorus nelson/tasman',
       'infrastructure', -41.2706, 173.2840, 0.0006, 0.0008,
       'Nelson CBD', 'Nelson',
       'Ordinary Time'),

      ('NSN: Coastal View Lifestyle Village',
       'general', -41.2706, 173.2840, 0.0006, 0.0008,
       'Nelson', 'Nelson',
       'Ordinary Time'),

      ('NSN: Dan Feisst- Tahunanui Beach',
       'general', -41.3010, 173.2280, 0.0006, 0.0008,
       'Tahunanui Beach', 'Nelson',
       'Ordinary Time; Cancelled'),

      ('NSN: David Levinsohn - 574 Riwaka Valley Road',
       'general', -41.0850, 172.9700, 0.0006, 0.0008,
       '574 Riwaka Valley Road', 'Riwaka',
       'Ordinary Time; Chargeable Travel Time'),

      ('NSN: Dummy Profile (Locations)',
       'general', -41.2706, 173.2840, 0.0003, 0.0004,
       'Nelson', 'Nelson',
       'Ordinary Time'),

      ('NSN: Ernest Rutherford Retirement Village',
       'general', -41.2706, 173.2840, 0.0006, 0.0008,
       'Nelson', 'Nelson',
       'Ordinary Time'),

      ('NSN: Event Hire - Inflatablez',
       'event', -41.2630, 173.2987, 0.0006, 0.0008,
       '87 Atawhai Drive', 'Nelson',
       'Founders Heritage Park'),

      ('NSN: Ground Breaking Contracting',
       'infrastructure', -41.2706, 173.2840, 0.0006, 0.0008,
       'Railway Site - off Nealve, Marden Road', 'Nelson',
       'Ordinary Time'),

      ('NSN: IAG Nelson',
       'commercial', -41.2706, 173.2840, 0.0003, 0.0004,
       'Nelson CBD', 'Nelson',
       'Ordinary Time'),

      ('NSN: Kartsport Nelson',
       'event', -41.2706, 173.2840, 0.001, 0.0013,
       'Nelson', 'Nelson',
       'Ordinary Time'),

      ('NSN: Kirby Lane',
       'general', -41.2706, 173.2840, 0.0003, 0.0004,
       'Nelson CBD', 'Nelson',
       'Ordinary Time'),

      ('NSN: Kitchen Things',
       'commercial', -41.2706, 173.2840, 0.0003, 0.0004,
       'Nelson CBD', 'Nelson',
       'Ordinary Time'),

      ('NSN: Macpac Nelson',
       'commercial', -41.2704, 173.2838, 0.0003, 0.0004,
       '126 Trafalgar Street', 'Nelson',
       'Ordinary Time'),

      ('NSN: Mapua Community Hall',
       'event', -41.2450, 173.0600, 0.0006, 0.0008,
       'Mapua Community Hall', 'Mapua',
       'Ordinary Time'),

      ('NSN: NBS',
       'commercial', -41.2706, 173.2840, 0.0003, 0.0004,
       'Nelson CBD', 'Nelson',
       'Ordinary Time'),

      ('NSN: NBS Motueka Branch',
       'commercial', -41.1233, 173.0107, 0.0003, 0.0004,
       'High Street', 'Motueka',
       'Ordinary Time'),

      ('NSN: Neighbourhood Events',
       'event', -41.2706, 173.2840, 0.0006, 0.0008,
       'Various Nelson venues', 'Nelson',
       'Urban Wine Walk - various venues'),

      ('NSN: New Zealand First - various locations',
       'event', -41.2706, 173.2840, 0.0006, 0.0008,
       'Various Nelson venues', 'Nelson',
       'Rutherford Hotel; The Westport NBS Theatre'),

      ('NSN: NZ Jewish Community Security Group Charitable',
       'event', -41.2706, 173.2840, 0.0006, 0.0008,
       'Various Nelson venues', 'Nelson',
       'Scenic Circle Hotel; 32 Bridge St; Founders Park; 87 Atawhai Drive'),

      ('NSN: Omoto Racecourse',
       'event', -42.4500, 171.2100, 0.005, 0.006,
       'Omoto Racecourse', 'Greymouth',
       'Ordinary Time; Travel'),

      ('NSN: Otumarama Care Centre',
       'general', -41.2706, 173.2840, 0.0006, 0.0008,
       'Nelson', 'Nelson',
       'Ordinary Time'),

      ('NSN: Postie Richmond',
       'commercial', -41.3400, 173.1740, 0.0003, 0.0004,
       'Richmond', 'Richmond',
       'Ordinary Time'),

      ('NSN: Scott Construction Limited',
       'infrastructure', -41.2706, 173.2840, 0.0006, 0.0008,
       'Nelson', 'Nelson',
       'Ordinary Time'),

      ('NSN: Seafarers Memorial',
       'general', -41.2706, 173.2840, 0.0003, 0.0004,
       'Nelson waterfront', 'Nelson',
       'Ordinary Time'),

      ('NSN: Sophie McLaren & Williams Findlay',
       'commercial', -41.2706, 173.2840, 0.0003, 0.0004,
       'Nelson CBD', 'Nelson',
       'Ordinary'),

      ('NSN: Summerset in the Sun',
       'general', -41.2706, 173.2840, 0.0006, 0.0008,
       'Nelson', 'Nelson',
       'Ordinary Time'),

      ('NSN: Sunderland Marine Pier',
       'infrastructure', -41.2706, 173.2840, 0.0006, 0.0008,
       'Nelson harbour', 'Nelson',
       'Ordinary Time'),

      ('NSN: Tasman Bay Cruising Club',
       'general', -41.2706, 173.2840, 0.0006, 0.0008,
       'Nelson Marina', 'Nelson',
       'Ordinary Time'),

      ('NSN: Wahi Oranga',
       'general', -41.3000, 173.2200, 0.0006, 0.0008,
       'Nelson', 'Nelson',
       'Mental health facility'),

      -- ── Banks ────────────────────────────────────────────────────────────────
      ('NSN: ANZ Blenheim',
       'commercial', -41.5133, 173.9556, 0.0003, 0.0004,
       '40-42 Market Street', 'Blenheim',
       'Ordinary Time'),

      ('NSN: ANZ Motueka',
       'commercial', -41.1237, 173.0102, 0.0003, 0.0004,
       '296 High Street', 'Motueka',
       'Ordinary Time'),

      ('NSN: ANZ Nelson',
       'commercial', -41.2744, 173.2830, 0.0003, 0.0004,
       '248 Trafalgar Street', 'Nelson',
       'Ordinary Time; Non Billable'),

      ('NSN: ANZ Richmond',
       'commercial', -41.3360, 173.1833, 0.0003, 0.0004,
       '258 Queen Street', 'Richmond',
       'Ordinary Time'),

      ('NSN: ASB Blenheim',
       'commercial', -41.5134, 173.9586, 0.0003, 0.0004,
       '17 Queen Street', 'Blenheim',
       'Ordinary Time; Travel time; CANCELLED'),

      ('NSN: ASB Nelson',
       'commercial', -41.2704, 173.2838, 0.0003, 0.0004,
       '220 Trafalgar Street', 'Nelson',
       'Ordinary Time'),

      ('NSN: ASB Richmond',
       'commercial', -41.3373, 173.1831, 0.0003, 0.0004,
       '288 Queen Street', 'Richmond',
       'Christmas Hours; Ordinary Time; CANCELLED'),

      ('NSN: BNZ Nelson',
       'commercial', -41.2701, 173.2842, 0.0003, 0.0004,
       '226 Trafalgar Street', 'Nelson',
       'Ordinary Time'),

      ('NSN: Kiwibank Blenheim',
       'commercial', -41.5133, 173.9560, 0.0003, 0.0004,
       '3 Scott Street', 'Blenheim',
       'Ordinary Time; Non Billable'),

      ('NSN: Kiwibank Motueka',
       'commercial', -41.1250, 173.0110, 0.0003, 0.0004,
       '151 High Street', 'Motueka',
       'Ordinary Time'),

      ('NSN: Kiwibank Nelson',
       'commercial', -41.2710, 173.2820, 0.0003, 0.0004,
       '209 Hardy Street', 'Nelson',
       'Ordinary Time; CANCELLED; Non billable'),

      ('NSN: Kiwibank Nelson OLD',
       'commercial', -41.2710, 173.2822, 0.0003, 0.0004,
       'Hardy Street (old premises)', 'Nelson',
       'Historical record'),

      ('NSN: Kiwibank Picton KSA',
       'commercial', -41.2897, 173.9573, 0.0003, 0.0004,
       '100 High Street (Mariners Mall)', 'Picton',
       'Ordinary Time'),

      ('NSN: The Co-operative Bank Blenheim',
       'commercial', -41.5133, 173.9560, 0.0003, 0.0004,
       'Blenheim CBD', 'Blenheim',
       'Ordinary Time; Travel Time'),

      ('NSN: The Co-Operative Bank Nelson',
       'commercial', -41.2706, 173.2840, 0.0003, 0.0004,
       'Nelson CBD', 'Nelson',
       'Ordinary Time'),

      ('NSN: Westpac Nelson',
       'commercial', -41.2703, 173.2842, 0.0003, 0.0004,
       '168 Trafalgar Street', 'Nelson',
       'Ordinary Time'),

      ('NSN: Westpac Richmond',
       'commercial', -41.3373, 173.1827, 0.0003, 0.0004,
       '216 Queen Street', 'Richmond',
       'Ordinary Time'),

      -- ── Telecom / Tech ───────────────────────────────────────────────────────
      ('NSN: 2 Degrees Nelson',
       'commercial', -41.2706, 173.2840, 0.0003, 0.0004,
       'Nelson CBD', 'Nelson',
       'CANCELLED; Ordinary Time; Non Billable'),

      ('NSN: 2 Degrees Richmond',
       'commercial', -41.3400, 173.1740, 0.0003, 0.0004,
       'Richmond', 'Richmond',
       'Ordinary Time'),

      ('NSN: Spark Retail Blenheim',
       'commercial', -41.5133, 173.9562, 0.0003, 0.0004,
       '66 Market Street', 'Blenheim',
       'Ordinary Time; Travel time'),

      ('NSN: Spark Retail Nelson',
       'commercial', -41.2710, 173.2820, 0.0003, 0.0004,
       '204 Hardy Street', 'Nelson',
       'Ordinary Time'),

      ('NSN: Spark Richmond Mall',
       'commercial', -41.3400, 173.1750, 0.0003, 0.0004,
       'Richmond Mall, Croucher Street', 'Richmond',
       'Ordinary Time'),

      -- ── Retail ───────────────────────────────────────────────────────────────
      ('NSN: Briscoes Blenheim',
       'commercial', -41.5170, 173.9520, 0.0006, 0.0008,
       'Blenheim retail area', 'Blenheim',
       'Ordinary Time'),

      ('NSN: Bunnings Nelson',
       'commercial', -41.3100, 173.2580, 0.001, 0.0013,
       '76 Saxton Road East', 'Stoke',
       'Ordinary Time'),

      ('NSN: Harvey Norman Blenheim',
       'commercial', -41.5195, 173.9636, 0.001, 0.0013,
       '19-21 Maxwell Road', 'Blenheim',
       'Ordinary Time; Black Friday/Boxing Day; Travel'),

      ('NSN: Harvey Norman Nelson',
       'commercial', -41.3100, 173.2630, 0.001, 0.0013,
       'Stoke retail area', 'Stoke',
       'Black Friday Weekend; Boxing Day'),

      ('NSN: Kmart Blenheim',
       'commercial', -41.5200, 173.9510, 0.001, 0.0013,
       'Corner Main Street & Opawa Road', 'Blenheim',
       'Xmas Schedule; Ordinary Time'),

      ('NSN: Kmart Richmond',
       'commercial', -41.3400, 173.1760, 0.001, 0.0013,
       'Corner Lower Queen Street & McGlashen Avenue', 'Richmond',
       'Xmas Schedule; Contractor Works; Training'),

      -- ── Fuel ─────────────────────────────────────────────────────────────────
      ('NSN: Z Energy Picton',
       'commercial', -41.2897, 173.9573, 0.0003, 0.0004,
       '75 High Street', 'Picton',
       'Ordinary Time'),

      ('NSN: Z Redwood Blenheim',
       'commercial', -41.5195, 173.9636, 0.0003, 0.0004,
       '41 Grove Road', 'Blenheim',
       'Ordinary Time'),

      ('NSN: Z Stoke',
       'commercial', -41.3090, 173.2550, 0.0003, 0.0004,
       '666-668 Main Road', 'Stoke',
       'Ordinary Time'),

      -- ── Government ───────────────────────────────────────────────────────────
      ('NSN: IRD Halifax St (AOTEA)',
       'government', -41.2690, 173.2860, 0.0006, 0.0008,
       'Halifax Street', 'Nelson',
       'Ordinary Time'),

      ('NSN: IRD Trafalgar St (AOTEA)',
       'government', -41.2706, 173.2840, 0.0006, 0.0008,
       'Trafalgar Street', 'Nelson',
       'Ordinary Time'),

      ('NSN: MBIE Mediation - Blenheim',
       'government', -41.5132, 173.9580, 0.0006, 0.0008,
       'Secnic Hotel Marlborough / Pernod Ricard area', 'Blenheim',
       'Secnic Hotel Marlborough; Ordinary Time; Pernod Ricard Winemakers'),

      ('NSN: MBIE Mediation - Nelson',
       'government', -41.2706, 173.2840, 0.0006, 0.0008,
       'Various Nelson venues', 'Nelson',
       'Clifford House (Level 1); The Hotel Nelson; Tides Hotel'),

      ('NSN: Ministry Of Education Nelson',
       'government', -41.2706, 173.2840, 0.0006, 0.0008,
       'Nelson CBD', 'Nelson',
       'Ordinary Time'),

      ('NSN: MOJ Blenheim District Court',
       'government', -41.5148, 173.9622, 0.0006, 0.0008,
       '58 Alfred Street', 'Blenheim',
       'Site Inducted; CANCELLED'),

      ('NSN: MOJ Nelson District Court',
       'government', -41.2750, 173.2843, 0.0006, 0.0008,
       '200 Bridge Street', 'Nelson',
       'Ordinary Time; Cancellation'),

      ('NSN: Murchison Town Centre - NZDF',
       'government', -41.7965, 172.3328, 0.0006, 0.0008,
       'Murchison town centre', 'Murchison',
       'Ordinary Time'),

      ('NSN: Nelson Tasman Emergency Management',
       'government', -41.2706, 173.2840, 0.0006, 0.0008,
       'Nelson', 'Nelson',
       'Original time'),

      ('NSN: NZDF (Murchison or Springs)',
       'government', -41.7965, 172.3328, 0.003, 0.004,
       'Murchison / Springs Junction area', 'Murchison',
       'Site Inducted'),

      ('NSN: Parking Warden Blenheim',
       'parking', -41.5130, 173.9550, 0.02, 0.025,
       'Blenheim CBD', 'Blenheim',
       'Parking enforcement'),

      ('NSN: Parking Warden Blenheim SO',
       'parking', -41.5130, 173.9550, 0.02, 0.025,
       'Blenheim CBD', 'Blenheim',
       'Alpha; Bravo; Charlie; Training'),

      ('NSN: Parking Warden Blenheim SUP',
       'parking', -41.5130, 173.9555, 0.0006, 0.0008,
       'NZTA Office, Blenheim', 'Blenheim',
       'Supervisor; NZTA Office; Training'),

      ('NSN: RNZAF Base Woodbourne',
       'government', -41.5083, 173.8700, 0.005, 0.006,
       'Middle Renwick Road (SH6)', 'Blenheim',
       'Site Inducted; Cancelled; Training'),

      -- ── Health ───────────────────────────────────────────────────────────────
      ('NSN: EMS Blenheim',
       'general', -41.5130, 173.9550, 0.001, 0.0013,
       'Blenheim', 'Blenheim',
       'EMS Oncall; EMS; Training'),

      ('NSN: EMS Nelson',
       'general', -41.3080, 173.2630, 0.001, 0.0013,
       'Stoke, Nelson', 'Stoke',
       'EMS Nelson FSO On-Call; On Call; Non Billable; Patrols; EMS'),

      ('NSN: Nelson Hosp Emergency Room',
       'general', -41.2992, 173.2183, 0.001, 0.0013,
       'Waimea Road, Annesbrook', 'Nelson',
       'Emergency Room'),

      ('NSN: NMDHB',
       'general', -41.2992, 173.2183, 0.001, 0.0013,
       'Waimea Road, Annesbrook', 'Nelson',
       'Medical unit; Nelson static; Wairau static; Maternity Ward; Mental health - NHMW'),

      ('NSN: NMDHB Nelson Hospital',
       'general', -41.2992, 173.2183, 0.001, 0.0013,
       'Waimea Road, Annesbrook', 'Nelson',
       'Summer Surge - ED; Mental Health; Medical Unit; Training; Travel Time'),

      ('NSN: NMDHB Wairau Hospital',
       'general', -41.5225, 173.9500, 0.001, 0.0013,
       '30 Hospital Road, Witherlea', 'Blenheim',
       'Summer Surge - ED; Patient Watch; ED Department; Maternity Ward; Travel Time'),

      ('NSN: Te Whatu Ora - Wairau Hospital (Blenheim)',
       'general', -41.5225, 173.9500, 0.001, 0.0013,
       '30 Hospital Road, Witherlea', 'Blenheim',
       'Hospital services'),

      ('NSN: Wairau Hospital Patient watch',
       'general', -41.5225, 173.9500, 0.001, 0.0013,
       '30 Hospital Road, Witherlea', 'Blenheim',
       'Patient watch'),

      -- ── Education ────────────────────────────────────────────────────────────
      ('NSN: Broadgreen Intermediate',
       'general', -41.3055, 173.2605, 0.0006, 0.0008,
       '193 Nayland Road', 'Stoke',
       'Ordinary Time'),

      ('NSN: Nelson Intermidiate School',
       'general', -41.2720, 173.2950, 0.0006, 0.0008,
       '112 Tipahi Street', 'Nelson',
       'Ordinary Time'),

      ('NSN: Omaka Early Learning Centre',
       'general', -41.5298, 173.9215, 0.0006, 0.0008,
       'Omaka, Blenheim', 'Blenheim',
       'Ordinary Time'),

      -- ── Recreation & Sport ───────────────────────────────────────────────────
      ('NSN: Nayland Pool',
       'general', -41.3025, 173.2604, 0.0006, 0.0008,
       '192 Nayland Road', 'Nelson',
       'Ordinary Time'),

      ('NSN: Motueka Recreation Centre',
       'general', -41.1233, 173.0107, 0.0006, 0.0008,
       'Motueka', 'Motueka',
       'Ordinary Time'),

      ('NSN: Pollard Park',
       'general', -41.5097, 173.9631, 0.001, 0.0013,
       'Blenheim', 'Blenheim',
       'Travel; Ordinary Time'),

      ('NSN: Saxton Stadium',
       'event', -41.3064, 173.2612, 0.001, 0.0013,
       '142 Saxton Road', 'Stoke',
       'Ordinary Time'),

      -- ── Arts, Culture & Heritage ─────────────────────────────────────────────
      ('NSN: Founders Heritage Park',
       'event', -41.2630, 173.2987, 0.001, 0.0013,
       '87 Atawhai Drive', 'Nelson',
       'Ordinary Time'),

      ('NSN: Holocaust Centre - Puna Wai Hockey Stadium',
       'event', -41.2706, 173.2840, 0.001, 0.0013,
       'Nelson', 'Nelson',
       'Ordinary Time'),

      ('NSN: Holocaust Centre - Rutherford Hotel',
       'event', -41.2719, 173.2845, 0.0006, 0.0008,
       '27 Nile Street West', 'Nelson',
       'Ordinary Time'),

      ('NSN: Provincial Museum Nelson',
       'general', -41.2706, 173.2840, 0.0006, 0.0008,
       'Corner Trafalgar Street & Hardy Street', 'Nelson',
       'Ordinary Time'),

      ('NSN: Suter Art Gallery',
       'general', -41.2745, 173.2840, 0.0006, 0.0008,
       '208 Bridge Street', 'Nelson',
       'Ordinary Time'),

      ('NSN: Theatre Royal Nelson',
       'event', -41.2715, 173.2844, 0.0006, 0.0008,
       '78 Rutherford Street', 'Nelson',
       'Ordinary Time'),

      -- ── Parks, Holiday Reserves & Outdoor ────────────────────────────────────
      ('NSN: Brook Valley Holiday Reserve',
       'freedom_camping', -41.2560, 173.2750, 0.003, 0.004,
       'Brook Valley', 'Nelson',
       'Ordinary Time'),

      ('NSN: Maitai Valley Holiday Park',
       'freedom_camping', -41.2560, 173.3200, 0.003, 0.004,
       'Maitai Valley', 'Nelson',
       'Ordinary Time'),

      -- ── Hospitality ──────────────────────────────────────────────────────────
      ('NSN: Chateau Marlborough Hotel',
       'general', -41.5132, 173.9580, 0.0006, 0.0008,
       '95-117 High Street', 'Blenheim',
       'Shift work'),

      ('NSN: Rutherford Hotel',
       'general', -41.2719, 173.2845, 0.0006, 0.0008,
       '27 Nile Street West', 'Nelson',
       'Ordinary Time'),

      ('NSN: Sudima Kaikoura',
       'general', -42.4001, 173.6803, 0.0006, 0.0008,
       'Kaikoura', 'Kaikoura',
       'Ordinary Time'),

      -- ── NCR / ATM Services ───────────────────────────────────────────────────
      ('NSN: NCR - Blenheim FLM&2UP',
       'commercial', -41.5130, 173.9550, 0.0006, 0.0008,
       'Blenheim CBD', 'Blenheim',
       'Ordinary Time; NCR'),

      ('NSN: NCR -Nelson FLM&2UP',
       'commercial', -41.2706, 173.2840, 0.0006, 0.0008,
       'Nelson CBD', 'Nelson',
       'NCR; Ordinary Time; Patrols'),

      ('NSN: NCR Atleos - ANZ ATM Stoke',
       'commercial', -41.3080, 173.2630, 0.0003, 0.0004,
       'Stoke, Nelson', 'Stoke',
       'NCR'),

      -- ── Industry ─────────────────────────────────────────────────────────────
      ('NSN: KiwiRail Blenheim',
       'infrastructure', -41.5050, 173.9940, 0.003, 0.004,
       '2 Jones Road, Riverlands', 'Blenheim',
       'Ordinary Time'),

      ('NSN: Talleys Nelson',
       'infrastructure', -41.3090, 173.2550, 0.001, 0.0013,
       '1 Nayland Road', 'Stoke',
       'Cancelled; Ordinary Time'),

      -- ── SPCA ─────────────────────────────────────────────────────────────────
      ('NSN: SPCA Nelson',
       'general', -41.3218, 173.2310, 0.0006, 0.0008,
       '379 Waimea Road, Enner Glynn', 'Nelson',
       'Ordinary Time'),

      -- ── Councils ─────────────────────────────────────────────────────────────
      ('NSN: Nelson CC - Customs House',
       'government', -41.2706, 173.2840, 0.0006, 0.0008,
       'Customs House, Nelson', 'Nelson',
       'Ordinary Time'),

      ('NSN: NELSON City Council',
       'government', -41.2706, 173.2840, 0.001, 0.0013,
       '110 Trafalgar Street', 'Nelson',
       'Civic House - Chambers; Civic House - Customer Service; Maitai Valley Motor Camp; Old Mill Rd Motueka; Trafalgar Park Pavillon'),

      ('NSN: Tasman District Council',
       'government', -41.3367, 173.1825, 0.0006, 0.0008,
       '189 Queen Street', 'Richmond',
       '189 Queen St; 4 Wensley Rd'),

      -- ── Patrol – Blenheim ────────────────────────────────────────────────────
      ('NSN: Blenheim Patrol',
       'guarding', -41.5130, 173.9550, 0.05, 0.065,
       'Blenheim patrol area', 'Blenheim',
       'Patrols; Training'),

      -- ── Marine / Port ────────────────────────────────────────────────────────
      ('NSN: Port Marloburgh',
       'infrastructure', -41.2934, 173.9556, 0.003, 0.004,
       '1 Auckland Street', 'Picton',
       'Picton Marina; Waikawa Boat Ramp'),

      -- ── First Security Internal ──────────────────────────────────────────────
      ('NSN: COA Training Nelson',
       'guarding', -41.3080, 173.2630, 0.0006, 0.0008,
       '13 Forests Road', 'Stoke',
       'Training; EMS; Patrols'),

      ('NSN: First Security EMS Training',
       'guarding', -41.3080, 173.2630, 0.0003, 0.0004,
       '13 Forests Road', 'Stoke',
       'Training'),

      ('NSN: First Security Nelson',
       'guarding', -41.3080, 173.2630, 0.0006, 0.0008,
       '13 Forests Road', 'Stoke',
       'Base office'),

      ('NSN: First Security Static Training',
       'guarding', -41.3080, 173.2630, 0.0003, 0.0004,
       '13 Forests Road', 'Stoke',
       'Nelson; Static training'),

      ('NSN: Nelson Base office',
       'guarding', -41.3080, 173.2630, 0.0003, 0.0004,
       '13 Forests Road', 'Stoke',
       'Ordinary Time; Non Billable'),

      ('NSN: ZZZ - Training Static - casual',
       'guarding', -41.3080, 173.2630, 0.0003, 0.0004,
       '13 Forests Road', 'Stoke',
       'Patrols'),

      ('NSN: ZZZ- Patrol Training',
       'guarding', -41.3080, 173.2630, 0.0003, 0.0004,
       '13 Forests Road', 'Stoke',
       'Patrols; Training; Tool Box Meeting - Noise; Mobile patrol officer')

    ) AS t(loc_name, site_type, lat, lng, dlat, dlng, address, city, areas_note)
  LOOP

    -- ── 1. Create client organisation ──────────────────────────────────────────
    IF NOT EXISTS (
      SELECT 1
      FROM   public.organizations
      WHERE  name                  = rec.loc_name
        AND  parent_organization_id = v_nelson_id
    ) THEN
      INSERT INTO public.organizations (
        name,
        organization_type,
        organization_level,
        parent_organization_id,
        is_active,
        enforcement_workflow,
        overnight_verification_mode
      )
      VALUES (
        rec.loc_name,
        'client',
        4,
        v_nelson_id,
        true,
        'officer_first',
        'two_photo_verification'
      );
    END IF;

    SELECT id INTO v_org_id
    FROM   public.organizations
    WHERE  name                  = rec.loc_name
      AND  parent_organization_id = v_nelson_id
    LIMIT  1;

    -- ── 2. Create zone with GeoJSON polygon geofence ───────────────────────────
    IF NOT EXISTS (
      SELECT 1
      FROM   public.zones
      WHERE  organization_id = v_org_id
        AND  name            = rec.loc_name
    ) THEN
      INSERT INTO public.zones (
        organization_id,
        name,
        description,
        is_active,
        location_lat,
        location_lng,
        geometry
      )
      VALUES (
        v_org_id,
        rec.loc_name,
        rec.areas_note,
        true,
        rec.lat,
        rec.lng,
        jsonb_build_object(
          'type', 'Polygon',
          'coordinates', jsonb_build_array(
            jsonb_build_array(
              jsonb_build_array(rec.lng - rec.dlng, rec.lat - rec.dlat),
              jsonb_build_array(rec.lng + rec.dlng, rec.lat - rec.dlat),
              jsonb_build_array(rec.lng + rec.dlng, rec.lat + rec.dlat),
              jsonb_build_array(rec.lng - rec.dlng, rec.lat + rec.dlat),
              jsonb_build_array(rec.lng - rec.dlng, rec.lat - rec.dlat)
            )
          )
        )
      );
    END IF;

    SELECT id INTO v_zone_id
    FROM   public.zones
    WHERE  organization_id = v_org_id
      AND  name            = rec.loc_name
    LIMIT  1;

    -- ── 3. Create client site ──────────────────────────────────────────────────
    IF NOT EXISTS (
      SELECT 1
      FROM   public.client_sites
      WHERE  organization_id = v_org_id
        AND  name            = rec.loc_name
    ) THEN
      INSERT INTO public.client_sites (
        organization_id,
        zone_id,
        name,
        site_type,
        address,
        city,
        gps_lat,
        gps_lng,
        notes,
        is_active
      )
      VALUES (
        v_org_id,
        v_zone_id,
        rec.loc_name,
        rec.site_type,
        rec.address,
        rec.city,
        rec.lat,
        rec.lng,
        rec.areas_note,
        true
      );
    END IF;

  END LOOP;

  RAISE NOTICE '✅  First Security Nelson locations seeded (parent org id = %)', v_nelson_id;
END $$;
