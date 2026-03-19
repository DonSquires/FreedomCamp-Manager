-- Fix observation deletion audit trigger when auth.uid() is NULL (e.g. service-role deletes)
-- Keeps deleted_by non-null by falling back to JWT sub claim, then recorded_by.

CREATE OR REPLACE FUNCTION log_observation_deletion()
RETURNS TRIGGER AS $$
DECLARE
  v_deleted_by UUID;
BEGIN
  -- auth.uid() can be NULL for service-role initiated deletes.
  v_deleted_by := COALESCE(
    auth.uid(),
    NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid,
    OLD.recorded_by
  );

  INSERT INTO observation_deletions (
    observation_id,
    plate_number,
    zone_id,
    organization_id,
    recorded_at,
    recorded_by,
    deleted_by,
    observation_snapshot
  ) VALUES (
    OLD.observation_id,
    OLD.plate_number,
    OLD.zone_id,
    OLD.organization_id,
    OLD.recorded_at,
    OLD.recorded_by,
    v_deleted_by,
    to_jsonb(OLD)
  );

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION log_observation_deletion() IS
  'Audit observation deletions; deleted_by falls back to jwt sub / recorded_by when auth.uid() is null';
