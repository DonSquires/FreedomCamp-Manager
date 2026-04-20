-- ============================================================================
-- Migration: Canonical Persons — Unified person registry with zone-scoped visibility
-- ============================================================================
--
-- PURPOSE
-- -------
-- Creates canonical_persons as the master person registry, analogous to
-- canonical_vehicles for the vehicle registry.
--
-- KEY DESIGN DECISIONS
-- --------------------
--
-- 1. UNIFIED MASTER RECORD
--    canonical_persons replaces the fragmented person_records +
--    persons_of_interest pattern. Both existing tables are kept for backward
--    compatibility; a canonical_person_id FK is added to each so existing
--    queries keep working while new code migrates to the canonical table.
--
-- 2. ZONE-SCOPED VISIBILITY (geofence-gated information access)
--    Records can be marked zone_restricted = true. When set, the record's
--    sensitive details (trespass reason, flagged notes) are only surfaced by
--    get_canonical_person_for_zone() — an RPC that verifies the officer's GPS
--    position is inside the relevant zone before returning full detail.
--
--    Rationale: A trespass at Bus Hub A should not be visible to officers
--    patrolling Park B. Proportionate disclosure under NZ Privacy Act 2020
--    IPP 11 — information shared only to the extent necessary.
--
--    Implementation: Zone enforcement is application-layer (via the RPC),
--    not RLS. RLS still enforces hard org isolation. This matches the pattern
--    used by process-officer-scan throughout the codebase.
--
-- 3. YOUTH PROTECTION (under 18)
--    - is_minor is auto-set by trigger when date_of_birth confirms age < 18.
--    - A second trigger blocks profile_photo_url for minor records — face
--      embeddings (vector arrays) are permitted (NZ Privacy Act 2020: a
--      biometric template ≠ a photograph; cannot reconstruct the face from
--      the vector). Lawful purpose must be documented via
--      photo_retention_justification.
--    - Legal basis: Oranga Tamariki Act 1989; Children, Young Persons, and
--      Their Families Act 1989; NZ Privacy Act 2020 IPP 1–4.
--
-- 4. UNKNOWN PERSONS
--    All name fields are nullable. identity_status = 'unknown' creates a
--    record from face embedding or officer notes alone. Identity can be
--    resolved later by ID scan or admin entry.
--
-- 5. SYSTEM USER CROSS-REFERENCE
--    user_profile_id (nullable FK) links canonical_persons to user_profiles
--    for contractors / employees who appear in both the access control system
--    AND as system users. This is a cross-reference only — the tables remain
--    separate with separate purposes. Officers' operational identities stay in
--    user_profiles.
--
-- ============================================================================

-- ── 1. canonical_persons — master person registry ────────────────────────────

