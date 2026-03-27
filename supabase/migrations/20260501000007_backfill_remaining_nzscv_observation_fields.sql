-- ============================================================================
-- Backfill remaining NZSCV-derived fields on observations from canonical_scv
-- ============================================================================
-- Populates fields introduced for mismatch detection where source values exist.

DO $$
DECLARE
  v_rows_updated bigint := 0;
BEGIN
  UPDATE public.observations o
  SET
    nzscv_certificate_issue_date = COALESCE(o.nzscv_certificate_issue_date, scv.certificate_issue_date),
    nzscv_certificate_status = COALESCE(o.nzscv_certificate_status, scv.certificate_status),
    vehicle_vin = COALESCE(o.vehicle_vin, scv.vin),
    vehicle_max_occupants = COALESCE(o.vehicle_max_occupants, scv.max_occupants),
    nzscv_logo_url = COALESCE(o.nzscv_logo_url, scv.logo_url),
    nzscv_checked_at = COALESCE(o.nzscv_checked_at, scv.verified_at)
  FROM public.canonical_scv scv
  WHERE o.plate_number = scv.plate_number
    AND (
      o.nzscv_certificate_issue_date IS NULL
      OR o.nzscv_certificate_status IS NULL
      OR o.vehicle_vin IS NULL
      OR o.vehicle_max_occupants IS NULL
      OR o.nzscv_logo_url IS NULL
      OR o.nzscv_checked_at IS NULL
    );

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RAISE NOTICE 'NZSCV enrichment backfill complete: updated % observation rows', v_rows_updated;
END $$;
