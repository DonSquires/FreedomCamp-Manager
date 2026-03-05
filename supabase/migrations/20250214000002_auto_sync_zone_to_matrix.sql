-- AUTO-SYNC ZONE REQUIREMENTS TO COMPLIANCE MATRIX
-- Fixes disconnect between zones table and zone_compliance_matrix
-- Now when zones are created/updated, matrix is automatically maintained

-- Drop existing function if exists
DROP FUNCTION IF EXISTS sync_zone_to_matrix();

-- Create function to sync zone settings to compliance matrix
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

    -- Create new matrix version
    INSERT INTO zone_compliance_matrix (
      zone_id,
      organization_id,
      version,
      effective_from,
      effective_to,
      self_contained_required,
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

-- Create trigger on zones table
DROP TRIGGER IF EXISTS trigger_sync_zone_to_matrix ON zones;

CREATE TRIGGER trigger_sync_zone_to_matrix
  AFTER INSERT OR UPDATE ON zones
  FOR EACH ROW
  EXECUTE FUNCTION sync_zone_to_matrix();

-- BACKFILL: Create matrix versions for all existing zones that don't have one
DO $$
DECLARE
  v_zone record;
  v_inserted integer := 0;
BEGIN
  FOR v_zone IN
    SELECT z.*
    FROM zones z
    WHERE z.is_active = true
      AND NOT EXISTS (
        SELECT 1
        FROM zone_compliance_matrix zcm
        WHERE zcm.zone_id = z.id
      )
  LOOP
    INSERT INTO zone_compliance_matrix (
      zone_id,
      organization_id,
      version,
      effective_from,
      effective_to,
      self_contained_required,
      nights_per_month,
      max_consecutive_nights,
      day_visit_only,
      allowed_days,
      change_reason,
      change_notes
    ) VALUES (
      v_zone.id,
      v_zone.organization_id,
      1,
      now(),
      NULL,
      v_zone.self_contained_required,
      v_zone.nights_per_month,
      v_zone.max_consecutive_nights,
      v_zone.day_visit_only,
      v_zone.allowed_days,
      'backfill_from_zone',
      'Backfilled from existing zone configuration'
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RAISE NOTICE 'Backfilled % zone compliance matrices', v_inserted;
END $$;

-- Verify sync worked
DO $$
DECLARE
  v_zones_without_matrix integer;
BEGIN
  SELECT COUNT(*)
  INTO v_zones_without_matrix
  FROM zones z
  WHERE z.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM zone_compliance_matrix zcm
      WHERE zcm.zone_id = z.id
    );

  IF v_zones_without_matrix > 0 THEN
    RAISE WARNING '⚠️ Still have % active zones without compliance matrix!', v_zones_without_matrix;
  ELSE
    RAISE NOTICE '✅ All active zones now have compliance matrices';
  END IF;
END $$;
