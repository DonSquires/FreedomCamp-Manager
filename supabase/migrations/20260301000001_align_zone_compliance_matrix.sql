-- ============================================================================
-- ZONE COMPLIANCE MATRIX ALIGNMENT
-- ============================================================================
-- Purpose: Ensure requires_csc is kept in sync with self_contained_required
--          in zone_compliance_matrix.
--
-- Background:
--   - self_contained_required was the original column in zone_compliance_matrix
--   - requires_csc was added later (20260219_evidence_integrity_and_legal_compliance)
--     and is used by evaluate_compliance_v4 and generate_compliance_explanation
--   - The sync_zone_to_matrix trigger only wrote self_contained_required,
--     leaving requires_csc at its DEFAULT (true) regardless of zone rules
--
-- Fix:
--   1. Back-fill: set requires_csc = self_contained_required on all rows
--      where they differ (or requires_csc is NULL)
--   2. Update sync_zone_to_matrix trigger to also write requires_csc
-- ============================================================================

BEGIN;

-- ── 1. Back-fill existing rows ────────────────────────────────────────────
UPDATE zone_compliance_matrix
SET requires_csc = self_contained_required
WHERE requires_csc IS DISTINCT FROM self_contained_required
   OR requires_csc IS NULL;

-- ── 2. Update sync trigger to keep requires_csc in sync ──────────────────
-- Replace the trigger function so that any future zone update also writes
-- requires_csc alongside self_contained_required.

CREATE OR REPLACE FUNCTION sync_zone_to_matrix()
RETURNS trigger AS $$
DECLARE
  v_current_matrix record;
  v_new_version integer;
BEGIN
  -- Only sync if zone requirements have changed (or it's a new zone)
  IF TG_OP = 'INSERT' OR (
    TG_OP = 'UPDATE' AND (
      OLD.self_contained_required IS DISTINCT FROM NEW.self_contained_required OR
      OLD.nights_per_month IS DISTINCT FROM NEW.nights_per_month OR
      OLD.max_consecutive_nights IS DISTINCT FROM NEW.max_consecutive_nights OR
      OLD.day_visit_only IS DISTINCT FROM NEW.day_visit_only OR
      OLD.allowed_days::jsonb IS DISTINCT FROM NEW.allowed_days::jsonb
    )
  ) THEN
    -- Get current active matrix version
    SELECT *
    INTO v_current_matrix
    FROM zone_compliance_matrix
    WHERE zone_id = NEW.id
      AND effective_to IS NULL
    ORDER BY version DESC
    LIMIT 1;

    -- Determine next version number
    IF v_current_matrix IS NULL THEN
      v_new_version := 1;
    ELSE
      -- Check if values are actually different (avoid duplicate versions)
      IF v_current_matrix.self_contained_required = NEW.self_contained_required
         AND v_current_matrix.nights_per_month = NEW.nights_per_month
         AND v_current_matrix.max_consecutive_nights = NEW.max_consecutive_nights
         AND v_current_matrix.day_visit_only = NEW.day_visit_only
         AND v_current_matrix.allowed_days::jsonb = NEW.allowed_days::jsonb
      THEN
        -- No actual change - skip creating new version
        RETURN NEW;
      END IF;

      -- Close previous version
      UPDATE zone_compliance_matrix
      SET effective_to = now()
      WHERE id = v_current_matrix.id;

      v_new_version := v_current_matrix.version + 1;
    END IF;

    -- Create new matrix version (requires_csc mirrors self_contained_required)
    INSERT INTO zone_compliance_matrix (
      zone_id,
      organization_id,
      version,
      effective_from,
      effective_to,
      self_contained_required,
      requires_csc,
      nights_per_month,
      max_consecutive_nights,
      day_visit_only,
      allowed_days,
      created_by,
      change_reason,
      change_notes
    ) VALUES (
      NEW.id,
      NEW.organization_id,
      v_new_version,
      now(),
      NULL, -- open-ended
      NEW.self_contained_required,
      NEW.self_contained_required,   -- keep requires_csc in sync
      NEW.nights_per_month,
      NEW.max_consecutive_nights,
      NEW.day_visit_only,
      NEW.allowed_days,
      auth.uid(),
      CASE
        WHEN TG_OP = 'INSERT' THEN 'auto_created_with_zone'
        ELSE 'auto_updated_from_zone'
      END,
      'Automatically synced from zones table'
    );

    RAISE NOTICE 'Zone % synced to matrix v%', NEW.name, v_new_version;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-attach trigger (trigger itself stays the same, just the function changed)
DROP TRIGGER IF EXISTS trigger_sync_zone_to_matrix ON zones;
CREATE TRIGGER trigger_sync_zone_to_matrix
  AFTER INSERT OR UPDATE ON zones
  FOR EACH ROW
  EXECUTE FUNCTION sync_zone_to_matrix();

COMMIT;
