-- Zone Requirements Breakdown for Court Evidence
-- Provides per-requirement evaluation with color-coded status and reasons
-- Supports "breach but exempt" (homeless) transparency for welfare pathways

-- ==================== EVALUATION FUNCTION ====================

CREATE OR REPLACE FUNCTION evaluate_observation_requirements(p_obs_id uuid)
RETURNS TABLE (
  observation_id uuid,
  requirement_code text,        -- e.g., 'csc_required', 'max_nights', 'monthly_limit'
  requirement_label text,       -- human label for UI
  status text,                  -- 'yes' | 'no' | 'breach' | 'breach_exempt'
  reason text,                  -- short "why" blurb for officers / court
  sort_order int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  obs record;
  zone_rules record;
  homeless_status text;
  is_homeless boolean := false;
  consecutive_nights int := 0;
  monthly_stays int := 0;
  requires_csc boolean := true;
  vehicle_has_csc boolean := false;
  csc_warrant text;
  csc_expiry date;
  max_consecutive int;
  max_monthly int;
BEGIN
  -- Pull observation with zone compliance rules and vehicle details
  SELECT 
    o.*,
    zcm.requires_csc,
    zcm.max_consecutive_nights,
    zcm.nights_per_month,
    cv.nzscv_warrant_type,
    cv.nzscv_warrant_expires_on,
    cv.homeless_status
  INTO obs, zone_rules, csc_warrant, csc_expiry, homeless_status
  FROM vehicle_observations_v2 o
  LEFT JOIN zone_compliance_matrix zcm ON zcm.zone_id = o.zone_id AND zcm.effective_to IS NULL
  LEFT JOIN canonical_vehicles cv ON cv.plate_number = o.plate_number
  WHERE o.observation_id = p_obs_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Derive compliance inputs
  is_homeless := COALESCE(homeless_status = 'confirmed', false);
  requires_csc := COALESCE(zone_rules.requires_csc, true);
  vehicle_has_csc := (csc_warrant IS NOT NULL) AND (csc_expiry IS NULL OR csc_expiry >= current_date);
  max_consecutive := COALESCE(zone_rules.max_consecutive_nights, 3);
  max_monthly := COALESCE(zone_rules.nights_per_month, 28);

  -- Get monthly stays for this vehicle
  SELECT COALESCE(SUM(nights_stayed), 0), COALESCE(MAX(consecutive_nights), 0)
  INTO monthly_stays, consecutive_nights
  FROM vehicle_monthly_stays
  WHERE plate_number = obs.plate_number
    AND zone_id = obs.zone_id
    AND calendar_month >= date_trunc('month', obs.recorded_at::date)
    AND calendar_month <= date_trunc('month', obs.recorded_at::date);

  -- ==================== REQUIREMENT 1: SELF-CONTAINED VEHICLE ====================
  RETURN QUERY
  SELECT 
    p_obs_id,
    'csc_required'::text,
    'Self-contained vehicle required'::text,
    CASE
      WHEN NOT requires_csc THEN 'yes'
      WHEN requires_csc AND vehicle_has_csc THEN 'yes'
      WHEN requires_csc AND NOT vehicle_has_csc AND is_homeless THEN 'breach_exempt'
      ELSE 'breach'
    END,
    CASE
      WHEN NOT requires_csc THEN 'Zone allows non-CSC vehicles'
      WHEN requires_csc AND vehicle_has_csc THEN 
        format('CSC %s (expires %s)', 
          COALESCE(csc_warrant, 'Unknown'), 
          COALESCE(csc_expiry::text, 'No expiry'))
      WHEN requires_csc AND NOT vehicle_has_csc AND is_homeless THEN 
        'CSC required but not held; homeless exemption applies (welfare pathway)'
      ELSE 'CSC required by zone bylaw; no current certification found'
    END,
    10;

  -- ==================== REQUIREMENT 2: MAX CONSECUTIVE NIGHTS ====================
  RETURN QUERY
  SELECT 
    p_obs_id,
    'max_nights'::text,
    'Maximum consecutive nights'::text,
    CASE
      WHEN consecutive_nights <= max_consecutive THEN 'yes'
      WHEN consecutive_nights > max_consecutive AND is_homeless THEN 'breach_exempt'
      ELSE 'breach'
    END,
    CASE
      WHEN consecutive_nights <= max_consecutive THEN 
        format('%s/%s consecutive nights (compliant)', consecutive_nights, max_consecutive)
      WHEN consecutive_nights > max_consecutive AND is_homeless THEN 
        format('%s/%s consecutive nights; breach in principle but homeless exemption applies', 
          consecutive_nights, max_consecutive)
      ELSE 
        format('%s/%s consecutive nights (limit exceeded - infringement applicable)', 
          consecutive_nights, max_consecutive)
    END,
    20;

  -- ==================== REQUIREMENT 3: MONTHLY STAYS LIMIT ====================
  RETURN QUERY
  SELECT 
    p_obs_id,
    'monthly_limit'::text,
    'Monthly stays limit'::text,
    CASE
      WHEN monthly_stays <= max_monthly THEN 'yes'
      WHEN monthly_stays > max_monthly AND is_homeless THEN 'breach_exempt'
      ELSE 'breach'
    END,
    CASE
      WHEN monthly_stays <= max_monthly THEN 
        format('%s/%s nights this month (compliant)', monthly_stays, max_monthly)
      WHEN monthly_stays > max_monthly AND is_homeless THEN 
        format('%s/%s nights this month; breach in principle but homeless exemption applies', 
          monthly_stays, max_monthly)
      ELSE 
        format('%s/%s nights this month (limit exceeded - infringement applicable)', 
          monthly_stays, max_monthly)
    END,
    30;

  -- ==================== REQUIREMENT 4: NO OVERNIGHT (if zone has time restrictions) ====================
  -- Example: Add if you track time-based restrictions
  -- For now, this is a placeholder you can extend with zone-specific rules

END;
$$;

COMMENT ON FUNCTION evaluate_observation_requirements(uuid) IS 
'Returns requirement-by-requirement breakdown for court evidence with status (yes/no/breach/breach_exempt) and reasons';

-- ==================== READ MODEL VIEW ====================

CREATE OR REPLACE VIEW observation_requirements AS
SELECT 
  (r).observation_id,
  (r).requirement_code,
  (r).requirement_label,
  (r).status,
  (r).reason,
  (r).sort_order
FROM (
  SELECT evaluate_observation_requirements(o.observation_id) as r
  FROM vehicle_observations_v2 o
) t;

COMMENT ON VIEW observation_requirements IS 
'Fast read model for zone requirements checklist (UI and PDF exports)';

-- ==================== RLS POLICIES ====================

-- Allow users to view requirements for observations in their org
CREATE POLICY users_view_observation_requirements
  ON observation_requirements
  FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master') OR
    (EXISTS (
      SELECT 1 FROM vehicle_observations_v2 o
      WHERE o.observation_id = observation_requirements.observation_id
        AND o.organization_id = ANY(get_user_organization_ids())
    ))
  );