CREATE TABLE IF NOT EXISTS public.canonical_persons (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- ── Identity (all nullable — unknown persons are valid records) ────────────
  first_name                TEXT,
  last_name                 TEXT,
  full_name                 TEXT GENERATED ALWAYS AS (
                              TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
                            ) STORED,
  date_of_birth             DATE,
  gender                    TEXT,
  ethnicity                 TEXT,
  nationality               TEXT,
  height_cm                 INTEGER,
  weight_kg                 INTEGER,
  distinguishing_features   TEXT,
  description               TEXT,

  -- ── Identity completeness ──────────────────────────────────────────────────
  identity_status           TEXT NOT NULL DEFAULT 'unknown'
                              CHECK (identity_status IN ('identified', 'partial', 'unknown')),

  -- ── Youth protection ──────────────────────────────────────────────────────
  is_minor                  BOOLEAN NOT NULL DEFAULT false,
  -- Trigger auto-sets is_minor when DOB confirms < 18.
  -- For minors: profile_photo_url is blocked by trigger. Embedding is allowed.
  photo_retention_justification TEXT,
  -- Required documentation when any face embedding is stored for a minor.
  -- Example: "Trespass enforcement — NZ Trespass Act 1980 s.3(4); parent notified"

  -- ── Profile photo & face embedding ────────────────────────────────────────
  profile_photo_url         TEXT,
  -- NULL enforced for minors (is_minor = true) by trigger.
  profile_photo_embedding   REAL[],
  -- 384-D MobileNetV3 embedding, same model as vehicle embeddings.
  profile_photo_updated_at  TIMESTAMPTZ,
  profile_embedding_quality REAL,

  -- ── Contact (where lawfully held) ─────────────────────────────────────────
  contact_phone             TEXT,
  contact_email             TEXT,
  address                   TEXT,
  address_verified          BOOLEAN DEFAULT false,

  -- ── Status flags ──────────────────────────────────────────────────────────
  is_poi                    BOOLEAN NOT NULL DEFAULT false,
  -- Person of interest — general watch status (org-scoped)
  is_trespassed             BOOLEAN NOT NULL DEFAULT false,
  -- Active trespass notice (links to trespass_notices table)
  is_banned                 BOOLEAN NOT NULL DEFAULT false,
  -- Permanent ban (stronger than a trespass notice)
  is_flagged                BOOLEAN NOT NULL DEFAULT false,
  flagged_priority          TEXT    CHECK (flagged_priority IN ('low', 'medium', 'high', 'critical')),
  flagged_reason            TEXT,
  flagged_notes             TEXT,
  flagged_at                TIMESTAMPTZ,
  flagged_by                UUID    REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  -- ── Access control ────────────────────────────────────────────────────────
  access_allowed            BOOLEAN DEFAULT NULL,
  -- NULL = not in access control system. true = authorised entry. false = denied.
  access_clearance_level    TEXT    CHECK (access_clearance_level IN
                              ('public', 'restricted', 'confidential', 'secret', 'top_secret')),
  access_badge_number       TEXT,
  access_notes              TEXT,

  -- ── Safety risk (cross-org safety signal — see global_safety_flags migration) ─
  risk_level                TEXT    CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  risk_category             TEXT    CHECK (risk_category IN
                              ('violence', 'aggression', 'weapon', 'other_safety')),
  -- risk_level high/critical + risk_category violence/aggression/weapon travels
  -- globally (IPP 11(1)(c)). See LEGAL_BASIS_REFERENCE.md §7.

  -- ── Zone-scoped visibility ────────────────────────────────────────────────
  zone_restricted           BOOLEAN NOT NULL DEFAULT false,
  -- When true, get_canonical_person_for_zone() enforces geofence check before
  -- returning this record's details to field officers.
  -- zone_ids is denormalised for fast zone-match queries; canonical_person_zones
  -- is the authoritative join table.
  zone_ids                  UUID[]  DEFAULT '{}',

  -- ── Privacy / legal ──────────────────────────────────────────────────────
  privacy_notice_given      BOOLEAN DEFAULT false,
  -- IPP 3 — was the individual informed of the data collection and its purpose?
  privacy_lawful_purpose    TEXT    DEFAULT
    'NZ Trespass Act 1980 / Freedom Camping Act 2011 / access control enforcement',
  -- IPP 1 — the lawful purpose for which information is collected.
  collection_authority      TEXT,
  -- Specific statute / organisational policy authorising collection.
  expiry_date               TIMESTAMPTZ,
  -- When this record should be reviewed / purged (IPP 9 — retention limits).

  -- ── Cross-references ──────────────────────────────────────────────────────
  user_profile_id           UUID    REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  -- Optional link to system user account (contractor / employee cross-reference).

  -- ── Statistics ────────────────────────────────────────────────────────────
  total_interactions        INTEGER NOT NULL DEFAULT 0,
  first_seen_at             TIMESTAMPTZ,
  last_seen_at              TIMESTAMPTZ,

  -- ── Audit ─────────────────────────────────────────────────────────────────
  created_by                UUID    REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.canonical_persons IS
  'Master person registry. One record per known or unknown individual encountered '
  'during enforcement, access control, or welfare operations. Analogous to '
  'canonical_vehicles for the vehicle registry. Org-scoped with optional zone '
  'restriction for geofence-gated visibility.';

COMMENT ON COLUMN public.canonical_persons.identity_status IS
  'identified = confirmed name/DOB; partial = some details known; '
  'unknown = face/embedding only, no name available.';

COMMENT ON COLUMN public.canonical_persons.zone_restricted IS
  'If true, this record is only surfaced to field officers when they are inside '
  'one of the associated zones. Enforced at application layer by '
  'get_canonical_person_for_zone() RPC. Admins always see all records.';

COMMENT ON COLUMN public.canonical_persons.is_minor IS
  'Auto-set by trigger when DOB confirms age < 18. profile_photo_url is blocked '
  'for minors by trigger. Face embeddings permitted with documented lawful purpose.';

COMMENT ON COLUMN public.canonical_persons.user_profile_id IS
  'Optional cross-reference to a system user account. canonical_persons and '
  'user_profiles remain separate tables. This FK is for the contractor / employee '
  'use case where a person appears in both the access control system and as a '
  'system user. Do NOT merge the two — they have different lifecycles.';

-- Indexes
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
  WHERE risk_level IN ('high', 'critical') AND risk_category IS NOT NULL;

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

-- ── 2. canonical_person_zones — zone-scope join table ────────────────────────
-- Authoritative record of which zones a canonical person is associated with
-- and what type of scope applies in each zone.

CREATE TABLE IF NOT EXISTS public.canonical_person_zones (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id           UUID    NOT NULL REFERENCES public.canonical_persons(id) ON DELETE CASCADE,
  zone_id             UUID    NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  organization_id     UUID    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Scope type defines WHY this person is associated with this zone
  scope_type          TEXT    NOT NULL DEFAULT 'poi'
                        CHECK (scope_type IN (
                          'trespass',       -- Person is trespassed from this zone/location
                          'banned',         -- Person is permanently banned from this zone
                          'poi',            -- Person of interest to monitor in this zone
                          'access_control', -- Person is in the access-control list for this zone
                          'flagged',        -- Person is flagged for activity in this zone
                          'welfare'         -- Person has welfare concerns linked to this zone
                        )),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  notes               TEXT,
  added_by            UUID    REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  added_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ,

  UNIQUE (person_id, zone_id, scope_type)
);

COMMENT ON TABLE public.canonical_person_zones IS
  'Zone-scope associations for canonical persons. '
  'Drives get_canonical_person_for_zone() visibility logic: when a person is '
  'zone_restricted, only officers inside an associated zone see the record''s details.';

CREATE INDEX IF NOT EXISTS idx_cpz_person
  ON public.canonical_person_zones(person_id);

CREATE INDEX IF NOT EXISTS idx_cpz_zone
  ON public.canonical_person_zones(zone_id);

CREATE INDEX IF NOT EXISTS idx_cpz_org_zone
  ON public.canonical_person_zones(organization_id, zone_id);

CREATE INDEX IF NOT EXISTS idx_cpz_active
  ON public.canonical_person_zones(zone_id, is_active)
  WHERE is_active = true;

-- ── 3. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.canonical_persons      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_person_zones ENABLE ROW LEVEL SECURITY;

-- canonical_persons ──────────────────────────────────────────────────────────

-- All org members may read records belonging to their organisation.
-- Zone-scoped visibility (zone_restricted records) is enforced at the
-- application layer by get_canonical_person_for_zone() — RLS enforces the
-- hard org boundary only.
DO $$ BEGIN
  DROP POLICY IF EXISTS "cp_org_read" ON public.canonical_persons;
  CREATE POLICY "cp_org_read"
    ON public.canonical_persons FOR SELECT
    TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
      )
      OR get_user_role(auth.uid()) IN ('master', 'grand_master')
    );
