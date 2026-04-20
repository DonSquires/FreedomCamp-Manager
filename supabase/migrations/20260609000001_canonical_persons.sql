-- ============================================================================
-- Migration: Canonical Persons — Unified person registry with zone-scoped visibility
-- ============================================================================
--
-- canonical_persons was created in 20260220000005_core_pipeline_rebuild.sql
-- with a minimal schema (id, full_name, date_of_birth, contact_*, notes,
-- homeless_status, timestamps). This migration extends it to a full-featured
-- master person registry analogous to canonical_vehicles.
--
-- KEY DESIGN DECISIONS
-- --------------------
--
-- 1. UNIFIED MASTER RECORD
--    canonical_persons becomes the single source of truth for every individual
--    encountered during enforcement, access control, or welfare operations.
--    person_records and persons_of_interest are kept for backward compat;
--    a canonical_person_id FK is added to each so existing queries keep working.
--
-- 2. PERSON ↔ VEHICLE BIDIRECTIONAL LINK (person_vehicle_links)
--    person_vehicle_links already links canonical_persons(id) ↔
--    canonical_vehicles(plate_number). When a plate is scanned, Step 5c of
--    process-officer-scan queries this table to surface any flagged/trespassed/
--    high-risk persons associated with the vehicle — and vice versa: viewing a
--    person record shows all vehicles they have been linked to.
--
-- 3. ZONE-SCOPED VISIBILITY (geofence-gated information access)
--    Records can be marked zone_restricted = true. When set, the record's
--    sensitive details are only surfaced by get_canonical_person_for_zone()
--    when the officer's GPS position is inside the relevant zone.
--    Rationale: A trespass at Bus Hub A is not visible to officers at Park B.
--    Enforcement: application-layer RPC (same pattern as process-officer-scan).
--    RLS still enforces hard org isolation.
--
-- 4. YOUTH PROTECTION (under 18)
--    - is_minor auto-set by trigger when DOB confirms age < 18.
--    - Trigger blocks profile_photo_url for minors; face embeddings permitted.
--    - Legal basis: Oranga Tamariki Act 1989; NZ Privacy Act 2020 IPP 1–4.
--
-- 5. UNKNOWN PERSONS
--    All name fields are nullable. identity_status = 'unknown' creates a valid
--    record from face embedding or officer notes alone.
--
-- 6. SYSTEM USER CROSS-REFERENCE
--    user_profile_id (nullable FK) links to user_profiles for contractors /
--    employees who appear in both the access control system AND as system users.
--    This is a cross-reference only — tables remain separate.
--
-- ============================================================================

-- ── 1. Extend canonical_persons with new columns ─────────────────────────────
-- Each column uses ADD COLUMN IF NOT EXISTS so this migration is idempotent
-- whether canonical_persons already exists (upgrade) or is being created fresh.

