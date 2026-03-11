-- ============================================================================
-- FIX BREACH ALERTS OBSERVATION FK
-- ============================================================================
-- Background:
--   The breach_alerts table was created in 20260218000005_rebuild_breach_alerts_system.sql
--   with: observation_id UUID REFERENCES vehicle_observations_v2(observation_id) ON DELETE CASCADE
--
--   Migration 20260221_rebuild_observations_clean.sql dropped vehicle_observations_v2
--   with CASCADE, which removed the FK constraint from breach_alerts.observation_id.
--   The column itself survived but is now an unlinked UUID column.
--
-- This migration re-links breach_alerts.observation_id to observations(id)
-- so that new breach alerts created by recalculate-compliance-v3 have a proper
-- FK and breach alert queries can JOIN to observations efficiently.
--
-- We use ON DELETE SET NULL so that deleting an observation does not cascade-
-- delete the enforcement record (breach alerts are audit/legal records).
-- ============================================================================

-- 1. Null out any orphaned observation_id values that no longer exist in observations.
--    This prevents the FK addition from failing due to missing referenced rows.
UPDATE breach_alerts
   SET observation_id = NULL
 WHERE observation_id IS NOT NULL
   AND observation_id NOT IN (SELECT id FROM observations);

-- 2. Drop the old constraint (if it somehow still exists under any name).
ALTER TABLE breach_alerts
  DROP CONSTRAINT IF EXISTS breach_alerts_observation_id_fkey;

ALTER TABLE breach_alerts
  DROP CONSTRAINT IF EXISTS breach_alerts_observation_id_fkey1;

-- 3. Add the corrected FK pointing at observations(id).
ALTER TABLE breach_alerts
  ADD CONSTRAINT breach_alerts_observation_id_fkey
  FOREIGN KEY (observation_id)
  REFERENCES observations(id)
  ON DELETE SET NULL;

-- 4. Ensure the index on observation_id is present for JOIN performance.
CREATE INDEX IF NOT EXISTS idx_breach_alerts_observation_id
  ON breach_alerts(observation_id)
  WHERE observation_id IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE '✅ breach_alerts.observation_id FK now references observations(id) ON DELETE SET NULL';
END;
$$;