EXCEPTION WHEN undefined_object THEN NULL;
        WHEN undefined_function THEN NULL;
END $$;

-- Officers may INSERT (creating a record in the field).
DO $$ BEGIN
  DROP POLICY IF EXISTS "cp_officer_insert" ON public.canonical_persons;
  CREATE POLICY "cp_officer_insert"
    ON public.canonical_persons FOR INSERT
    TO authenticated
    WITH CHECK (
      organization_id IN (
        SELECT organization_id FROM public.user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'admin_officer', 'master', 'grand_master', 'officer')
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
        WHEN undefined_function THEN NULL;
END $$;

-- Admin+ may UPDATE.
DO $$ BEGIN
  DROP POLICY IF EXISTS "cp_admin_update" ON public.canonical_persons;
  CREATE POLICY "cp_admin_update"
    ON public.canonical_persons FOR UPDATE
    TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM public.user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'admin_officer', 'master', 'grand_master')
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
        WHEN undefined_function THEN NULL;
END $$;

-- Admin+ may DELETE.
DO $$ BEGIN
  DROP POLICY IF EXISTS "cp_admin_delete" ON public.canonical_persons;
  CREATE POLICY "cp_admin_delete"
    ON public.canonical_persons FOR DELETE
    TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM public.user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'master', 'grand_master')
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
        WHEN undefined_function THEN NULL;