-- If the table does NOT exist yet (clean install from scratch skipping 2026-02),
-- create it with the base columns first.
CREATE TABLE IF NOT EXISTS public.canonical_persons (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name  TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Organisation scope — required for RLS, not present in original schema
ALTER TABLE public.canonical_persons
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Split name fields (original only had full_name)
ALTER TABLE public.canonical_persons
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name  TEXT;

-- DOB and demographics (original had date_of_birth, extending others)
ALTER TABLE public.canonical_persons
  ADD COLUMN IF NOT EXISTS date_of_birth   DATE,
  ADD COLUMN IF NOT EXISTS gender          TEXT,
  ADD COLUMN IF NOT EXISTS ethnicity       TEXT,
  ADD COLUMN IF NOT EXISTS nationality     TEXT,
  ADD COLUMN IF NOT EXISTS height_cm       INTEGER,
  ADD COLUMN IF NOT EXISTS weight_kg       INTEGER,
  ADD COLUMN IF NOT EXISTS distinguishing_features TEXT,
  ADD COLUMN IF NOT EXISTS description     TEXT;

-- Identity completeness
ALTER TABLE public.canonical_persons
  ADD COLUMN IF NOT EXISTS identity_status TEXT NOT NULL DEFAULT 'unknown';

DO $$ BEGIN
  ALTER TABLE public.canonical_persons
    ADD CONSTRAINT canonical_persons_identity_status_check
    CHECK (identity_status IN ('identified', 'partial', 'unknown'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Youth protection
ALTER TABLE public.canonical_persons
  ADD COLUMN IF NOT EXISTS is_minor                    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_retention_justification TEXT;

-- Profile photo and face embedding
ALTER TABLE public.canonical_persons
  ADD COLUMN IF NOT EXISTS profile_photo_url        TEXT,
  ADD COLUMN IF NOT EXISTS profile_photo_embedding  REAL[],
  ADD COLUMN IF NOT EXISTS profile_photo_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS profile_embedding_quality REAL;

-- Contact (original had contact_email, contact_phone, address — ensure they exist)
ALTER TABLE public.canonical_persons
  ADD COLUMN IF NOT EXISTS contact_email   TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone   TEXT,
  ADD COLUMN IF NOT EXISTS address         TEXT,
  ADD COLUMN IF NOT EXISTS address_verified BOOLEAN DEFAULT false;

-- Status flags
ALTER TABLE public.canonical_persons
  ADD COLUMN IF NOT EXISTS is_poi          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_trespassed   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_banned       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_flagged      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flagged_priority TEXT,
  ADD COLUMN IF NOT EXISTS flagged_reason  TEXT,
  ADD COLUMN IF NOT EXISTS flagged_notes   TEXT,
  ADD COLUMN IF NOT EXISTS flagged_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS flagged_by      UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.canonical_persons
    ADD CONSTRAINT canonical_persons_flagged_priority_check
    CHECK (flagged_priority IN ('low', 'medium', 'high', 'critical'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Access control
ALTER TABLE public.canonical_persons
  ADD COLUMN IF NOT EXISTS access_allowed         BOOLEAN,
  ADD COLUMN IF NOT EXISTS access_clearance_level TEXT,
  ADD COLUMN IF NOT EXISTS access_badge_number    TEXT,
  ADD COLUMN IF NOT EXISTS access_notes           TEXT;

DO $$ BEGIN
  ALTER TABLE public.canonical_persons
    ADD CONSTRAINT canonical_persons_clearance_check
    CHECK (access_clearance_level IN ('public','restricted','confidential','secret','top_secret'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Safety risk (cross-org signal — see global_safety_flags migration for full model)
ALTER TABLE public.canonical_persons
  ADD COLUMN IF NOT EXISTS risk_level    TEXT,
  ADD COLUMN IF NOT EXISTS risk_category TEXT;

DO $$ BEGIN
  ALTER TABLE public.canonical_persons
    ADD CONSTRAINT canonical_persons_risk_level_check
    CHECK (risk_level IN ('low','medium','high','critical'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.canonical_persons
    ADD CONSTRAINT canonical_persons_risk_category_check
    CHECK (risk_category IN ('violence','aggression','weapon','other_safety'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Zone-scoped visibility
ALTER TABLE public.canonical_persons
  ADD COLUMN IF NOT EXISTS zone_restricted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS zone_ids        UUID[]  DEFAULT '{}';

-- Privacy / legal
ALTER TABLE public.canonical_persons
  ADD COLUMN IF NOT EXISTS privacy_notice_given   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS privacy_lawful_purpose TEXT    DEFAULT
    'NZ Trespass Act 1980 / Freedom Camping Act 2011 / access control enforcement',
  ADD COLUMN IF NOT EXISTS collection_authority   TEXT,
  ADD COLUMN IF NOT EXISTS expiry_date            TIMESTAMPTZ;

-- System user cross-reference
ALTER TABLE public.canonical_persons
  ADD COLUMN IF NOT EXISTS user_profile_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- Statistics
ALTER TABLE public.canonical_persons
  ADD COLUMN IF NOT EXISTS total_interactions INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_seen_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at       TIMESTAMPTZ;

-- Audit
ALTER TABLE public.canonical_persons
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

COMMENT ON TABLE public.canonical_persons IS
  'Master person registry. One record per known or unknown individual encountered '
  'during enforcement, access control, or welfare operations. Analogous to '
  'canonical_vehicles for the vehicle registry. Org-scoped with optional zone '
  'restriction for geofence-gated visibility. Linked to canonical_vehicles via '
  'person_vehicle_links for bidirectional person ↔ vehicle association.';

COMMENT ON COLUMN public.canonical_persons.zone_restricted IS
  'If true, this record is only surfaced to field officers when they are inside '
  'one of the associated zones. Enforced at application layer by '
  'get_canonical_person_for_zone() RPC. Admins always see all records.';

COMMENT ON COLUMN public.canonical_persons.is_minor IS
  'Auto-set by trigger when DOB confirms age < 18. profile_photo_url is blocked '
  'for minors by trigger. Face embeddings permitted with documented lawful purpose.';

COMMENT ON COLUMN public.canonical_persons.user_profile_id IS
  'Optional cross-reference to a system user account (contractor / employee). '
  'canonical_persons and user_profiles remain separate — this is NOT a merge.';

-- ── 2. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_canonical_persons_org
  ON public.canonical_persons(organization_id);

CREATE INDEX IF NOT EXISTS idx_canonical_persons_poi
  ON public.canonical_persons(organization_id, is_poi)
  WHERE is_poi = true;

CREATE INDEX IF NOT EXISTS idx_canonical_persons_trespassed
  ON public.canonical_persons(organization_id, is_trespassed)
  WHERE is_trespassed = true;

CREATE INDEX IF NOT EXISTS idx_canonical_persons_flagged
  ON public.canonical_persons(is_flagged)
  WHERE is_flagged = true;

CREATE INDEX IF NOT EXISTS idx_canonical_persons_risk
  ON public.canonical_persons(risk_level, risk_category)
  WHERE risk_level IN ('high','critical') AND risk_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_persons_zone_restricted
  ON public.canonical_persons(organization_id, zone_restricted)
  WHERE zone_restricted = true;

CREATE INDEX IF NOT EXISTS idx_canonical_persons_minor
  ON public.canonical_persons(organization_id, is_minor)
  WHERE is_minor = true;

CREATE INDEX IF NOT EXISTS idx_canonical_persons_last_seen
  ON public.canonical_persons(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_canonical_persons_user_profile
  ON public.canonical_persons(user_profile_id)
  WHERE user_profile_id IS NOT NULL;

-- Full-name GIN index for text search (name may have been set directly without split)
CREATE INDEX IF NOT EXISTS idx_canonical_persons_fullname_gin
  ON public.canonical_persons USING gin(to_tsvector('english', COALESCE(full_name, '')));


-- ── 3. canonical_person_zones — zone-scope join table ────────────────────────

CREATE TABLE IF NOT EXISTS public.canonical_person_zones (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       UUID    NOT NULL REFERENCES public.canonical_persons(id) ON DELETE CASCADE,
  zone_id         UUID    NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  organization_id UUID    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scope_type      TEXT    NOT NULL DEFAULT 'poi'
                    CHECK (scope_type IN (
                      'trespass',       -- Person is trespassed from this zone/location
                      'banned',         -- Person is permanently banned from this zone
                      'poi',            -- Person of interest to monitor in this zone
                      'access_control', -- Person is in the access-control list for this zone
                      'flagged',        -- Person is flagged for activity in this zone
                      'welfare'         -- Person has welfare concerns linked to this zone
                    )),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  added_by        UUID    REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  UNIQUE (person_id, zone_id, scope_type)
);

COMMENT ON TABLE public.canonical_person_zones IS
  'Zone-scope associations for canonical persons. '
  'Drives get_canonical_person_for_zone() geofence-gated visibility: when '
  'zone_restricted=true, the record is only returned to officers inside the zone.';

CREATE INDEX IF NOT EXISTS idx_cpz_person
  ON public.canonical_person_zones(person_id);

CREATE INDEX IF NOT EXISTS idx_cpz_zone
  ON public.canonical_person_zones(zone_id);

CREATE INDEX IF NOT EXISTS idx_cpz_org_zone
  ON public.canonical_person_zones(organization_id, zone_id);

CREATE INDEX IF NOT EXISTS idx_cpz_active
  ON public.canonical_person_zones(zone_id, is_active)
  WHERE is_active = true;


-- ── 4. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.canonical_persons      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_person_zones ENABLE ROW LEVEL SECURITY;

-- ── canonical_persons ─────────────────────────────────────────────────────────

-- Drop and recreate the existing admins_manage_persons policy from 2026-02
-- (it was overly restrictive — only admins could read; officers need SELECT)
DO $$ BEGIN
  DROP POLICY IF EXISTS "admins_manage_persons"  ON public.canonical_persons;
  DROP POLICY IF EXISTS "cp_org_read"            ON public.canonical_persons;
  DROP POLICY IF EXISTS "cp_officer_insert"      ON public.canonical_persons;
  DROP POLICY IF EXISTS "cp_admin_update"        ON public.canonical_persons;
  DROP POLICY IF EXISTS "cp_admin_delete"        ON public.canonical_persons;
  DROP POLICY IF EXISTS "cp_service_role"        ON public.canonical_persons;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- All org members may SELECT (zone restriction enforced at application layer)
CREATE POLICY "cp_org_read"
  ON public.canonical_persons FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
    OR get_user_role(auth.uid()) IN ('master', 'grand_master')
    OR organization_id IS NULL  -- legacy rows before org_id was backfilled
  );

-- Officers may INSERT when creating a record in the field
CREATE POLICY "cp_officer_insert"
  ON public.canonical_persons FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin','admin_officer','master','grand_master','officer')
    )
  );

-- Admin+ may UPDATE
CREATE POLICY "cp_admin_update"
  ON public.canonical_persons FOR UPDATE
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin','admin_officer','master','grand_master')
    )
  );

-- Admin+ may DELETE
CREATE POLICY "cp_admin_delete"
  ON public.canonical_persons FOR DELETE
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin','master','grand_master')
    )
  );

-- Service role bypass
CREATE POLICY "cp_service_role"
  ON public.canonical_persons FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ── canonical_person_zones ────────────────────────────────────────────────────

DO $$ BEGIN
  DROP POLICY IF EXISTS "cpz_org_read"    ON public.canonical_person_zones;
  DROP POLICY IF EXISTS "cpz_admin_write" ON public.canonical_person_zones;
  DROP POLICY IF EXISTS "cpz_service_role" ON public.canonical_person_zones;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE POLICY "cpz_org_read"
  ON public.canonical_person_zones FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
    OR get_user_role(auth.uid()) IN ('master','grand_master')
  );

CREATE POLICY "cpz_officer_write"
  ON public.canonical_person_zones FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin','admin_officer','master','grand_master','officer')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin','admin_officer','master','grand_master','officer')
    )
  );

CREATE POLICY "cpz_service_role"
  ON public.canonical_person_zones FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);


