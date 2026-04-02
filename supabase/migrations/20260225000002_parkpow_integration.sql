-- ============================================================================
-- ParkPow Integration — Database Columns
-- ============================================================================
-- ParkPow (https://parkpow.com) is a Parking Management / Enforcement platform
-- made by the same company as Plate Recognizer. Once integrated it provides:
--
--   • Watchlists       — flag plates as banned/blocked or permitted/exempt
--   • Session tracking — record vehicle entry/exit per zone with timestamps
--   • Violations       — formal enforcement violation records with workflow
--   • Permit management — manage zone-specific vehicle exemptions
--
-- This migration adds lightweight foreign-key columns so FieldOps records
-- stay in sync with ParkPow without duplicating data.
--
-- No data is moved; all new columns are nullable (zero-downtime deploy).
-- ============================================================================

-- ── zones: link each zone to a ParkPow "lot" ─────────────────────────────────
ALTER TABLE zones
  ADD COLUMN IF NOT EXISTS parkpow_lot_id INTEGER DEFAULT NULL;

COMMENT ON COLUMN zones.parkpow_lot_id IS
  'ParkPow lot ID for this zone. Set automatically by parkpow-sync?action=sync-lots. '
  'Required before ParkPow sessions and violations can be created for this zone.';

CREATE INDEX IF NOT EXISTS idx_zones_parkpow_lot_id
  ON zones (parkpow_lot_id)
  WHERE parkpow_lot_id IS NOT NULL;

-- ── canonical_vehicles: link to ParkPow vehicle / watchlist record ───────────
ALTER TABLE canonical_vehicles
  ADD COLUMN IF NOT EXISTS parkpow_vehicle_id INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_exempt          BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN canonical_vehicles.parkpow_vehicle_id IS
  'ParkPow vehicle list entry ID. Set when the vehicle is pushed to a ParkPow watchlist '
  '(block or allow list) via parkpow-sync?action=sync-watchlist.';

COMMENT ON COLUMN canonical_vehicles.is_exempt IS
  'True when this vehicle has an active ParkPow permit (allow list) or a manual compliance exemption.';

CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_parkpow_vehicle_id
  ON canonical_vehicles (parkpow_vehicle_id)
  WHERE parkpow_vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_is_exempt
  ON canonical_vehicles (is_exempt)
  WHERE is_exempt = TRUE;

-- ── observations: link to ParkPow session and (if breached) violation ─────────
ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS parkpow_session_id   INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS parkpow_violation_id INTEGER DEFAULT NULL;

COMMENT ON COLUMN observations.parkpow_session_id IS
  'ParkPow session ID created when the vehicle was observed entering the zone. '
  'Created automatically by orc-ingest when PARKPOW_API_TOKEN is set and the zone '
  'has a parkpow_lot_id. Used by parkpow-sync?action=push-violations.';

COMMENT ON COLUMN observations.parkpow_violation_id IS
  'ParkPow violation ID. Set by orc-ingest (for blocked vehicles) or by '
  'parkpow-sync?action=push-violations (for any compliance breach). '
  'Once set, the enforcement workflow in ParkPow is active.';

CREATE INDEX IF NOT EXISTS idx_observations_parkpow_session_id
  ON observations (parkpow_session_id)
  WHERE parkpow_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_observations_parkpow_violation_id
  ON observations (parkpow_violation_id)
  WHERE parkpow_violation_id IS NOT NULL;

-- Partial index: quickly find breaches that haven't been pushed to ParkPow yet
CREATE INDEX IF NOT EXISTS idx_observations_unpushed_violations
  ON observations (id, parkpow_session_id)
  WHERE is_compliant = FALSE
    AND parkpow_session_id IS NOT NULL
    AND parkpow_violation_id IS NULL;