END $$;

-- Service role bypass.
DO $$ BEGIN
  DROP POLICY IF EXISTS "cp_service_role" ON public.canonical_persons;
  CREATE POLICY "cp_service_role"
    ON public.canonical_persons FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- canonical_person_zones ─────────────────────────────────────────────────────

DO $$ BEGIN
  DROP POLICY IF EXISTS "cpz_org_read" ON public.canonical_person_zones;
  CREATE POLICY "cpz_org_read"
    ON public.canonical_person_zones FOR SELECT
    TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
      )
      OR get_user_role(auth.uid()) IN ('master', 'grand_master')
    );
EXCEPTION WHEN undefined_object THEN NULL;
        WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "cpz_admin_write" ON public.canonical_person_zones;
  CREATE POLICY "cpz_admin_write"
    ON public.canonical_person_zones FOR ALL
    TO authenticated
    USING (
      organization_id IN (
        SELECT organization_id FROM public.user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'admin_officer', 'master', 'grand_master', 'officer')
      )
    )
    WITH CHECK (
      organization_id IN (
        SELECT organization_id FROM public.user_profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'admin_officer', 'master', 'grand_master', 'officer')
      )
    );
EXCEPTION WHEN undefined_object THEN NULL;
        WHEN undefined_function THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "cpz_service_role" ON public.canonical_person_zones;
  CREATE POLICY "cpz_service_role"
    ON public.canonical_person_zones FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ── 4. Triggers ──────────────────────────────────────────────────────────────

-- 4a. updated_at
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

-- 4b. Youth protection — auto-set is_minor, block photo for minors
CREATE OR REPLACE FUNCTION public.canonical_persons_youth_protection()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Auto-set is_minor from date_of_birth
  IF NEW.date_of_birth IS NOT NULL THEN
    NEW.is_minor := (DATE_PART('year', AGE(CURRENT_DATE, NEW.date_of_birth)) < 18);
  END IF;

  -- Block profile_photo_url for minor records.
  -- Face embeddings (profile_photo_embedding real[]) are permitted with documented
  -- lawful purpose — a biometric template cannot reconstruct the face.
  IF NEW.is_minor = true AND NEW.profile_photo_url IS NOT NULL THEN
    RAISE EXCEPTION
      'canonical_persons: profile_photo_url cannot be set for a minor (is_minor=true). '
      'Use profile_photo_embedding only, and document photo_retention_justification. '
      'Legal basis: NZ Privacy Act 2020 IPP 1-4; Oranga Tamariki Act 1989.';
  END IF;

  -- Require lawful purpose documentation for minor embeddings
  IF NEW.is_minor = true
     AND NEW.profile_photo_embedding IS NOT NULL
     AND (NEW.photo_retention_justification IS NULL OR TRIM(NEW.photo_retention_justification) = '')
  THEN
    RAISE EXCEPTION
      'canonical_persons: photo_retention_justification is required when storing '
      'a face embedding for a minor. Document the lawful purpose (e.g. trespass '
      'enforcement, access control) and confirm parental/guardian notification.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_canonical_persons_youth_protection ON public.canonical_persons;
CREATE TRIGGER trg_canonical_persons_youth_protection
  BEFORE INSERT OR UPDATE ON public.canonical_persons
  FOR EACH ROW EXECUTE FUNCTION public.canonical_persons_youth_protection();