-- ── 5. Triggers ───────────────────────────────────────────────────────────────

-- 5a. updated_at
CREATE OR REPLACE FUNCTION public.canonical_persons_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_canonical_persons_updated_at ON public.canonical_persons;
CREATE TRIGGER trg_canonical_persons_updated_at
  BEFORE UPDATE ON public.canonical_persons
  FOR EACH ROW EXECUTE FUNCTION public.canonical_persons_set_updated_at();

-- 5b. Youth protection + full_name sync
CREATE OR REPLACE FUNCTION public.canonical_persons_before_upsert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Sync full_name from first_name/last_name when provided
  IF NEW.first_name IS NOT NULL OR NEW.last_name IS NOT NULL THEN
    NEW.full_name := TRIM(COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,''));
  END IF;

  -- Auto-set is_minor from date_of_birth
  IF NEW.date_of_birth IS NOT NULL THEN
    NEW.is_minor := (DATE_PART('year', AGE(CURRENT_DATE, NEW.date_of_birth)) < 18);
  END IF;

  -- Block profile_photo_url for minor records.
  -- Face embeddings (real[]) ARE permitted — biometric template ≠ photograph.
  IF NEW.is_minor = true AND NEW.profile_photo_url IS NOT NULL THEN
    RAISE EXCEPTION
      'canonical_persons: profile_photo_url cannot be set for a minor (is_minor=true). '
      'Store profile_photo_embedding only, and document photo_retention_justification. '
      'Legal basis: NZ Privacy Act 2020 IPP 1-4; Oranga Tamariki Act 1989.';
  END IF;

  -- Require documented lawful purpose when embedding a minor
  IF NEW.is_minor = true
     AND NEW.profile_photo_embedding IS NOT NULL
     AND (NEW.photo_retention_justification IS NULL
          OR TRIM(NEW.photo_retention_justification) = '')
  THEN
    RAISE EXCEPTION
      'canonical_persons: photo_retention_justification is required when storing '
      'a face embedding for a minor. Document the lawful purpose and confirm '
      'parental/guardian notification per Oranga Tamariki Act 1989.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_canonical_persons_before_upsert ON public.canonical_persons;
