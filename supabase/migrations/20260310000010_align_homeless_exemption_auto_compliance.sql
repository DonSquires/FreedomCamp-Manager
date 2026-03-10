-- Align auto compliance trigger with recalculate-compliance-v3 homeless exemption logic.
-- confirmed + claimed are exempt-eligible when homeless_exemption is enabled.

CREATE OR REPLACE FUNCTION public.auto_evaluate_compliance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matrix           RECORD;
  v_homeless_status  TEXT := '';
  v_is_homeless      BOOLEAN := false;
  v_nz_hour          INTEGER;
  v_is_compliant     BOOLEAN := true;
  v_breach_type      TEXT    := NULL;
  v_breach_reason    TEXT    := NULL;
BEGIN
  SELECT *
    INTO v_matrix
    FROM zone_compliance_matrix
   WHERE zone_id = NEW.zone_id
     AND effective_from <= NEW.recorded_at
     AND (effective_to IS NULL OR effective_to > NEW.recorded_at)
   ORDER BY version DESC
   LIMIT 1;

  IF NOT FOUND THEN
    SELECT
      self_contained_required,
      self_contained_required  AS requires_csc,
      nights_per_month,
      max_consecutive_nights,
      day_visit_only,
      TRUE                     AS homeless_exemption
    INTO v_matrix
    FROM zones
   WHERE id = NEW.zone_id;

    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT LOWER(COALESCE(homeless_status, ''))
    INTO v_homeless_status
    FROM canonical_vehicles
   WHERE plate_number = NEW.plate_number;

  IF NOT FOUND THEN
    v_homeless_status := '';
  END IF;

  v_is_homeless := v_homeless_status IN ('confirmed', 'claimed');

  IF COALESCE(v_matrix.day_visit_only, false) THEN
    v_nz_hour := EXTRACT(HOUR FROM NEW.recorded_at AT TIME ZONE 'Pacific/Auckland')::INTEGER;
    IF v_nz_hour >= 20 OR v_nz_hour < 8 THEN
      v_is_compliant := false;
      v_breach_type  := 'day_visit_violation';
      v_breach_reason := format(
        'Night visit in day-only zone (observed at %s:00 NZ time)', v_nz_hour
      );
    END IF;
  END IF;

  IF v_is_compliant AND v_matrix.nights_per_month IS NOT NULL THEN
    IF COALESCE(NEW.nights_stayed_this_month, 0) > v_matrix.nights_per_month THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant := false;
        v_breach_type  := 'monthly_limit';
        v_breach_reason := format(
          'Exceeded monthly stay limit: %s nights stayed, limit is %s',
          COALESCE(NEW.nights_stayed_this_month, 0),
          v_matrix.nights_per_month
        );
      END IF;
    END IF;
  END IF;

  IF v_is_compliant AND v_matrix.max_consecutive_nights IS NOT NULL THEN
    IF COALESCE(NEW.consecutive_nights, 0) > v_matrix.max_consecutive_nights THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant := false;
        v_breach_type  := 'consecutive_nights';
        v_breach_reason := format(
          'Exceeded consecutive nights limit: %s consecutive nights, limit is %s',
          COALESCE(NEW.consecutive_nights, 0),
          v_matrix.max_consecutive_nights
        );
      END IF;
    END IF;
  END IF;

  IF v_is_compliant AND (
    COALESCE(v_matrix.self_contained_required, false) OR
    COALESCE(v_matrix.requires_csc, false)
  ) THEN
    IF NOT COALESCE(NEW.self_contained, false) THEN
      IF NOT (v_is_homeless AND COALESCE(v_matrix.homeless_exemption, true)) THEN
        v_is_compliant := false;
        v_breach_type  := 'self_contained';
        v_breach_reason := 'Zone requires a self-contained vehicle; no valid CSC on record';
      END IF;
    END IF;
  END IF;

  NEW.is_compliant  := v_is_compliant;
  NEW.breach_type   := v_breach_type;
  NEW.breach_reason := v_breach_reason;

  RETURN NEW;
END;
$$;