-- 4c. Sync zone_ids denormalised array when canonical_person_zones changes
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
    WHERE person_id = v_person_id
      AND is_active = true
  )
  WHERE id = v_person_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_zone_ids ON public.canonical_person_zones;
CREATE TRIGGER trg_sync_zone_ids
  AFTER INSERT OR UPDATE OR DELETE ON public.canonical_person_zones
  FOR EACH ROW EXECUTE FUNCTION public.sync_canonical_person_zone_ids();

-- ── 5. RPCs ───────────────────────────────────────────────────────────────────

-- 5a. get_canonical_person_for_zone
-- Returns canonical persons associated with a specific zone.
-- For zone_restricted records, enforces a geofence check: the officer must be
-- within the zone's radius to receive the full record. If outside the zone,
-- zone_restricted records are excluded from the result.
-- Non-restricted records in the same org are always returned.
--
-- Officers call this when scanning inside a zone — it surfaces trespass/POI
-- records relevant to that location without leaking data from other zones.

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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_zone              RECORD;
  v_officer_in_zone   BOOLEAN := false;
  v_officer_org_id    UUID;
BEGIN
  -- Get requesting officer's organisation
  SELECT organization_id INTO v_officer_org_id
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;

  -- Load zone details (center + radius)
  SELECT z.location_lat, z.location_lng,
         COALESCE(z.radius_meters, 500) AS radius_meters
  INTO v_zone
  FROM public.zones z
  WHERE z.id = p_zone_id;

  -- Determine if officer is inside the zone (Haversine)
  IF p_officer_lat IS NOT NULL AND p_officer_lon IS NOT NULL
     AND v_zone.location_lat IS NOT NULL AND v_zone.location_lng IS NOT NULL
  THEN
    v_officer_in_zone := (
      6371000 * 2 * ASIN(SQRT(
        POWER(SIN(RADIANS((v_zone.location_lat::DOUBLE PRECISION - p_officer_lat) / 2)), 2) +
        COS(RADIANS(p_officer_lat)) *
        COS(RADIANS(v_zone.location_lat::DOUBLE PRECISION)) *
        POWER(SIN(RADIANS((v_zone.location_lng::DOUBLE PRECISION - p_officer_lon) / 2)), 2)
      ))
    ) <= v_zone.radius_meters;
  ELSE
    -- No GPS provided — admins/master see all, officers see non-restricted only
    v_officer_in_zone := get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master');
  END IF;

  RETURN QUERY
  SELECT
    cp.id,
    cp.organization_id,
    cp.first_name,
    cp.last_name,
    cp.full_name,
    -- DOB: return year-only for minors (privacy protection in output)
    CASE
      WHEN cp.is_minor THEN
        MAKE_DATE(DATE_PART('year', cp.date_of_birth)::INTEGER, 1, 1)
      ELSE cp.date_of_birth
    END AS date_of_birth,
    cp.gender,
    cp.identity_status,
    cp.is_minor,
    -- Photo URL: suppressed for minors regardless of caller
    CASE WHEN cp.is_minor THEN NULL ELSE cp.profile_photo_url END AS profile_photo_url,
    cp.is_poi,
    cp.is_trespassed,
    cp.is_banned,
    cp.is_flagged,
    cp.flagged_priority,
    -- flagged_reason: redacted for officers on safety-category records (same rule as vehicles)
    CASE
      WHEN cp.risk_category IN ('violence', 'aggression', 'weapon')
           AND get_user_role(auth.uid()) NOT IN ('admin', 'admin_officer', 'master', 'grand_master')
      THEN '[REDACTED — contact supervisor]'::TEXT
      ELSE cp.flagged_reason
    END AS flagged_reason,
    cp.risk_level,
    cp.risk_category,
    cp.access_allowed,
    cp.access_clearance_level,
    cp.zone_restricted,
    cpz.scope_type,
    cpz.notes AS scope_notes,
    cp.total_interactions,
    cp.last_seen_at
  FROM public.canonical_persons cp
  JOIN public.canonical_person_zones cpz ON cpz.person_id = cp.id
  WHERE cpz.zone_id = p_zone_id
    AND cpz.is_active = true
    AND cp.organization_id = v_officer_org_id
    -- Zone-restricted records only returned when officer is inside the zone
    AND (
      cp.zone_restricted = false
      OR v_officer_in_zone = true
      OR get_user_role(auth.uid()) IN ('admin', 'admin_officer', 'master', 'grand_master')
    )
  ORDER BY cp.is_trespassed DESC, cp.is_banned DESC, cp.risk_level DESC, cp.last_seen_at DESC NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.get_canonical_person_for_zone IS
  'Returns canonical persons associated with a zone. Enforces geofence-gated '
  'visibility: zone_restricted records are only returned when the officer is '
  'physically inside the zone (Haversine check on p_officer_lat/lon vs zone '
  'center + radius_meters). Admins always see all records. Minors'' DOB is '
  'year-only in the result; photo URLs are suppressed for minors.';

