-- =============================================================================
-- Migration: 20260610000001_person_observations_canonical_upgrade.sql
-- Purpose:   Upgrade person_observations to be a full canonical person
--            observation log — mirroring how vehicle_observations / observations
--            works for canonical_vehicles.
--
-- Key changes:
--   1. Add canonical_person_id FK → canonical_persons(id)  (nullable so existing
--      rows keep working; backfill from person_records → canonical_persons)
--   2. Add identification_method   — how the person was identified at observation time
--   3. Add match_confidence        — 0.0-1.0 face/ID match score
--   4. Add alert_generated         — true if a safety flag was surfaced to the officer
--   5. Add geofence_validated      — true if officer GPS was inside the zone geofence
--   6. Add is_minor_record         — mirrors canonical_persons.is_minor at time of obs
--   7. Add observation_id FK → observations(observation_id) so a person observation
--      can optionally be linked to the vehicle scan that triggered it
--   8. Replace get_person_observation_history() RPC — now joins canonical_persons
--   9. Add get_canonical_person_obs_history() RPC — primary query path
--  10. Add RLS policy for canonical_person_id lookup
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- §1  New columns on person_observations
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.person_observations
  ADD COLUMN IF NOT EXISTS canonical_person_id   UUID        REFERENCES public.canonical_persons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS identification_method TEXT        CHECK (identification_method IN (
      'face_scan',            -- biometric face match via embedding
      'id_scan',              -- physical ID / passport OCR
      'vehicle_association',  -- linked via vehicle plate scan
      'officer_encounter',    -- officer manually identified in field
      'manual_entry',         -- admin or officer typed in details
      'unknown'               -- could not be determined
  )),
  ADD COLUMN IF NOT EXISTS match_confidence       NUMERIC(5,4) CHECK (match_confidence >= 0 AND match_confidence <= 1),
  ADD COLUMN IF NOT EXISTS alert_generated        BOOLEAN     DEFAULT false,
  ADD COLUMN IF NOT EXISTS alert_types            TEXT[]      DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS geofence_validated     BOOLEAN     DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_minor_record        BOOLEAN     DEFAULT false,
  ADD COLUMN IF NOT EXISTS observation_id         UUID        REFERENCES public.observations(observation_id) ON DELETE SET NULL;

COMMENT ON COLUMN public.person_observations.canonical_person_id
  IS 'FK to canonical_persons — the master person registry record. Nullable for backward compatibility with legacy person_records.id rows.';

COMMENT ON COLUMN public.person_observations.identification_method
  IS 'How the person was identified at time of this observation. face_scan uses biometric embedding (no photo stored). id_scan uses OCR from driver licence / passport.';

COMMENT ON COLUMN public.person_observations.match_confidence
  IS 'Match confidence 0.0–1.0 from face recognition or ID scan. NULL for manual/officer entries.';

COMMENT ON COLUMN public.person_observations.alert_generated
  IS 'True if this observation triggered a safety flag alert to the responding officer.';

COMMENT ON COLUMN public.person_observations.alert_types
  IS 'Array of alert types that fired: trespassed | banned | poi | flagged | safety_risk.';

COMMENT ON COLUMN public.person_observations.geofence_validated
  IS 'True if the officer GPS position was confirmed inside the zone geofence at time of observation. Zone-restricted records are only surfaced when this is true.';

COMMENT ON COLUMN public.person_observations.is_minor_record
  IS 'Snapshot of is_minor from canonical_persons at time of observation. Retained so historical records can apply correct redaction rules even if the person later turns 18.';

COMMENT ON COLUMN public.person_observations.observation_id
  IS 'Optional FK to observations (vehicle scan) that triggered this person observation via process-officer-scan Step 5c.';

-- ─────────────────────────────────────────────────────────────────────────────
-- §2  Performance indexes for new columns
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_person_obs_canonical_person
  ON public.person_observations(canonical_person_id)
  WHERE canonical_person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_person_obs_identification_method
  ON public.person_observations(identification_method);

CREATE INDEX IF NOT EXISTS idx_person_obs_alert_generated
  ON public.person_observations(alert_generated)
  WHERE alert_generated = true;

CREATE INDEX IF NOT EXISTS idx_person_obs_vehicle_observation
  ON public.person_observations(observation_id)
  WHERE observation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_person_obs_is_minor
  ON public.person_observations(is_minor_record)
  WHERE is_minor_record = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- §3  Backfill canonical_person_id from person_records → canonical_persons
