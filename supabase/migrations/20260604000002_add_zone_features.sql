-- Add zone_features column to zones table.
-- This allows admins to configure which officer portal functions are
-- available at each zone/location. Empty array = all features allowed
-- (backwards compatible default).
--
-- Feature keys (must match ZONE_FEATURES in src/lib/zoneFeatures.ts):
--   freedom_camping   – Freedom Camping Patrol portal
--   guarding          – Site Guard portal
--   parking           – Parking Enforcement portal
--   noise             – Noise Control Officer portal
--   ems               – Electronic Monitoring Services portal
--   access_control    – Access Control portal

ALTER TABLE zones
  ADD COLUMN IF NOT EXISTS zone_features text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN zones.zone_features IS
  'Portal functions enabled for officers at this zone. '
  'Empty array means all features are permitted (default / unconfigured). '
  'Non-empty restricts officers to only the listed feature keys.';