-- ==================== KPI DRILL-DOWN RPC ====================

CREATE OR REPLACE FUNCTION observations_homeless_exempt(
  p_from timestamptz,
  p_to timestamptz,
  p_org_id uuid DEFAULT NULL,
  p_zone_id uuid DEFAULT NULL
)
RETURNS TABLE (
  observation_id uuid,
  plate_number text,
  zone_id uuid,
  zone_name text,
  recorded_at timestamptz,
  homeless_status text,
  breach_type text,
  organization_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    o.observation_id,
    o.plate_number,
    o.zone_id,
    z.name as zone_name,
    o.recorded_at,
    cv.homeless_status,
    o.breach_type,
    o.organization_id
  FROM vehicle_observations_v2 o
  JOIN zones z ON z.id = o.zone_id
  JOIN canonical_vehicles cv ON cv.plate_number = o.plate_number
  WHERE o.recorded_at BETWEEN p_from AND p_to
    AND (p_org_id IS NULL OR o.organization_id = p_org_id)
    AND (p_zone_id IS NULL OR o.zone_id = p_zone_id)
    AND o.is_breach = true
    AND cv.homeless_status = 'confirmed'
  ORDER BY o.recorded_at DESC;
$$;

COMMENT ON FUNCTION observations_homeless_exempt(timestamptz, timestamptz, uuid, uuid) IS 
'Returns observations that breached rules but are exempt due to confirmed homeless status (welfare pathway)';

-- ==================== INDEXES ====================

-- Index on observation_id for fast lookups in the view
CREATE INDEX IF NOT EXISTS idx_vehicle_observations_v2_obs_id 
  ON vehicle_observations_v2(observation_id);

-- ==================== GRANTS ====================

GRANT EXECUTE ON FUNCTION evaluate_observation_requirements(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION observations_homeless_exempt(timestamptz, timestamptz, uuid, uuid) TO authenticated;
GRANT SELECT ON observation_requirements TO authenticated;