--     The 20260609 migration already added canonical_person_id FK to person_records
--     and backfilled it from persons_of_interest / person_records. We now use that
--     link to populate person_observations.canonical_person_id.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'person_records'
      AND column_name  = 'canonical_person_id'
  ) THEN
    UPDATE public.person_observations po
    SET    canonical_person_id = pr.canonical_person_id
    FROM   public.person_records pr
    WHERE  pr.id = po.person_id
      AND  pr.canonical_person_id IS NOT NULL
      AND  po.canonical_person_id IS NULL;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §4  Trigger: auto-stamp is_minor_record on insert
--     Prevents application bugs where is_minor might not be set.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.stamp_person_obs_minor_flag()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- If canonical_person_id is set, copy the is_minor flag from canonical_persons
  IF NEW.canonical_person_id IS NOT NULL THEN
    SELECT is_minor INTO NEW.is_minor_record
    FROM   public.canonical_persons
    WHERE  id = NEW.canonical_person_id;
  END IF;

  -- Default identification_method if not supplied
  IF NEW.identification_method IS NULL THEN
    NEW.identification_method := 'unknown';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_person_obs_minor ON public.person_observations;
CREATE TRIGGER trg_stamp_person_obs_minor
  BEFORE INSERT ON public.person_observations
  FOR EACH ROW EXECUTE FUNCTION public.stamp_person_obs_minor_flag();

-- ─────────────────────────────────────────────────────────────────────────────
-- §5  Replace get_person_observation_history() — now joins canonical_persons
--     Keeps the same signature (p_person_id uuid = person_records.id) for
--     backward compatibility with existing callers.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_person_observation_history(uuid);