REVOKE ALL ON FUNCTION public.get_canonical_person_for_zone(UUID, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_canonical_person_for_zone(UUID, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated, service_role;


-- 5b. match_canonical_person_by_embedding
-- Top-K cosine similarity search for face matching against canonical_persons.
-- Zone-scoped: only searches persons associated with the specified zone.
-- Used by the face recognition workflow when an officer scans a face.

DROP FUNCTION IF EXISTS public.match_canonical_person_by_embedding(REAL[], UUID, UUID, INT, REAL);

CREATE OR REPLACE FUNCTION public.match_canonical_person_by_embedding(
  p_embedding     REAL[],           -- 384-D query embedding from face scan
  p_org_id        UUID,             -- organisation scope
  p_zone_id       UUID  DEFAULT NULL,  -- optional zone scope
  p_k             INT   DEFAULT 5,  -- max results
  p_min_quality   REAL  DEFAULT 0.3 -- minimum embedding quality threshold
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
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    cp.id        AS person_id,
    cp.full_name,
    cp.identity_status,
    cp.is_minor,
    cp.is_poi,
    cp.is_trespassed,
    cp.is_banned,
    cp.risk_level,
    cp.risk_category,
    cp.access_allowed,
    -- Cosine similarity: dot(a,b) / (||a|| * ||b||)
    (
      SELECT COALESCE(
        SUM(a * b) / NULLIF(SQRT(SUM(a * a)) * SQRT(SUM(b * b)), 0),
        0
      )
      FROM UNNEST(p_embedding) WITH ORDINALITY AS q(a, i)
      JOIN UNNEST(cp.profile_photo_embedding) WITH ORDINALITY AS d(b, j) ON q.i = d.j
    )::REAL                           AS similarity,
    CASE WHEN cp.is_minor THEN NULL ELSE cp.profile_photo_url END AS profile_photo_url
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
  'Top-K cosine similarity face match against canonical_persons embeddings. '
  'Optionally zone-scoped (only matches persons linked to p_zone_id). '
  'Photo URLs suppressed for minors in the result.';

REVOKE ALL ON FUNCTION public.match_canonical_person_by_embedding(REAL[], UUID, UUID, INT, REAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_canonical_person_by_embedding(REAL[], UUID, UUID, INT, REAL) TO authenticated, service_role;


-- ── 6. Add canonical_person_id FK to downstream tables ───────────────────────
-- Existing tables gain a nullable FK to canonical_persons for cross-reference.
-- The tables keep their existing structure — no data is removed.

-- person_records → canonical_persons
ALTER TABLE public.person_records
  ADD COLUMN IF NOT EXISTS canonical_person_id UUID
    REFERENCES public.canonical_persons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_person_records_canonical
  ON public.person_records(canonical_person_id)
  WHERE canonical_person_id IS NOT NULL;

-- persons_of_interest → canonical_persons
ALTER TABLE public.persons_of_interest
  ADD COLUMN IF NOT EXISTS canonical_person_id UUID
    REFERENCES public.canonical_persons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_poi_canonical
  ON public.persons_of_interest(canonical_person_id)
  WHERE canonical_person_id IS NOT NULL;

-- face_records → canonical_persons (in addition to existing person_record_id)
ALTER TABLE public.face_records
  ADD COLUMN IF NOT EXISTS canonical_person_id UUID
    REFERENCES public.canonical_persons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_face_records_canonical
  ON public.face_records(canonical_person_id)
  WHERE canonical_person_id IS NOT NULL;

-- incidents → canonical_persons (in addition to existing person_record_id)
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS canonical_person_id UUID
    REFERENCES public.canonical_persons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_canonical
  ON public.incidents(canonical_person_id)
  WHERE canonical_person_id IS NOT NULL;

-- person_id_documents → canonical_persons (in addition to existing person_record_id)
DO $$ BEGIN
  ALTER TABLE public.person_id_documents
    ADD COLUMN IF NOT EXISTS canonical_person_id UUID
      REFERENCES public.canonical_persons(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_person_id_docs_canonical
    ON public.person_id_documents(canonical_person_id)
    WHERE canonical_person_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- trespass_notices → canonical_persons
DO $$ BEGIN
  ALTER TABLE public.trespass_notices
    ADD COLUMN IF NOT EXISTS canonical_person_id UUID
      REFERENCES public.canonical_persons(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_trespass_notices_canonical
    ON public.trespass_notices(canonical_person_id)
    WHERE canonical_person_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- access_entries → canonical_persons
DO $$ BEGIN
  ALTER TABLE public.access_entries
    ADD COLUMN IF NOT EXISTS canonical_person_id UUID
      REFERENCES public.canonical_persons(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_access_entries_canonical
    ON public.access_entries(canonical_person_id)
    WHERE canonical_person_id IS NOT NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;


-- ── 7. Backfill from persons_of_interest ─────────────────────────────────────
-- Migrate existing POI records into canonical_persons and back-link.
-- persons_of_interest stays as-is; canonical_person_id is set for each.

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
      risk_level,
      risk_category,
      privacy_notice_given,
      privacy_lawful_purpose,
      expiry_date,
      created_by,
      created_at,
      updated_at
    )
    VALUES (
      r.organization_id,
      -- Split full_name into first/last on first space
      TRIM(SPLIT_PART(r.full_name, ' ', 1)),
      TRIM(SUBSTRING(r.full_name FROM POSITION(' ' IN r.full_name) + 1)),
      r.date_of_birth,
      r.gender,
      r.ethnicity,
      r.height_cm,
      r.weight_kg,
      r.distinguishing_features,
      r.description,
      -- identity_status: known full_name → 'identified', else 'partial'
      CASE WHEN r.full_name IS NOT NULL AND TRIM(r.full_name) <> '' THEN 'identified' ELSE 'unknown' END,
      r.contact_phone,
      r.contact_email,
      r.address,
      -- is_poi: status = 'poi' or any status present
      (r.status IN ('poi', 'banned', 'trespassed')),
      (r.status = 'trespassed'),
      (r.status = 'banned'),
      false,  -- is_flagged
      r.reason,
      r.notes,
      NULL,   -- risk_level (not in persons_of_interest)
      NULL,   -- risk_category
      COALESCE(r.privacy_notice_given, false),
      COALESCE(r.privacy_lawful_purpose,
        'NZ Trespass Act 1980 / Freedom Camping Act 2011 enforcement'),
      r.expires_at,
      r.created_by,
      COALESCE(r.created_at, now()),
      COALESCE(r.updated_at, now())
    )
    RETURNING id INTO v_canonical_id;

    -- Back-link
    UPDATE public.persons_of_interest
    SET canonical_person_id = v_canonical_id
    WHERE id = r.id;
  END LOOP;

  RAISE NOTICE '✅ persons_of_interest → canonical_persons backfill complete';
END;
$$;


-- ── 8. Backfill from person_records ──────────────────────────────────────────
-- Migrate person_records that don't already have a canonical_person_id.
-- If a persons_of_interest record was already created for the same person
-- (matched by org + name + DOB), link to that instead of creating a duplicate.

DO $$
DECLARE
  r              RECORD;
  v_canonical_id UUID;
BEGIN
  FOR r IN
    SELECT * FROM public.person_records
    WHERE canonical_person_id IS NULL
  LOOP
    -- Try to find an existing canonical_persons record for this person
    SELECT cp.id INTO v_canonical_id
    FROM public.canonical_persons cp
    WHERE cp.organization_id = r.organization_id
      AND LOWER(TRIM(COALESCE(cp.first_name, ''))) = LOWER(TRIM(COALESCE(r.first_name, '')))
      AND LOWER(TRIM(COALESCE(cp.last_name, '')))  = LOWER(TRIM(COALESCE(r.last_name, '')))
      AND (
        r.date_of_birth IS NULL
        OR cp.date_of_birth IS NULL
        OR cp.date_of_birth = r.date_of_birth
      )
    LIMIT 1;

    IF v_canonical_id IS NULL THEN
      -- Create new canonical_persons record
      INSERT INTO public.canonical_persons (
        organization_id,
        first_name,
        last_name,
        date_of_birth,
        identity_status,
        is_poi,
        is_trespassed,
        is_flagged,
        flagged_reason,
        risk_level,
        risk_category,
        total_interactions,
        last_seen_at,
        created_at,
        updated_at
      )
      VALUES (
        r.organization_id,
        r.first_name,
        r.last_name,
        r.date_of_birth,
        CASE
          WHEN r.first_name IS NOT NULL AND r.last_name IS NOT NULL THEN 'identified'
          WHEN r.first_name IS NOT NULL OR r.last_name IS NOT NULL  THEN 'partial'
          ELSE 'unknown'
        END,
        COALESCE(r.is_of_interest, false),
        COALESCE(r.trespass_notice_issued, false),
        false,
        NULL,
        r.risk_level,
        r.risk_category,
        COALESCE(r.total_interactions, 0),
        r.last_contact_at,
        COALESCE(r.created_at, now()),
        COALESCE(r.updated_at, now())
      )
      RETURNING id INTO v_canonical_id;
    END IF;

    -- Back-link person_records → canonical_persons
    UPDATE public.person_records
    SET canonical_person_id = v_canonical_id
    WHERE id = r.id;
  END LOOP;

  RAISE NOTICE '✅ person_records → canonical_persons backfill complete';
END;
$$;


-- ── 9. Cross-org safety view for persons ─────────────────────────────────────
-- Extend the v_person_safety_flags view to use canonical_persons data.
-- The existing view joins person_records → person_vehicle_links.
-- This new view joins canonical_persons → canonical_person_zones → zones
-- so that process-officer-scan can surface high-risk person flags by zone.

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
WHERE cp.risk_level IN ('high', 'critical')
  AND cp.risk_category IN ('violence', 'aggression', 'weapon')
  AND cpz.is_active = true;

COMMENT ON VIEW public.v_canonical_person_safety_flags IS
  'Cross-org safety signal: high/critical risk canonical persons, zone-scoped. '
  'Contains NO PII — only ids, risk level, category, and zone. '
  'Legal basis: NZ Privacy Act 2020 IPP 11(1)(c) (serious threat to officer safety).';

GRANT SELECT ON public.v_canonical_person_safety_flags TO authenticated;
GRANT SELECT ON public.v_canonical_person_safety_flags TO service_role;


-- ── 10. Completion notice ─────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '✅ canonical_persons table created';
  RAISE NOTICE '✅ canonical_person_zones join table created';
  RAISE NOTICE '✅ RLS policies applied (org-scoped; zone enforcement at application layer)';
  RAISE NOTICE '✅ Youth protection trigger: is_minor auto-set, photo_url blocked for minors';
  RAISE NOTICE '✅ zone_ids denormalised array synced by trigger on canonical_person_zones';
  RAISE NOTICE '✅ get_canonical_person_for_zone() RPC: geofence-gated zone lookup';
  RAISE NOTICE '✅ match_canonical_person_by_embedding() RPC: zone-scoped face match';
  RAISE NOTICE '✅ canonical_person_id FK added to: person_records, persons_of_interest,';
  RAISE NOTICE '     face_records, incidents, person_id_documents, trespass_notices, access_entries';
  RAISE NOTICE '✅ Backfill from persons_of_interest and person_records complete';
  RAISE NOTICE '✅ v_canonical_person_safety_flags cross-org view created';
END;
$$;
