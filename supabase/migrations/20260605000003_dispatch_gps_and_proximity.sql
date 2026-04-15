-- =============================================================================
-- DISPATCH GPS & OFFICER PROXIMITY
-- =============================================================================
-- Provides a SQL function that, given a job location, returns on-shift officers
-- ranked by straight-line (Haversine) distance from their last known GPS fix.
--
-- Used by the DispatchConsole to show "closest officer first" when assigning.
-- =============================================================================

-- =============================================================================
-- 1. HELPER — Haversine distance in kilometres
-- =============================================================================
-- Returns the great-circle distance (km) between two lat/lng points.
-- This avoids a PostGIS dependency — precision is ±0.5% which is sufficient
-- for dispatch-proximity sorting within a city / region.

CREATE OR REPLACE FUNCTION public.haversine_km(
  lat1 DOUBLE PRECISION,
  lng1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION,
  lng2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT
    2 * 6371 *           -- Earth radius in km
    asin(
      sqrt(
        pow(sin(radians(lat2 - lat1) / 2), 2) +
        cos(radians(lat1)) * cos(radians(lat2)) *
        pow(sin(radians(lng2 - lng1) / 2), 2)
      )
    )
$$;

COMMENT ON FUNCTION public.haversine_km IS
  'Returns the great-circle distance in km between two lat/lng points (Haversine formula). No PostGIS required.';

-- =============================================================================
-- 2. NEAREST OFFICERS  — ranked by distance from a job location
-- =============================================================================
-- Returns on-shift officers with their last known GPS, sorted closest-first.
-- Officers without a GPS fix appear last (distance NULL).
--
-- Parameters:
--   p_job_lat        — job latitude  (NULL = no location, returns all sorted by name)
--   p_job_lng        — job longitude
--   p_organization_id — scope to this org's officers
--   p_max_results    — cap results (default 20)
--   p_max_age_minutes — ignore GPS fixes older than this (default 120 min, 0 = no limit)

CREATE OR REPLACE FUNCTION public.get_nearest_officers(
  p_job_lat          DOUBLE PRECISION DEFAULT NULL,
  p_job_lng          DOUBLE PRECISION DEFAULT NULL,
  p_organization_id  UUID             DEFAULT NULL,
  p_max_results      INTEGER          DEFAULT 20,
  p_max_age_minutes  INTEGER          DEFAULT 120
)
RETURNS TABLE (
  officer_id          UUID,
  first_name          TEXT,
  last_name           TEXT,
  phone               TEXT,
  role                TEXT,
  is_on_shift         BOOLEAN,
  active_job_count    BIGINT,
  last_gps_latitude   DOUBLE PRECISION,
  last_gps_longitude  DOUBLE PRECISION,
  last_gps_update     TIMESTAMPTZ,
  gps_age_minutes     INTEGER,
  distance_km         DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
BEGIN
  v_cutoff := CASE
    WHEN p_max_age_minutes > 0
    THEN NOW() - (p_max_age_minutes || ' minutes')::INTERVAL
    ELSE NULL
  END;

  RETURN QUERY
  SELECT
    up.id                               AS officer_id,
    up.first_name,
    up.last_name,
    up.phone,
    up.role,

    -- Is the officer currently on shift (open shift record)?
    EXISTS (
      SELECT 1 FROM public.officer_shifts os
      WHERE os.officer_id = up.id
        AND os.ended_at IS NULL
    )                                   AS is_on_shift,

    -- Count of active dispatch jobs assigned to this officer
    COALESCE((
      SELECT COUNT(*)
      FROM public.dispatch_jobs dj
      WHERE dj.assigned_to = up.id
        AND dj.status IN ('dispatched','acknowledged','en_route','on_scene')
    ), 0)                               AS active_job_count,

    -- Last GPS position from officer_activity_log
    CAST((
      SELECT CAST(oal.gps_latitude AS DOUBLE PRECISION)
      FROM public.officer_activity_log oal
      WHERE oal.user_id = up.id
        AND oal.activity_type = 'gps_update'
        AND oal.gps_latitude IS NOT NULL
        AND (v_cutoff IS NULL OR oal.recorded_at >= v_cutoff)
      ORDER BY oal.recorded_at DESC
      LIMIT 1
    ) AS DOUBLE PRECISION)              AS last_gps_latitude,

    CAST((
      SELECT CAST(oal.gps_longitude AS DOUBLE PRECISION)
      FROM public.officer_activity_log oal
      WHERE oal.user_id = up.id
        AND oal.activity_type = 'gps_update'
        AND oal.gps_longitude IS NOT NULL
        AND (v_cutoff IS NULL OR oal.recorded_at >= v_cutoff)
      ORDER BY oal.recorded_at DESC
      LIMIT 1
    ) AS DOUBLE PRECISION)              AS last_gps_longitude,

    (
      SELECT oal.recorded_at
      FROM public.officer_activity_log oal
      WHERE oal.user_id = up.id
        AND oal.activity_type = 'gps_update'
        AND oal.gps_latitude IS NOT NULL
        AND (v_cutoff IS NULL OR oal.recorded_at >= v_cutoff)
      ORDER BY oal.recorded_at DESC
      LIMIT 1
    )                                   AS last_gps_update,

    -- How old (minutes) is the GPS fix?
    (
      SELECT EXTRACT(EPOCH FROM (NOW() - oal.recorded_at))::INTEGER / 60
      FROM public.officer_activity_log oal
      WHERE oal.user_id = up.id
        AND oal.activity_type = 'gps_update'
        AND oal.gps_latitude IS NOT NULL
        AND (v_cutoff IS NULL OR oal.recorded_at >= v_cutoff)
      ORDER BY oal.recorded_at DESC
      LIMIT 1
    )                                   AS gps_age_minutes,

    -- Distance from job location (NULL if no GPS or no job location)
    CASE
      WHEN p_job_lat IS NULL OR p_job_lng IS NULL THEN NULL
      ELSE (
        SELECT public.haversine_km(
          p_job_lat, p_job_lng,
          CAST(oal.gps_latitude AS DOUBLE PRECISION),
          CAST(oal.gps_longitude AS DOUBLE PRECISION)
        )
        FROM public.officer_activity_log oal
        WHERE oal.user_id = up.id
          AND oal.activity_type = 'gps_update'
          AND oal.gps_latitude IS NOT NULL
          AND (v_cutoff IS NULL OR oal.recorded_at >= v_cutoff)
        ORDER BY oal.recorded_at DESC
        LIMIT 1
      )
    END                                 AS distance_km

  FROM public.user_profiles up
  WHERE up.is_active = TRUE
    AND up.role IN ('officer', 'admin_officer')
    AND (p_organization_id IS NULL OR up.organization_id = p_organization_id)

  ORDER BY
    -- On-shift officers first
    (EXISTS (
      SELECT 1 FROM public.officer_shifts os
      WHERE os.officer_id = up.id AND os.ended_at IS NULL
    )) DESC,
    -- Then by distance (NULLs last)
    CASE
      WHEN p_job_lat IS NULL OR p_job_lng IS NULL THEN NULL
      ELSE (
        SELECT public.haversine_km(
          p_job_lat, p_job_lng,
          CAST(oal2.gps_latitude AS DOUBLE PRECISION),
          CAST(oal2.gps_longitude AS DOUBLE PRECISION)
        )
        FROM public.officer_activity_log oal2
        WHERE oal2.user_id = up.id
          AND oal2.activity_type = 'gps_update'
          AND oal2.gps_latitude IS NOT NULL
          AND (v_cutoff IS NULL OR oal2.recorded_at >= v_cutoff)
        ORDER BY oal2.recorded_at DESC
        LIMIT 1
      )
    END ASC NULLS LAST,
    -- Fallback: available (no active jobs) before busy
    COALESCE((
      SELECT COUNT(*)
      FROM public.dispatch_jobs dj2
      WHERE dj2.assigned_to = up.id
        AND dj2.status IN ('dispatched','acknowledged','en_route','on_scene')
    ), 0) ASC,
    up.last_name ASC

  LIMIT p_max_results;
END;
$$;

COMMENT ON FUNCTION public.get_nearest_officers IS
  'Returns on-shift officers ranked by Haversine distance from the given job GPS location. Officers without a GPS fix or off shift appear last. Used by the Dispatch Console nearest-officer picker.';

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================
