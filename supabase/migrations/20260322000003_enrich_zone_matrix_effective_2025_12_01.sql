-- ==========================================================================
-- Enrich zone_compliance_matrix with live zone rules
-- Effective date baseline: 2025-12-01 (Pacific/Auckland)
-- Date: 2026-03-22
-- ==========================================================================

BEGIN;

DO $$
DECLARE
  v_effective_from timestamptz := '2025-12-01 00:00:00+13'::timestamptz;
  v_updated_count integer := 0;
  v_inserted_count integer := 0;
BEGIN
  -- Keep active matrix rows aligned with the current zone rule source-of-truth.
  WITH zone_source AS (
    SELECT
      z.id AS zone_id,
      z.organization_id,
      z.self_contained_required,
      z.nights_per_month,
      z.max_consecutive_nights,
      z.day_visit_only,
      z.allowed_days
    FROM public.zones z
    WHERE z.is_active = true
  )
  UPDATE public.zone_compliance_matrix zcm
  SET
    organization_id = zs.organization_id,
    self_contained_required = zs.self_contained_required,
    requires_csc = zs.self_contained_required,
    nights_per_month = zs.nights_per_month,
    max_consecutive_nights = zs.max_consecutive_nights,
    day_visit_only = zs.day_visit_only,
    allowed_days = zs.allowed_days,
    homeless_exemption = COALESCE(zcm.homeless_exemption, true),
    effective_from = v_effective_from,
    updated_at = now()
  FROM zone_source zs
  WHERE zcm.zone_id = zs.zone_id
    AND zcm.effective_to IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  -- Insert missing active matrix rows for active zones using live zone data.
  INSERT INTO public.zone_compliance_matrix (
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
    homeless_exemption,
    created_at,
    updated_at
  )
  SELECT
    z.id,
    z.organization_id,
    COALESCE((
      SELECT MAX(existing.version)
      FROM public.zone_compliance_matrix existing
      WHERE existing.zone_id = z.id
    ), 0) + 1,
    v_effective_from,
    NULL,
    z.self_contained_required,
    z.self_contained_required,
    z.nights_per_month,
    z.max_consecutive_nights,
    z.day_visit_only,
    z.allowed_days,
    true,
    now(),
    now()
  FROM public.zones z
  WHERE z.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.zone_compliance_matrix active
      WHERE active.zone_id = z.id
        AND active.effective_to IS NULL
    );

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  RAISE NOTICE 'zone_compliance_matrix enriched: % updated, % inserted (effective_from=%)',
    v_updated_count,
    v_inserted_count,
    v_effective_from;
END;
$$;

COMMIT;
