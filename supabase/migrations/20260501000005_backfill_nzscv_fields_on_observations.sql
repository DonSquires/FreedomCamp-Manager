-- ============================================================================
-- Backfill NZSCV and vehicle-reference fields on existing observations
-- ============================================================================
-- Purpose:
--   Populate newly added NZSCV fields for historical rows wherever source data
--   exists in canonical_scv / canonical_vehicles.
--
-- Notes:
--   - certificate_issue_date, vehicle_vin, vehicle_max_occupants, nzscv_logo_url
--     are backfilled only if source data exists (currently often null).
--   - certificate_status is derived as Current/Expired using authoritative
--     self-contained + expiry evidence.

DO $$
DECLARE
  v_rows_updated bigint := 0;
BEGIN
  UPDATE public.observations o
  SET
    -- Preserve existing values; only fill missing fields.
    self_contained = COALESCE(o.self_contained, scv.is_self_contained, cv.self_contained),
    self_contained_expiry = COALESCE(o.self_contained_expiry, scv.certificate_expiry, cv.self_contained_expiry),

    -- Derive status from best available certification + expiry evidence.
    nzscv_certificate_status = COALESCE(
      o.nzscv_certificate_status,
      CASE
        WHEN COALESCE(scv.is_self_contained, o.self_contained, cv.self_contained, false) = true
             AND COALESCE(scv.certificate_expiry, o.self_contained_expiry, cv.self_contained_expiry) IS NOT NULL
             AND COALESCE(scv.certificate_expiry, o.self_contained_expiry, cv.self_contained_expiry) < CURRENT_DATE
          THEN 'Expired'
        WHEN COALESCE(scv.is_self_contained, o.self_contained, cv.self_contained, false) = true
          THEN 'Current'
        ELSE NULL
      END
    ),

    -- Backfill lookup timestamp from best available audit trail.
    nzscv_checked_at = COALESCE(
      o.nzscv_checked_at,
      cv.nzscv_last_checked,
      cv.nzscv_lookup_at,
      scv.verified_at,
      o.recorded_at
    ),

    -- Keep historical observation rows populated with canonical attributes.
    vehicle_make = COALESCE(o.vehicle_make, cv.vehicle_make),
    vehicle_model = COALESCE(o.vehicle_model, cv.vehicle_model),
    vehicle_year = COALESCE(o.vehicle_year, cv.vehicle_year),
    vehicle_color = COALESCE(o.vehicle_color, cv.vehicle_color)

  FROM public.canonical_vehicles cv
  LEFT JOIN public.canonical_scv scv
    ON scv.plate_number = cv.plate_number

  WHERE o.plate_number = cv.plate_number
    AND (
      o.self_contained IS NULL
      OR o.self_contained_expiry IS NULL
      OR o.nzscv_certificate_status IS NULL
      OR o.nzscv_checked_at IS NULL
      OR o.vehicle_make IS NULL
      OR o.vehicle_model IS NULL
      OR o.vehicle_year IS NULL
      OR o.vehicle_color IS NULL
    );

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RAISE NOTICE 'Backfill complete: updated % observation rows', v_rows_updated;
END $$;
