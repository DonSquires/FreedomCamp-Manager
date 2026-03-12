BEGIN;

-- Geofence import compatibility:
-- 1) Ensure zones has boundary_source for import scripts and provenance tracking.
-- 2) Harden sync_zone_to_matrix against text[]::jsonb cast errors on allowed_days.

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS boundary_source text;

COMMENT ON COLUMN public.zones.boundary_source IS
  'Source system for geofence geometry import (e.g. stats_nz_meshblock_2025, doc_campsites).';

CREATE OR REPLACE FUNCTION public.sync_zone_to_matrix()
RETURNS trigger AS $$
DECLARE
  v_current_matrix record;
  v_new_version    integer;
BEGIN
  IF TG_OP = 'INSERT' OR (
    TG_OP = 'UPDATE' AND (
      OLD.self_contained_required IS DISTINCT FROM NEW.self_contained_required OR
      OLD.nights_per_month        IS DISTINCT FROM NEW.nights_per_month        OR
      OLD.max_consecutive_nights  IS DISTINCT FROM NEW.max_consecutive_nights  OR
      OLD.day_visit_only          IS DISTINCT FROM NEW.day_visit_only          OR
      to_jsonb(OLD.allowed_days)  IS DISTINCT FROM to_jsonb(NEW.allowed_days)
    )
  ) THEN
    SELECT *
    INTO v_current_matrix
    FROM zone_compliance_matrix
    WHERE zone_id = NEW.id
      AND effective_to IS NULL
    ORDER BY version DESC
    LIMIT 1;

    IF v_current_matrix IS NULL THEN
      v_new_version := 1;
    ELSE
      IF v_current_matrix.self_contained_required = NEW.self_contained_required
         AND v_current_matrix.nights_per_month       = NEW.nights_per_month
         AND v_current_matrix.max_consecutive_nights = NEW.max_consecutive_nights
         AND v_current_matrix.day_visit_only         = NEW.day_visit_only
         AND to_jsonb(v_current_matrix.allowed_days) = to_jsonb(NEW.allowed_days)
      THEN
        RETURN NEW;
      END IF;

      UPDATE zone_compliance_matrix
      SET effective_to = now()
      WHERE id = v_current_matrix.id;

      v_new_version := v_current_matrix.version + 1;
    END IF;

    BEGIN
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
        NULL,
        NEW.self_contained_required,
        NEW.self_contained_required,
        NEW.nights_per_month,
        NEW.max_consecutive_nights,
        NEW.day_visit_only,
        NEW.allowed_days,
        auth.uid(),
        CASE WHEN TG_OP = 'INSERT' THEN 'auto_created_with_zone'
             ELSE 'auto_updated_from_zone' END,
        'Automatically synced from zones table'
      );

      RAISE NOTICE 'Zone % synced to compliance matrix v%', NEW.name, v_new_version;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        'sync_zone_to_matrix: could not sync zone "%" (id=%) to compliance matrix: %',
        NEW.name, NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_sync_zone_to_matrix ON public.zones;
CREATE TRIGGER trigger_sync_zone_to_matrix
  AFTER INSERT OR UPDATE ON public.zones
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_zone_to_matrix();

COMMIT;
