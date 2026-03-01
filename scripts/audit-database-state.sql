-- ========================================
-- DATABASE STATE AUDIT SCRIPT
-- Run this in Supabase SQL Editor
-- ========================================

-- 1. TABLE EXISTENCE CHECK
-- ========================================
SELECT 
  'clients' as table_name,
  EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'clients'
  ) as exists
UNION ALL
SELECT 'organizations', EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'organizations')
UNION ALL
SELECT 'zones', EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'zones')
UNION ALL
SELECT 'canonical_vehicles', EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'canonical_vehicles')
UNION ALL
SELECT 'observations', EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'observations');


-- 2. COLUMN EXISTENCE CHECK
-- ========================================
SELECT 
  'observations.vehicle_make' as column_name,
  EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'observations' 
    AND column_name = 'vehicle_make'
  ) as exists
UNION ALL
SELECT 
  'observations.is_identity_mismatch',
  EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'observations' AND column_name = 'is_identity_mismatch')
UNION ALL
SELECT 
  'zones.geom',
  EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'zones' AND column_name = 'geom');


-- 3. RPC FUNCTION CHECK
-- ========================================
SELECT 
  'resolve_officer_zone' as function_name,
  EXISTS (
    SELECT FROM pg_proc 
    WHERE proname = 'resolve_officer_zone'
  ) as exists;


-- 4. DATA INTEGRITY CHECK
-- ========================================

-- Check for "Iron Eagle" client
SELECT 
  'Iron Eagle Client' as check_name,
  COUNT(*) as count,
  CASE WHEN COUNT(*) > 0 THEN '✓ EXISTS' ELSE '✗ MISSING' END as status
FROM clients 
WHERE name = 'Iron Eagle';


-- Organization count (Target: ~78)
SELECT 
  'Total Organizations' as check_name,
  COUNT(*) as count,
  CASE 
    WHEN COUNT(*) >= 78 THEN '✓ COMPLETE' 
    WHEN COUNT(*) > 0 THEN '⚠ PARTIAL'
    ELSE '✗ EMPTY' 
  END as status
FROM organizations;


-- Parent zones count
SELECT 
  'Parent Zones' as check_name,
  COUNT(*) as count,
  CASE WHEN COUNT(*) > 0 THEN '✓ EXISTS' ELSE '✗ MISSING' END as status
FROM zones 
WHERE zone_type = 'general'; -- 'parent' zones are now called 'general' type


-- Parent zones with NULL geometry
SELECT 
  'Parent Zones Missing Geometry' as check_name,
  COUNT(*) as count,
  CASE 
    WHEN COUNT(*) = 0 THEN '✓ ALL MAPPED' 
    ELSE '⚠ NEEDS GEOM DATA' 
  END as status
FROM zones 
WHERE zone_type = 'general' 
AND geom IS NULL;


-- 5. DETAILED ORGANIZATION BREAKDOWN
-- ========================================
SELECT 
  o.name as organization_name,
  o.organization_type,
  COUNT(z.id) as zone_count,
  COUNT(CASE WHEN z.zone_type = 'general' THEN 1 END) as parent_zones,
  COUNT(CASE WHEN z.zone_type = 'specific' THEN 1 END) as child_zones,
  COUNT(CASE WHEN z.geom IS NULL THEN 1 END) as zones_missing_geometry
FROM organizations o
LEFT JOIN zones z ON z.organization_id = o.id
GROUP BY o.id, o.name, o.organization_type
ORDER BY o.name;


-- 6. MISSING "OTHER LOCATION" ZONES
-- ========================================
-- Organizations that don't have their parent jurisdiction zone
SELECT 
  o.id,
  o.name as organization_missing_parent_zone,
  o.organization_type
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM zones z 
  WHERE z.organization_id = o.id 
  AND z.name = 'Other Location'
  AND z.zone_type = 'general'
)
ORDER BY o.name;
