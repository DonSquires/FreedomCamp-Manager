-- ============================================================================
-- TEST DATA SEED - Phase 9 Integration Testing
-- ============================================================================
-- Sample data for automated testing scenarios
-- Run: psql -U postgres -d postgres -f supabase/seed/test-data.sql

-- ============================================================================
-- 1. Test Organizations
-- ============================================================================

INSERT INTO organizations (id, name, organization_type, organization_level, is_active) VALUES
('11111111-1111-1111-1111-111111111111', 'Test Organization 1', 'client', 1, true),
('22222222-2222-2222-2222-222222222222', 'Test Organization 2', 'client', 1, true),
('33333333-3333-3333-3333-333333333333', 'Test Master Org', 'security_company', 0, true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 2. Test Users
-- ============================================================================

-- Insert into auth.users (requires admin access)
-- NOTE: Password is 'Test123!' for all test users
-- In production, use Supabase dashboard to create these users

-- Test user profiles (link to auth.users after creation)
INSERT INTO user_profiles (id, organization_id, first_name, last_name, email, role, is_active) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'Test', 'Master', 'master@test.com', 'master', true),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'Test', 'Admin', 'admin@org1.com', 'admin', true),
('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'Test', 'Officer', 'officer@org1.com', 'officer', true),
('dddddddd-dddd-dddd-dddd-dddddddddddd', '22222222-2222-2222-2222-222222222222', 'Test', 'Admin2', 'admin@org2.com', 'admin', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 3. Test Zones
-- ============================================================================

INSERT INTO zones (id, organization_id, name, description, self_contained_required, nights_per_month, max_consecutive_nights, is_active) VALUES
('z1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Beach Reserve', 'Test beach parking zone', true, 28, 3, true),
('z2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Restricted Zone', 'No overnight parking', false, 0, 0, true),
('z3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'Org 2 Zone', 'Organization 2 test zone', true, 28, 2, true)
ON CONFLICT (id) DO NOTHING;

-- Zone compliance matrix
INSERT INTO zone_compliance_matrix (id, zone_id, organization_id, version, effective_from, self_contained_required, nights_per_month, max_consecutive_nights) VALUES
('m1111111-1111-1111-1111-111111111111', 'z1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 1, NOW(), true, 28, 3),
('m2222222-2222-2222-2222-222222222222', 'z2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 1, NOW(), false, 0, 0),
('m3333333-3333-3333-3333-333333333333', 'z3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 1, NOW(), true, 28, 2)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 4. Test Vehicles
-- ============================================================================

INSERT INTO canonical_vehicles (plate_number, make, model, year, colour, self_contained, self_contained_expiry, homeless_status, is_exempt, first_seen_at, last_seen_at) VALUES
('TEST123', 'Toyota', 'Campervan', 2020, 'White', true, '2026-12-31', 'none', false, NOW() - INTERVAL '30 days', NOW()),
('ABC123', 'Ford', 'Transit', 2019, 'Blue', false, NULL, 'none', false, NOW() - INTERVAL '20 days', NOW()),
('BREACH1', 'Volkswagen', 'California', 2021, 'Silver', false, NULL, 'none', false, NOW() - INTERVAL '10 days', NOW()),
('ORG1TEST', 'Mercedes', 'Sprinter', 2022, 'White', true, '2026-06-30', 'none', false, NOW() - INTERVAL '5 days', NOW()),
('ORG2TEST', 'Renault', 'Master', 2018, 'Red', false, NULL, 'none', false, NOW() - INTERVAL '3 days', NOW()),
('OFFLINE1', 'Fiat', 'Ducato', 2020, 'Grey', true, '2026-09-30', 'none', false, NOW(), NOW()),
('OFFLINE2', 'Peugeot', 'Boxer', 2019, 'White', false, NULL, 'none', false, NOW(), NOW())
ON CONFLICT (plate_number) DO NOTHING;

-- ============================================================================
-- 5. Test Observations
-- ============================================================================

-- Compliant observation (TEST123)
INSERT INTO observations (id, plate_number, photo_url, photo_hash, recorded_at, zone_id, organization_id, gps_latitude, gps_longitude, gps_accuracy, recorded_by, is_compliant) VALUES
('o1111111-1111-1111-1111-111111111111', 'TEST123', 'https://example.com/photo1.jpg', 'hash1', NOW() - INTERVAL '1 day', 'z1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', -36.8485, 174.7633, 10.0, 'cccccccc-cccc-cccc-cccc-cccccccccccc', true)
ON CONFLICT (id) DO NOTHING;

-- Non-compliant observation (BREACH1)
INSERT INTO observations (id, plate_number, photo_url, photo_hash, recorded_at, zone_id, organization_id, gps_latitude, gps_longitude, gps_accuracy, recorded_by, is_compliant, breach_type, breach_reason) VALUES
('o2222222-2222-2222-2222-222222222222', 'BREACH1', 'https://example.com/photo2.jpg', 'hash2', NOW() - INTERVAL '6 hours', 'z2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', -36.8485, 174.7633, 10.0, 'cccccccc-cccc-cccc-cccc-cccccccccccc', false, 'overstay', 'Exceeded maximum consecutive nights')
ON CONFLICT (id) DO NOTHING;

-- Organization 1 observation
INSERT INTO observations (id, plate_number, photo_url, photo_hash, recorded_at, zone_id, organization_id, gps_latitude, gps_longitude, gps_accuracy, recorded_by, is_compliant) VALUES
('o3333333-3333-3333-3333-333333333333', 'ORG1TEST', 'https://example.com/photo3.jpg', 'hash3', NOW() - INTERVAL '3 hours', 'z1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', -36.8485, 174.7633, 10.0, 'cccccccc-cccc-cccc-cccc-cccccccccccc', true)
ON CONFLICT (id) DO NOTHING;

-- Organization 2 observation (for isolation testing)
INSERT INTO observations (id, plate_number, photo_url, photo_hash, recorded_at, zone_id, organization_id, gps_latitude, gps_longitude, gps_accuracy, recorded_by, is_compliant) VALUES
('o4444444-4444-4444-4444-444444444444', 'ORG2TEST', 'https://example.com/photo4.jpg', 'hash4', NOW() - INTERVAL '2 hours', 'z3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', -36.8485, 174.7633, 10.0, 'dddddddd-dddd-dddd-dddd-dddddddddddd', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 6. Test Breach Alerts
-- ============================================================================

INSERT INTO breach_alerts (id, organization_id, zone_id, plate_number, breach_type, status, detected_at) VALUES
('b1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'z2222222-2222-2222-2222-222222222222', 'BREACH1', 'overstay', 'pending', NOW() - INTERVAL '5 hours')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 7. Test Patrols
-- ============================================================================

INSERT INTO patrols (id, organization_id, zone_id, patrol_date, shift, assigned_to, status) VALUES
('p1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'z1111111-1111-1111-1111-111111111111', CURRENT_DATE, 'morning', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'scheduled'),
('p2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'z1111111-1111-1111-1111-111111111111', CURRENT_DATE, 'afternoon', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'in_progress')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check inserted data
SELECT 'Organizations' as table_name, COUNT(*) as count FROM organizations WHERE id LIKE '%-1111-1111-1111-%' OR id LIKE '%-2222-2222-2222-%' OR id LIKE '%-3333-3333-3333-%'
UNION ALL
SELECT 'User Profiles', COUNT(*) FROM user_profiles WHERE id LIKE 'aaaaaaaa-%' OR id LIKE 'bbbbbbbb-%' OR id LIKE 'cccccccc-%' OR id LIKE 'dddddddd-%'
UNION ALL
SELECT 'Zones', COUNT(*) FROM zones WHERE id LIKE 'z%'
UNION ALL
SELECT 'Canonical Vehicles', COUNT(*) FROM canonical_vehicles WHERE plate_number IN ('TEST123', 'ABC123', 'BREACH1', 'ORG1TEST', 'ORG2TEST', 'OFFLINE1', 'OFFLINE2')
UNION ALL
SELECT 'Observations', COUNT(*) FROM observations WHERE id LIKE 'o%'
UNION ALL
SELECT 'Breach Alerts', COUNT(*) FROM breach_alerts WHERE id LIKE 'b%'
UNION ALL
SELECT 'Patrols', COUNT(*) FROM patrols WHERE id LIKE 'p%';

-- ============================================================================
-- CLEANUP SCRIPT (Run to remove test data)
-- ============================================================================

/*
-- Uncomment to remove test data:

DELETE FROM patrols WHERE id LIKE 'p%';
DELETE FROM breach_alerts WHERE id LIKE 'b%';
DELETE FROM observations WHERE id LIKE 'o%';
DELETE FROM canonical_vehicles WHERE plate_number IN ('TEST123', 'ABC123', 'BREACH1', 'ORG1TEST', 'ORG2TEST', 'OFFLINE1', 'OFFLINE2');
DELETE FROM zone_compliance_matrix WHERE id LIKE 'm%';
DELETE FROM zones WHERE id LIKE 'z%';
DELETE FROM user_profiles WHERE id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
DELETE FROM organizations WHERE id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
*/
