-- ============================================================================
-- Derive NZSCV certificate status from existing canonical cert data
-- and refresh observations accordingly.
-- ============================================================================

DO $$
DECLARE
  v_scv_updated bigint := 0;
  v_obs_updated bigint := 0;
BEGIN
  -- Fill canonical_scv.certificate_status when missing.
  UPDATE public.canonical_scv scv
  SET certificate_status = CASE
    WHEN scv.is_self_contained = true
         AND scv.certificate_expiry IS NOT NULL
         AND scv.certificate_expiry < CURRENT_DATE
      THEN 'Expired'
    WHEN scv.is_self_contained = true
      THEN 'Current'
    ELSE COALESCE(scv.certificate_status, 'Expired')
  END
  WHERE scv.certificate_status IS NULL;

  GET DIAGNOSTICS v_scv_updated = ROW_COUNT;

  -- Propagate derived status to observations where missing.
  UPDATE public.observations o
  SET nzscv_certificate_status = scv.certificate_status,
      nzscv_checked_at = COALESCE(o.nzscv_checked_at, scv.verified_at, o.recorded_at)
  FROM public.canonical_scv scv
  WHERE o.plate_number = scv.plate_number
    AND o.nzscv_certificate_status IS NULL
    AND scv.certificate_status IS NOT NULL;

  GET DIAGNOSTICS v_obs_updated = ROW_COUNT;

  RAISE NOTICE 'Derived canonical_scv status rows: %, observations refreshed: %', v_scv_updated, v_obs_updated;
END $$;