CREATE TRIGGER trg_canonical_persons_before_upsert
  BEFORE INSERT OR UPDATE ON public.canonical_persons
  FOR EACH ROW EXECUTE FUNCTION public.canonical_persons_before_upsert();

-- 5c. Sync zone_ids denormalised array when canonical_person_zones changes
CREATE OR REPLACE FUNCTION public.sync_canonical_person_zone_ids()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_person_id UUID;
BEGIN
  v_person_id := COALESCE(NEW.person_id, OLD.person_id);
  UPDATE public.canonical_persons
  SET zone_ids = (
    SELECT COALESCE(ARRAY_AGG(DISTINCT zone_id), '{}')
    FROM public.canonical_person_zones
    WHERE person_id = v_person_id AND is_active = true
  )
  WHERE id = v_person_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_zone_ids ON public.canonical_person_zones;
CREATE TRIGGER trg_sync_zone_ids
  AFTER INSERT OR UPDATE OR DELETE ON public.canonical_person_zones
  FOR EACH ROW EXECUTE FUNCTION public.sync_canonical_person_zone_ids();


-- ── 6. RPCs ───────────────────────────────────────────────────────────────────

-- 6a. get_canonical_person_for_zone
-- Returns canonical persons associated with a specific zone.
-- zone_restricted records are only returned when the officer's GPS is
-- inside the zone radius (Haversine). Admins always see all records.
-- This is the field-officer lookup used when entering a geofenced area.

DROP FUNCTION IF EXISTS public.get_canonical_person_for_zone(UUID, DOUBLE PRECISION, DOUBLE PRECISION);