CREATE OR REPLACE FUNCTION public.get_person_observation_history(p_person_id uuid)
RETURNS TABLE (
  id                    UUID,
  observation_type      TEXT,
  identification_method TEXT,
  match_confidence      NUMERIC,
  recorded_at           TIMESTAMPTZ,
  officer_name          TEXT,
  zone_name             TEXT,
  plate_number          TEXT,
  officer_notes         TEXT,
  evidence_photos       TEXT[],
  alert_generated       BOOLEAN,
  alert_types           TEXT[],
  geofence_validated    BOOLEAN,
  is_minor_record       BOOLEAN,
  vehicle_make          TEXT,
  vehicle_model         TEXT,
  vehicle_color         TEXT,
  canonical_person_id   UUID
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    po.id,
    po.observation_type,
    po.identification_method,
    po.match_confidence,
    po.recorded_at,
    CONCAT(up.first_name, ' ', up.last_name)        AS officer_name,
    z.name                                           AS zone_name,
    po.plate_number,
    po.officer_notes,
    po.evidence_photos,
    po.alert_generated,
    po.alert_types,
    po.geofence_validated,
    po.is_minor_record,
    cv.vehicle_make,
    cv.vehicle_model,
    cv.vehicle_color,
    po.canonical_person_id
  FROM   public.person_observations  po
  LEFT JOIN public.user_profiles  up ON up.id          = po.recorded_by
  LEFT JOIN public.zones          z  ON z.id           = po.zone_id
  LEFT JOIN public.canonical_vehicles cv
                                     ON cv.plate_number = po.plate_number
  WHERE  po.person_id = p_person_id
  ORDER BY po.recorded_at DESC;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §6  New RPC: get_canonical_person_obs_history()
--     Primary query path — looks up by canonical_person_id instead of
--     the legacy person_records FK.
--     Also enforces zone-restriction: officers only see zone-restricted
--     observations if they are currently inside the relevant zone.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_canonical_person_obs_history(
  p_canonical_person_id UUID,
  p_caller_lat          NUMERIC DEFAULT NULL,
  p_caller_lon          NUMERIC DEFAULT NULL
)
RETURNS TABLE (
  id                    UUID,
  person_id             UUID,
  observation_type      TEXT,
  identification_method TEXT,
  match_confidence      NUMERIC,
  recorded_at           TIMESTAMPTZ,
  officer_name          TEXT,
  zone_name             TEXT,
  zone_id               UUID,
  plate_number          TEXT,
  officer_notes         TEXT,
  evidence_photos       TEXT[],
  alert_generated       BOOLEAN,
  alert_types           TEXT[],
  geofence_validated    BOOLEAN,
  is_minor_record       BOOLEAN,
  vehicle_make          TEXT,
  vehicle_model         TEXT,
  vehicle_color         TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role              TEXT;
  v_org_id            UUID;
  v_zone_restricted   BOOLEAN;
  v_zone_ids          UUID[];
BEGIN
  -- Get caller role & org
  SELECT role, organization_id
  INTO   v_role, v_org_id
  FROM   public.user_profiles
  WHERE  id = auth.uid();

  -- Get zone_restricted status for this canonical person
  SELECT zone_restricted, zone_ids
  INTO   v_zone_restricted, v_zone_ids
  FROM   public.canonical_persons
  WHERE  id = p_canonical_person_id;

  RETURN QUERY
  SELECT
    po.id,
    po.person_id,
    po.observation_type,
    po.identification_method,
    po.match_confidence,
    po.recorded_at,
    CONCAT(up.first_name, ' ', up.last_name)        AS officer_name,
    z.name                                           AS zone_name,
    po.zone_id,
    po.plate_number,
    -- Redact notes for minors for non-admin officers
    CASE
      WHEN po.is_minor_record AND v_role = 'officer' THEN '[Restricted — contact supervisor]'
      ELSE po.officer_notes
    END                                              AS officer_notes,
    po.evidence_photos,
    po.alert_generated,
    po.alert_types,
    po.geofence_validated,
    po.is_minor_record,
    cv.vehicle_make,
    cv.vehicle_model,
    cv.vehicle_color
  FROM   public.person_observations  po
  LEFT JOIN public.user_profiles  up ON up.id          = po.recorded_by
  LEFT JOIN public.zones          z  ON z.id           = po.zone_id
  LEFT JOIN public.canonical_vehicles cv
                                     ON cv.plate_number = po.plate_number
  WHERE  po.canonical_person_id = p_canonical_person_id
    -- Org filter (master sees all)
    AND (v_role = 'master' OR po.organization_id = v_org_id)
    -- Zone restriction gate: if zone_restricted and caller GPS provided,
    -- only include observations from zones the caller is currently inside.
    -- Admin / master bypass this check.
    AND (
      v_role IN ('admin', 'master', 'admin_officer')
      OR NOT v_zone_restricted
      OR p_caller_lat IS NULL
      OR p_caller_lon IS NULL
      OR (
        -- For each observation, check if the caller is within the observation's zone
        EXISTS (
          SELECT 1 FROM public.zones z2
          WHERE  z2.id = po.zone_id
            AND (z2.radius_meters IS NULL OR (
              6371000 * 2 * ASIN(SQRT(
                POWER(SIN(RADIANS((p_caller_lat - z2.location_lat) / 2)), 2) +
                COS(RADIANS(z2.location_lat)) * COS(RADIANS(p_caller_lat)) *
                POWER(SIN(RADIANS((p_caller_lon - z2.location_lng) / 2)), 2)
              )) <= COALESCE(z2.radius_meters, 500)
            ))
        )
      )
    )
  ORDER BY po.recorded_at DESC;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §7  Additional RLS policy for canonical_person_id lookup
--     Allows querying person_observations by canonical_person_id directly
--     (supplements existing org-scoped policy).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'person_observations'
      AND policyname = 'users_view_canonical_person_observations'
  ) THEN
    EXECUTE $POLICY$
      CREATE POLICY "users_view_canonical_person_observations"
        ON public.person_observations FOR SELECT
        USING (
          get_user_role(auth.uid()) = 'master'
          OR organization_id = get_user_organization_id(auth.uid())
        )
    $POLICY$;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §8  View: v_canonical_person_observation_summary
--     Aggregates per canonical_person_id — used for the person profile card
--     to show "Seen 4 times across 2 zones, last seen 3 days ago"
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_canonical_person_obs_summary AS
SELECT
  po.canonical_person_id,
  cp.first_name,
  cp.last_name,
  cp.is_minor,
  cp.is_trespassed,
  cp.is_banned,
  cp.is_poi,
  cp.is_flagged,
  cp.risk_level,
  COUNT(*)                              AS total_observations,
  COUNT(DISTINCT po.zone_id)            AS distinct_zones,
  COUNT(DISTINCT po.plate_number)
    FILTER (WHERE po.plate_number IS NOT NULL)
                                        AS distinct_vehicles,
  MAX(po.recorded_at)                   AS last_observed_at,
  MIN(po.recorded_at)                   AS first_observed_at,
  COUNT(*) FILTER (WHERE po.alert_generated)
                                        AS total_alerts,
  ARRAY_AGG(DISTINCT po.identification_method)
    FILTER (WHERE po.identification_method IS NOT NULL)
                                        AS identification_methods_used,
  -- Most recent zone
  (SELECT z.name FROM public.zones z
   WHERE  z.id = (
     SELECT po2.zone_id FROM public.person_observations po2
     WHERE  po2.canonical_person_id = po.canonical_person_id
     ORDER BY po2.recorded_at DESC LIMIT 1
   )) AS last_zone_name
FROM public.person_observations po
JOIN public.canonical_persons    cp ON cp.id = po.canonical_person_id
WHERE po.canonical_person_id IS NOT NULL
GROUP BY
  po.canonical_person_id,
  cp.first_name,
  cp.last_name,
  cp.is_minor,
  cp.is_trespassed,
  cp.is_banned,
  cp.is_poi,
  cp.is_flagged,
  cp.risk_level;

COMMENT ON VIEW public.v_canonical_person_obs_summary IS
  'Per canonical_person aggregated observation stats. Used in person profile cards and dashboards.';

-- ─────────────────────────────────────────────────────────────────────────────
-- §9  Function: record_person_observation_from_scan()
--     Called by process-officer-scan Step 5c when a person alert fires.
--     Creates a person_observation record automatically so the observation
--     trail is maintained without requiring a separate API call.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_person_observation_from_scan(
  p_canonical_person_id UUID,
  p_observation_id      UUID,          -- vehicle scan observation
  p_zone_id             UUID,
  p_organization_id     UUID,
  p_recorded_by         UUID,
  p_plate_number        TEXT DEFAULT NULL,
  p_alert_types         TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_geofence_validated  BOOLEAN DEFAULT false,
  p_officer_lat         NUMERIC DEFAULT NULL,
  p_officer_lon         NUMERIC DEFAULT NULL,
  p_officer_accuracy    NUMERIC DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_obs_id UUID;
  v_person canonical_persons%ROWTYPE;
BEGIN
  -- Load canonical person
  SELECT * INTO v_person
  FROM   public.canonical_persons
  WHERE  id = p_canonical_person_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Insert person observation (trigger will set is_minor_record, identification_method)
  INSERT INTO public.person_observations (
    canonical_person_id,
    person_id,          -- legacy FK: try to find matching person_records row
    zone_id,
    organization_id,
    recorded_by,
    recorded_at,
    plate_number,
    observation_type,
    identification_method,
    alert_generated,
    alert_types,
    geofence_validated,
    gps_latitude,
    gps_longitude,
    gps_accuracy,
    officer_notes,
    observation_id
  )
  VALUES (
    p_canonical_person_id,
    -- Attempt to find legacy person_records.id via canonical link
    (SELECT id FROM public.person_records
     WHERE  canonical_person_id = p_canonical_person_id
     LIMIT  1),
    p_zone_id,
    p_organization_id,
    p_recorded_by,
    NOW(),
    p_plate_number,
    'vehicle_association',   -- triggered by a vehicle scan (aligned with identification_method)
    'vehicle_association',
    (array_length(p_alert_types, 1) > 0),
    p_alert_types,
    p_geofence_validated,
    p_officer_lat,
    p_officer_lon,
    p_officer_accuracy,
    CASE
      WHEN array_length(p_alert_types, 1) > 0
      THEN 'Auto-generated from vehicle scan. Alert types: ' || array_to_string(p_alert_types, ', ')
      ELSE 'Auto-generated from vehicle scan — person linked to observed plate.'
    END,
    p_observation_id
  )
  RETURNING id INTO v_obs_id;

  -- Also update canonical_persons.last_seen_at
  UPDATE public.canonical_persons
  SET    last_seen_at   = NOW(),
         last_seen_zone = p_zone_id,
         updated_at     = NOW()
  WHERE  id = p_canonical_person_id;

  RETURN v_obs_id;
END;
$$;

COMMENT ON FUNCTION public.record_person_observation_from_scan IS
  'Called by process-officer-scan Step 5c. Auto-creates a person_observation when a person alert fires during a vehicle plate scan. Returns the new person_observation.id.';

-- ─────────────────────────────────────────────────────────────────────────────
-- §10  Add last_seen_at / last_seen_zone columns to canonical_persons
--      (used by record_person_observation_from_scan above)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.canonical_persons
  ADD COLUMN IF NOT EXISTS last_seen_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_zone UUID REFERENCES public.zones(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.canonical_persons.last_seen_at
  IS 'Timestamp of the most recent person_observation for this canonical person. Maintained by record_person_observation_from_scan().';

COMMENT ON COLUMN public.canonical_persons.last_seen_zone
  IS 'Zone of the most recent person observation. Maintained by record_person_observation_from_scan().';

CREATE INDEX IF NOT EXISTS idx_canonical_persons_last_seen
  ON public.canonical_persons(last_seen_at DESC NULLS LAST)
  WHERE last_seen_at IS NOT NULL;
