-- Backfill Legacy Compliance for KPI Alignment
-- Fixes: KPI tiles showing 0 because legacy observations lack compliance_results rows
-- Strategy: Create analytics-only compliance records without triggering breach alerts

-- ==================== ADD ANALYTICS FLAG ====================

-- Mark analytics-only rows so they never trigger alerts/enforcement
ALTER TABLE compliance_results 
  ADD COLUMN IF NOT EXISTS analytics_only boolean DEFAULT false;

COMMENT ON COLUMN compliance_results.analytics_only IS 
'Analytics-only compliance record (legacy backfill) - does not trigger breach alerts or enforcement';

-- ==================== HELPER FUNCTIONS ====================

-- Compute breach status for a legacy observation (inline logic)
CREATE OR REPLACE FUNCTION compute_legacy_breach_status(p_obs_id uuid)
RETURNS TABLE (
  is_breach boolean,
  is_homeless_exempt boolean,
  violation_reasons text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plate text;
  v_zone_id uuid;
  v_org_id uuid;
  v_recorded_at timestamptz;
  v_homeless_status text;
  v_consecutive int := 0;
  v_monthly int := 0;
  v_max_consecutive int := 3;
  v_max_monthly int := 28;
  v_requires_csc boolean := true;
  v_has_csc boolean := false;
  v_breach boolean := false;
  v_violations text[] := ARRAY[]::text[];
BEGIN
  -- Get observation details
  SELECT 
    o.plate_number,
    o.zone_id,
    o.organization_id,
    o.recorded_at
  INTO v_plate, v_zone_id, v_org_id, v_recorded_at
  FROM vehicle_observations_v2 o
  WHERE o.observation_id = p_obs_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, ARRAY[]::text[];
    RETURN;
  END IF;

  -- Get zone compliance rules
  SELECT 
    COALESCE(requires_csc, true),
    COALESCE(max_consecutive_nights, 3),
    COALESCE(nights_per_month, 28)
  INTO v_requires_csc, v_max_consecutive, v_max_monthly
  FROM zone_compliance_matrix
  WHERE zone_id = v_zone_id 
    AND effective_to IS NULL
  LIMIT 1;

  -- Get vehicle details
  SELECT 
    COALESCE(homeless_status, 'none'),
    (nzscv_warrant_type IS NOT NULL AND 
     (nzscv_warrant_expires_on IS NULL OR nzscv_warrant_expires_on >= current_date))
  INTO v_homeless_status, v_has_csc
  FROM canonical_vehicles
  WHERE plate_number = v_plate;

  -- Get monthly stays
  SELECT 
    COALESCE(SUM(nights_stayed), 0),
    COALESCE(MAX(consecutive_nights), 0)
  INTO v_monthly, v_consecutive
  FROM vehicle_monthly_stays
  WHERE plate_number = v_plate
    AND zone_id = v_zone_id
    AND organization_id = v_org_id
    AND calendar_month = date_trunc('month', v_recorded_at::date)::date;

  -- Evaluate breaches
  IF v_requires_csc AND NOT v_has_csc THEN
    v_breach := true;
    v_violations := array_append(v_violations, 'csc_required');
  END IF;

  IF v_consecutive > v_max_consecutive THEN
    v_breach := true;
    v_violations := array_append(v_violations, 'max_consecutive_nights');
  END IF;

  IF v_monthly > v_max_monthly THEN
    v_breach := true;
    v_violations := array_append(v_violations, 'monthly_limit_exceeded');
  END IF;

  -- Return results
  RETURN QUERY SELECT 
    v_breach,
    (v_homeless_status = 'confirmed'),
    v_violations;
END;
$$;

COMMENT ON FUNCTION compute_legacy_breach_status(uuid) IS
'Compute breach status for legacy observations without compliance_results (analytics backfill only)';

-- ==================== BACKFILL PROCEDURE ====================

CREATE OR REPLACE FUNCTION backfill_legacy_compliance(
  p_batch_size int DEFAULT 1000,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS TABLE (
  processed int,
  breaches_found int,
  homeless_exempt int,
  compliant int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_processed int := 0;
  v_breaches int := 0;
  v_homeless int := 0;
  v_compliant int := 0;
  v_batch record;
BEGIN
  RAISE NOTICE '🔄 Starting legacy compliance backfill (batch size: %)', p_batch_size;

  -- Process in batches to avoid long locks
  FOR v_batch IN (
    WITH missing AS (
      SELECT 
        o.observation_id,
        o.plate_number,
        o.zone_id,
        o.organization_id,
        o.recorded_at
      FROM vehicle_observations_v2 o
      LEFT JOIN compliance_results cr ON cr.observation_id = o.observation_id
      WHERE o.is_legacy_import = true
        AND cr.observation_id IS NULL
        AND (p_date_from IS NULL OR o.recorded_at::date >= p_date_from)
        AND (p_date_to IS NULL OR o.recorded_at::date <= p_date_to)
      ORDER BY o.recorded_at DESC
      LIMIT p_batch_size
    )
    SELECT * FROM missing
  )
  LOOP
    -- Compute compliance for this observation
    DECLARE
      v_compliance record;
    BEGIN
      SELECT * INTO v_compliance
      FROM compute_legacy_breach_status(v_batch.observation_id);

      -- Insert analytics-only compliance record
      INSERT INTO compliance_results (
        observation_id,
        vehicle_id, -- Will be null for legacy, that's OK
        zone_id,
        organization_id,
        is_breach,
        is_homeless_exempt,
        violation_reasons,
        recorded_at,
        analytics_only,
        created_at
      ) VALUES (
        v_batch.observation_id,
        NULL, -- Legacy observations don't link to vehicle_id
        v_batch.zone_id,
        v_batch.organization_id,
        v_compliance.is_breach,
        v_compliance.is_homeless_exempt,
        v_compliance.violation_reasons,
        v_batch.recorded_at,
        true, -- Mark as analytics-only to prevent alert triggers
        now()
      );

      v_processed := v_processed + 1;
      
      IF v_compliance.is_breach THEN
        IF v_compliance.is_homeless_exempt THEN
          v_homeless := v_homeless + 1;
        ELSE
          v_breaches := v_breaches + 1;
        END IF;
      ELSE
        v_compliant := v_compliant + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to backfill compliance for observation %: %', v_batch.observation_id, SQLERRM;
      CONTINUE;
    END;
  END LOOP;

  RAISE NOTICE '✅ Backfill complete: % processed, % breaches, % homeless-exempt, % compliant',
    v_processed, v_breaches, v_homeless, v_compliant;

  RETURN QUERY SELECT v_processed, v_breaches, v_homeless, v_compliant;
END;
$$;

COMMENT ON FUNCTION backfill_legacy_compliance(int, date, date) IS
'Backfill analytics-only compliance for legacy observations - run in batches to avoid locks';

-- ==================== PREVENT FUTURE ALERTS FROM ANALYTICS ROWS ====================

-- Update breach alert trigger to skip analytics-only compliance
CREATE OR REPLACE FUNCTION create_breach_alert_from_compliance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Skip analytics-only compliance (legacy backfill)
  IF NEW.analytics_only = true THEN
    RETURN NEW;
  END IF;

  -- Original logic: only create alert if it's a new breach
  IF NEW.is_breach = true AND 
     NOT EXISTS (
       SELECT 1 FROM breach_alerts
       WHERE observation_id = NEW.observation_id
     ) THEN
    
    INSERT INTO breach_alerts (
      organization_id,
      zone_id,
      observation_id,
      plate_number,
      breach_type,
      breach_details,
      status,
      created_at
    )
    SELECT
      o.organization_id,
      o.zone_id,
      o.observation_id,
      o.plate_number,
      o.breach_type,
      o.breach_details,
      'pending',
      now()
    FROM vehicle_observations_v2 o
    WHERE o.observation_id = NEW.observation_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ==================== RUN INITIAL BACKFILL (small batch for safety) ====================

-- Backfill last 90 days first (testing)
DO $$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO v_result
  FROM backfill_legacy_compliance(
    p_batch_size := 500,
    p_date_from := current_date - interval '90 days',
    p_date_to := current_date
  );

  RAISE NOTICE '📊 Initial backfill results: % obs, % breaches, % homeless-exempt, % compliant',
    v_result.processed, v_result.breaches_found, v_result.homeless_exempt, v_result.compliant;
END;
$$;

-- ==================== INDEXES ====================

CREATE INDEX IF NOT EXISTS idx_compliance_analytics_only
  ON compliance_results(analytics_only)
  WHERE analytics_only = true;

CREATE INDEX IF NOT EXISTS idx_compliance_homeless_exempt
  ON compliance_results(is_homeless_exempt)
  WHERE is_homeless_exempt = true;

-- ==================== GRANTS ====================

GRANT EXECUTE ON FUNCTION compute_legacy_breach_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION backfill_legacy_compliance(int, date, date) TO authenticated;

-- ==================== USAGE NOTES ====================

COMMENT ON FUNCTION backfill_legacy_compliance IS 
'USAGE:
-- Backfill all legacy observations (run in multiple calls if needed):
SELECT * FROM backfill_legacy_compliance(1000, NULL, NULL);

-- Backfill specific date range:
SELECT * FROM backfill_legacy_compliance(1000, ''2025-01-01'', ''2025-02-19'');

-- Check progress:
SELECT 
  count(*) FILTER (WHERE analytics_only) as analytics_rows,
  count(*) FILTER (WHERE NOT analytics_only) as live_rows
FROM compliance_results;

-- Verify KPIs now include legacy:
SELECT count(*) FROM cohort_overstayers(
  ''2026-02-01T00:00:00+13'', 
  ''2026-02-19T23:59:59+13'', 
  NULL, NULL
);
';