CREATE OR REPLACE FUNCTION public.get_canonical_person_for_zone(
  p_zone_id       UUID,
  p_officer_lat   DOUBLE PRECISION DEFAULT NULL,
  p_officer_lon   DOUBLE PRECISION DEFAULT NULL
)
RETURNS TABLE (
  id                      UUID,
  organization_id         UUID,
  first_name              TEXT,
  last_name               TEXT,
  full_name               TEXT,
  date_of_birth           DATE,
  gender                  TEXT,
  identity_status         TEXT,
  is_minor                BOOLEAN,
  profile_photo_url       TEXT,
  is_poi                  BOOLEAN,
  is_trespassed           BOOLEAN,
  is_banned               BOOLEAN,
  is_flagged              BOOLEAN,
  flagged_priority        TEXT,
  flagged_reason          TEXT,
  risk_level              TEXT,
  risk_category           TEXT,
  access_allowed          BOOLEAN,
  access_clearance_level  TEXT,
  zone_restricted         BOOLEAN,
  scope_type              TEXT,
  scope_notes             TEXT,
  total_interactions      INTEGER,
  last_seen_at            TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_zone_lat      DOUBLE PRECISION;
  v_zone_lng      DOUBLE PRECISION;
  v_zone_radius   DOUBLE PRECISION;
  v_officer_in_zone BOOLEAN := false;
  v_officer_org_id  UUID;
  v_is_admin        BOOLEAN;
BEGIN
  -- Officer's organisation
  SELECT up.organization_id,
         up.role IN ('admin','admin_officer','master','grand_master')
  INTO v_officer_org_id, v_is_admin
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
  LIMIT 1;

  -- Zone center + radius
  SELECT z.location_lat::DOUBLE PRECISION,
         z.location_lng::DOUBLE PRECISION,
         COALESCE(z.radius_meters, 500)::DOUBLE PRECISION
  INTO v_zone_lat, v_zone_lng, v_zone_radius
  FROM public.zones z
  WHERE z.id = p_zone_id;

  -- Haversine geofence check
  IF p_officer_lat IS NOT NULL AND p_officer_lon IS NOT NULL
     AND v_zone_lat IS NOT NULL AND v_zone_lng IS NOT NULL
  THEN
    v_officer_in_zone := (
      6371000.0 * 2.0 * ASIN(SQRT(
        POWER(SIN(RADIANS((v_zone_lat - p_officer_lat) / 2.0)), 2) +
        COS(RADIANS(p_officer_lat)) * COS(RADIANS(v_zone_lat)) *
        POWER(SIN(RADIANS((v_zone_lng - p_officer_lon) / 2.0)), 2)
      ))
    ) <= v_zone_radius;
  ELSE
    -- No GPS provided — admins see everything, others see non-restricted only
    v_officer_in_zone := v_is_admin;
  END IF;

  RETURN QUERY
  SELECT
    cp.id,
    cp.organization_id,
    cp.first_name,
    cp.last_name,
    cp.full_name,
    -- DOB year-only for minors
    CASE WHEN cp.is_minor
      THEN MAKE_DATE(DATE_PART('year', cp.date_of_birth)::INT, 1, 1)
      ELSE cp.date_of_birth
    END,
    cp.gender,
    cp.identity_status,
    cp.is_minor,
    -- Photo URL suppressed for minors
    CASE WHEN cp.is_minor THEN NULL ELSE cp.profile_photo_url END,
    cp.is_poi,
    cp.is_trespassed,
    cp.is_banned,
    cp.is_flagged,
    cp.flagged_priority,
    -- flagged_reason redacted for officers on safety-category records
    CASE
      WHEN cp.risk_category IN ('violence','aggression','weapon')
           AND NOT v_is_admin
      THEN '[REDACTED — contact supervisor]'::TEXT
      ELSE cp.flagged_reason
    END,
    cp.risk_level,
    cp.risk_category,
    cp.access_allowed,
    cp.access_clearance_level,
    cp.zone_restricted,
    cpz.scope_type,
    cpz.notes,
    cp.total_interactions,
    cp.last_seen_at
  FROM public.canonical_persons cp
  JOIN public.canonical_person_zones cpz ON cpz.person_id = cp.id
  WHERE cpz.zone_id = p_zone_id
    AND cpz.is_active = true
    AND cp.organization_id = v_officer_org_id
    -- Zone-restricted records: only when officer is inside the zone OR admin
    AND (
      cp.zone_restricted = false
      OR v_officer_in_zone = true
      OR v_is_admin = true
    )
  ORDER BY
    cp.is_trespassed DESC,
    cp.is_banned DESC,
    cp.risk_level DESC NULLS LAST,
    cp.last_seen_at DESC NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.get_canonical_person_for_zone IS
  'Returns canonical persons for a zone. zone_restricted records are only '
  'returned when the officer is physically inside the zone (Haversine check). '
  'Admins always see all records. Minor DOB is year-only; photo URLs suppressed.';

REVOKE ALL ON FUNCTION public.get_canonical_person_for_zone(UUID, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_canonical_person_for_zone(UUID, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated, service_role;


-- 6b. match_canonical_person_by_embedding
-- Top-K cosine similarity face match against canonical_persons, zone-scoped.
-- Used by the face recognition workflow when an officer scans a face.

DROP FUNCTION IF EXISTS public.match_canonical_person_by_embedding(REAL[], UUID, UUID, INT, REAL);

CREATE OR REPLACE FUNCTION public.match_canonical_person_by_embedding(
  p_embedding   REAL[],
  p_org_id      UUID,
  p_zone_id     UUID  DEFAULT NULL,
  p_k           INT   DEFAULT 5,
  p_min_quality REAL  DEFAULT 0.3
)
RETURNS TABLE (
  person_id         UUID,
  full_name         TEXT,
  identity_status   TEXT,
  is_minor          BOOLEAN,
  is_poi            BOOLEAN,
  is_trespassed     BOOLEAN,
  is_banned         BOOLEAN,
  risk_level        TEXT,
  risk_category     TEXT,
  access_allowed    BOOLEAN,
  similarity        REAL,
  profile_photo_url TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    cp.id,
    cp.full_name,
    cp.identity_status,
    cp.is_minor,
    cp.is_poi,
    cp.is_trespassed,
    cp.is_banned,
    cp.risk_level,
    cp.risk_category,
    cp.access_allowed,
    (
      SELECT COALESCE(
        SUM(a * b) / NULLIF(SQRT(SUM(a * a)) * SQRT(SUM(b * b)), 0),
        0
      )
      FROM UNNEST(p_embedding) WITH ORDINALITY AS q(a, i)
      JOIN UNNEST(cp.profile_photo_embedding) WITH ORDINALITY AS d(b, j) ON q.i = d.j
    )::REAL AS similarity,
    CASE WHEN cp.is_minor THEN NULL ELSE cp.profile_photo_url END
  FROM public.canonical_persons cp
  WHERE cp.organization_id = p_org_id
    AND cp.profile_photo_embedding IS NOT NULL
    AND COALESCE(cp.profile_embedding_quality, 0) >= p_min_quality
    AND (
      p_zone_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.canonical_person_zones cpz
        WHERE cpz.person_id = cp.id
          AND cpz.zone_id = p_zone_id
          AND cpz.is_active = true
      )
    )
  ORDER BY similarity DESC
  LIMIT p_k;
$$;

COMMENT ON FUNCTION public.match_canonical_person_by_embedding IS
  'Top-K cosine similarity face match against canonical_persons. '
  'Optionally zone-scoped. Photo URLs suppressed for minors.';

REVOKE ALL ON FUNCTION public.match_canonical_person_by_embedding(REAL[], UUID, UUID, INT, REAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_canonical_person_by_embedding(REAL[], UUID, UUID, INT, REAL) TO authenticated, service_role;


-- 6c. get_persons_for_vehicle
-- Returns all canonical persons linked to a plate via person_vehicle_links.
-- This is the bidirectional lookup: given a plate scan, who is associated?
-- Used by process-officer-scan and the VehicleDetailsModal.

DROP FUNCTION IF EXISTS public.get_persons_for_vehicle(TEXT);

CREATE OR REPLACE FUNCTION public.get_persons_for_vehicle(p_plate TEXT)
RETURNS TABLE (
  person_id           UUID,
  full_name           TEXT,
  identity_status     TEXT,
  is_minor            BOOLEAN,
  is_poi              BOOLEAN,
  is_trespassed       BOOLEAN,
  is_banned           BOOLEAN,
  is_flagged          BOOLEAN,
  flagged_priority    TEXT,
  risk_level          TEXT,
  risk_category       TEXT,
  access_allowed      BOOLEAN,
  zone_restricted     BOOLEAN,
  zone_ids            UUID[],
  relationship_type   TEXT,
  linked_at           TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    cp.id                  AS person_id,
    cp.full_name,
    cp.identity_status,
    cp.is_minor,
    cp.is_poi,
    cp.is_trespassed,
    cp.is_banned,
    cp.is_flagged,
    cp.flagged_priority,
    cp.risk_level,
    cp.risk_category,
    cp.access_allowed,
    cp.zone_restricted,
    cp.zone_ids,
    pvl.relationship_type,
    pvl.linked_at
  FROM public.person_vehicle_links pvl
  JOIN public.canonical_persons cp ON cp.id = pvl.person_id
  WHERE pvl.plate_number = p_plate
  ORDER BY
    cp.is_trespassed DESC,
    cp.is_banned DESC,
    cp.risk_level DESC NULLS LAST,
    pvl.linked_at DESC;
$$;

COMMENT ON FUNCTION public.get_persons_for_vehicle IS
  'Returns all canonical persons linked to a plate via person_vehicle_links. '
  'The primary bidirectional lookup for the scan pipeline (Step 5c of '
  'process-officer-scan) and the VehicleDetailsModal.';

REVOKE ALL ON FUNCTION public.get_persons_for_vehicle(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_persons_for_vehicle(TEXT) TO authenticated, service_role;


-- ── 7. Fix v_person_safety_flags (broken cross-join from 2026-04 migration) ──
-- The original view joined person_records → person_vehicle_links, but
-- person_vehicle_links.person_id references canonical_persons(id), not
-- person_records.id. Replace with the correct join.

CREATE OR REPLACE VIEW public.v_person_safety_flags AS
SELECT
  pvl.plate_number,
  cp.risk_level,
  cp.risk_category
FROM public.canonical_persons cp
JOIN public.person_vehicle_links pvl ON pvl.person_id = cp.id
WHERE cp.risk_level IN ('high','critical')
  AND cp.risk_category IN ('violence','aggression','weapon');

COMMENT ON VIEW public.v_person_safety_flags IS
  'Cross-org officer safety signal: high/critical risk persons linked to plates '
  'via person_vehicle_links → canonical_persons. Fixed from 2026-04 version which '
  'incorrectly joined person_records instead of canonical_persons. '
  'Contains NO PII — only plate + risk level + category. '
  'Legal basis: NZ Privacy Act 2020 IPP 11(1)(c).';

GRANT SELECT ON public.v_person_safety_flags TO authenticated;
GRANT SELECT ON public.v_person_safety_flags TO service_role;


-- ── 8. v_canonical_person_safety_flags — zone-aware cross-org safety view ────

CREATE OR REPLACE VIEW public.v_canonical_person_safety_flags AS
SELECT
  cp.id              AS canonical_person_id,
  cp.organization_id,
  cp.risk_level,
  cp.risk_category,
  cpz.zone_id,
  cpz.scope_type
FROM public.canonical_persons cp
JOIN public.canonical_person_zones cpz ON cpz.person_id = cp.id
WHERE cp.risk_level IN ('high','critical')
  AND cp.risk_category IN ('violence','aggression','weapon')
  AND cpz.is_active = true;

COMMENT ON VIEW public.v_canonical_person_safety_flags IS
  'Zone-scoped cross-org safety signal for high/critical risk persons. '
  'NO PII — only IDs, risk level, category, and zone. '
  'Legal basis: NZ Privacy Act 2020 IPP 11(1)(c).';

GRANT SELECT ON public.v_canonical_person_safety_flags TO authenticated;
GRANT SELECT ON public.v_canonical_person_safety_flags TO service_role;


-- ── 9. Add canonical_person_id FK to downstream tables ───────────────────────

ALTER TABLE public.person_records
  ADD COLUMN IF NOT EXISTS canonical_person_id UUID
    REFERENCES public.canonical_persons(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_person_records_canonical
  ON public.person_records(canonical_person_id)
  WHERE canonical_person_id IS NOT NULL;

ALTER TABLE public.persons_of_interest
  ADD COLUMN IF NOT EXISTS canonical_person_id UUID
    REFERENCES public.canonical_persons(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_poi_canonical
  ON public.persons_of_interest(canonical_person_id)
  WHERE canonical_person_id IS NOT NULL;

ALTER TABLE public.face_records
  ADD COLUMN IF NOT EXISTS canonical_person_id UUID
    REFERENCES public.canonical_persons(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_face_records_canonical
  ON public.face_records(canonical_person_id)
  WHERE canonical_person_id IS NOT NULL;

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS canonical_person_id UUID
    REFERENCES public.canonical_persons(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_canonical
  ON public.incidents(canonical_person_id)
  WHERE canonical_person_id IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.person_id_documents
    ADD COLUMN IF NOT EXISTS canonical_person_id UUID
      REFERENCES public.canonical_persons(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_person_id_docs_canonical
    ON public.person_id_documents(canonical_person_id)
    WHERE canonical_person_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.trespass_notices
    ADD COLUMN IF NOT EXISTS canonical_person_id UUID
      REFERENCES public.canonical_persons(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_trespass_notices_canonical
    ON public.trespass_notices(canonical_person_id)
    WHERE canonical_person_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.access_entries
    ADD COLUMN IF NOT EXISTS canonical_person_id UUID
      REFERENCES public.canonical_persons(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_access_entries_canonical
    ON public.access_entries(canonical_person_id)
    WHERE canonical_person_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── 10. Backfill canonical_persons.organization_id from person_records ────────
-- person_records is org-scoped; canonical_persons was not. Set org_id on
-- canonical_persons where it can be inferred from person_records.canonical_person_id
-- (rows backfilled in a later step) or from persons_of_interest.

-- Backfill persons_of_interest → canonical_persons
DO $$
DECLARE
  r              RECORD;
  v_canonical_id UUID;
BEGIN
  FOR r IN
    SELECT * FROM public.persons_of_interest
    WHERE canonical_person_id IS NULL
  LOOP
    INSERT INTO public.canonical_persons (
      organization_id,
      first_name,
      last_name,
      full_name,
      date_of_birth,
      gender,
      ethnicity,
      height_cm,
      weight_kg,
      distinguishing_features,
      description,
      identity_status,
      contact_phone,
      contact_email,
      address,
      is_poi,
      is_trespassed,
      is_banned,
      is_flagged,
      flagged_reason,
      flagged_notes,
      privacy_notice_given,
      privacy_lawful_purpose,
      expiry_date,
      created_by,
      created_at,
      updated_at
    )
    VALUES (
      r.organization_id,
      TRIM(SPLIT_PART(r.full_name, ' ', 1)),
      NULLIF(TRIM(SUBSTRING(r.full_name FROM POSITION(' ' IN r.full_name) + 1)), ''),
      r.full_name,
      r.date_of_birth,
      r.gender,
      r.ethnicity,
      r.height_cm,
      r.weight_kg,
      r.distinguishing_features,
      r.description,
      CASE
        WHEN r.full_name IS NOT NULL AND TRIM(r.full_name) <> '' THEN 'identified'
        ELSE 'unknown'
      END,
      r.contact_phone,
      r.contact_email,
      r.address,
      r.status IN ('poi','banned','trespassed'),
      r.status = 'trespassed',
      r.status = 'banned',
      false,
      r.reason,
      r.notes,
      COALESCE(r.privacy_notice_given, false),
      COALESCE(r.privacy_lawful_purpose,
        'NZ Trespass Act 1980 / Freedom Camping Act 2011 enforcement'),
      r.expires_at,
      r.created_by,
      COALESCE(r.created_at, now()),
      COALESCE(r.updated_at, now())
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_canonical_id;

    IF v_canonical_id IS NOT NULL THEN
      UPDATE public.persons_of_interest
      SET canonical_person_id = v_canonical_id
      WHERE id = r.id;
    END IF;
  END LOOP;
  RAISE NOTICE '✅ persons_of_interest → canonical_persons backfill complete';
END;
$$;

-- Backfill person_records → canonical_persons
DO $$
DECLARE
  r              RECORD;
  v_canonical_id UUID;
BEGIN
  FOR r IN
    SELECT * FROM public.person_records
    WHERE canonical_person_id IS NULL
  LOOP
    -- Attempt to match an existing canonical_persons record
    SELECT cp.id INTO v_canonical_id
    FROM public.canonical_persons cp
    WHERE cp.organization_id = r.organization_id
      AND LOWER(TRIM(COALESCE(cp.first_name,''))) = LOWER(TRIM(COALESCE(r.first_name,'')))
      AND LOWER(TRIM(COALESCE(cp.last_name,'')))  = LOWER(TRIM(COALESCE(r.last_name,'')))
      AND (r.date_of_birth IS NULL OR cp.date_of_birth IS NULL
           OR cp.date_of_birth = r.date_of_birth)
    LIMIT 1;

    IF v_canonical_id IS NULL THEN
      INSERT INTO public.canonical_persons (
        organization_id, first_name, last_name,
        full_name, date_of_birth,
        identity_status, is_poi, is_trespassed, is_flagged,
        risk_level, risk_category, total_interactions, last_seen_at,
        created_at, updated_at
      )
      VALUES (
        r.organization_id, r.first_name, r.last_name,
        TRIM(COALESCE(r.first_name,'') || ' ' || COALESCE(r.last_name,'')),
        r.date_of_birth,
        CASE
          WHEN r.first_name IS NOT NULL AND r.last_name IS NOT NULL THEN 'identified'
          WHEN r.first_name IS NOT NULL OR r.last_name IS NOT NULL  THEN 'partial'
          ELSE 'unknown'
        END,
        COALESCE(r.is_of_interest, false),
        COALESCE(r.trespass_notice_issued, false),
        false,
        r.risk_level,
        r.risk_category,
        COALESCE(r.total_interactions, 0),
        r.last_contact_at,
        COALESCE(r.created_at, now()),
        COALESCE(r.updated_at, now())
      )
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_canonical_id;
    END IF;

    IF v_canonical_id IS NOT NULL THEN
      UPDATE public.person_records
      SET canonical_person_id = v_canonical_id
      WHERE id = r.id;
    END IF;
  END LOOP;
  RAISE NOTICE '✅ person_records → canonical_persons backfill complete';
END;
$$;


-- ── 11. Completion notice ──────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '✅ canonical_persons extended: org scope, status flags, zone restriction, youth protection';
  RAISE NOTICE '✅ canonical_person_zones join table created';
  RAISE NOTICE '✅ RLS updated: all org members can SELECT; zone enforcement at application layer';
  RAISE NOTICE '✅ Youth protection trigger: is_minor auto-set, photo_url blocked for minors';
  RAISE NOTICE '✅ get_canonical_person_for_zone() — geofence-gated zone lookup RPC';
  RAISE NOTICE '✅ match_canonical_person_by_embedding() — zone-scoped face match RPC';
  RAISE NOTICE '✅ get_persons_for_vehicle() — bidirectional plate → person lookup RPC';
  RAISE NOTICE '✅ v_person_safety_flags FIXED — now joins canonical_persons (not person_records)';
  RAISE NOTICE '✅ v_canonical_person_safety_flags — zone-aware cross-org safety view';
  RAISE NOTICE '✅ canonical_person_id FK added to: person_records, persons_of_interest,';
  RAISE NOTICE '     face_records, incidents, person_id_documents, trespass_notices, access_entries';
  RAISE NOTICE '✅ Backfill from persons_of_interest and person_records complete';
  RAISE NOTICE '';
  RAISE NOTICE 'NEXT: Update process-officer-scan Step 5c to call get_persons_for_vehicle()';
  RAISE NOTICE 'and include person_alerts in the Step 13 return payload.';
END;
$$;
