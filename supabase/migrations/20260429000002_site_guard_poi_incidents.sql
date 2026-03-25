-- ============================================================================
-- Site Guard POI Scoping + Site Incident Reports
-- Date: 2026-04-29
--
-- Changes:
--   1. client_sites       — adds geofence_radius_metres (default 150 m) and
--                           'guarding' + 'research' to site_type CHECK
--   2. persons_of_interest — adds client_site_id for site-scoped POI records
--   3. site_incidents     — new table for static guard incident reports at
--                           client sites, including police involvement,
--                           camera review requests and POI linkage
-- ============================================================================

-- ── 1. client_sites: geofence radius + extra site types ──────────────────────

ALTER TABLE public.client_sites
  ADD COLUMN IF NOT EXISTS geofence_radius_metres INTEGER NOT NULL DEFAULT 150;

-- The site_type column has a CHECK constraint — drop and recreate with new values
DO $$
BEGIN
  -- Try to update the CHECK; if the column doesn't exist this is a no-op
  ALTER TABLE public.client_sites
    DROP CONSTRAINT IF EXISTS client_sites_site_type_check;
EXCEPTION WHEN others THEN NULL;
END $$;

ALTER TABLE public.client_sites
  ADD CONSTRAINT client_sites_site_type_check
  CHECK (site_type IN (
    'general', 'freedom_camping', 'guarding', 'parking',
    'noise_control', 'event', 'infrastructure', 'research', 'bus_hub',
    'government', 'commercial'
  ));

COMMENT ON COLUMN public.client_sites.geofence_radius_metres IS
  'Radius (metres) around gps_lat/gps_lng that defines the site geofence. '
  'Officers inside this radius get access to site-scoped POI records.';

-- ── 2. persons_of_interest: site-scoping ─────────────────────────────────────
-- A POI can be scoped to a specific client site (e.g. banned from Nelson Bus Hub)
-- instead of an entire organisation.  NULL means org-wide.

ALTER TABLE public.persons_of_interest
  ADD COLUMN IF NOT EXISTS client_site_id UUID
    REFERENCES public.client_sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS site_specific  BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_poi_site
  ON public.persons_of_interest(client_site_id)
  WHERE client_site_id IS NOT NULL;

COMMENT ON COLUMN public.persons_of_interest.client_site_id IS
  'When set, this POI record is scoped to a specific client site. Officers only '
  'see it when they are inside the site geofence.';
COMMENT ON COLUMN public.persons_of_interest.site_specific IS
  'TRUE if this record should only appear within the site geofence. '
  'FALSE (default) = visible to all authorised officers in the org.';

-- ── 3. site_incidents ─────────────────────────────────────────────────────────
-- Full incident report for static-guard and patrol officers at a client site.
-- Designed to capture events even when no name or photo is available.
-- Police involvement and camera review request fields facilitate follow-up.

CREATE TABLE IF NOT EXISTS public.site_incidents (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_site_id          UUID        REFERENCES public.client_sites(id)  ON DELETE SET NULL,
  officer_id              UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  officer_shift_id        UUID        REFERENCES public.officer_shifts(id) ON DELETE SET NULL,
  roster_shift_id         UUID        REFERENCES public.roster_shifts(id)  ON DELETE SET NULL,

  -- Subject identification (all optional — officer may not have any details)
  subject_name            TEXT,                    -- may be unknown
  subject_dob             DATE,
  subject_description     TEXT,                    -- physical description
  subject_photos          TEXT[]      DEFAULT '{}',  -- Supabase Storage URLs
  poi_id                  UUID        REFERENCES public.persons_of_interest(id) ON DELETE SET NULL,

  -- Incident details
  incident_type           TEXT        NOT NULL
    CHECK (incident_type IN (
      'trespass', 'suspicious_behaviour', 'assault', 'theft',
      'vandalism', 'verbal_abuse', 'intoxication', 'welfare_check',
      'anti_social_behaviour', 'property_damage', 'unauthorized_access',
      'other'
    )),
  severity                TEXT        NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description             TEXT        NOT NULL,
  action_taken            TEXT,
  outcome                 TEXT,

  -- Police involvement
  police_notified         BOOLEAN     NOT NULL DEFAULT false,
  police_notified_at      TIMESTAMPTZ,
  police_event_number     TEXT,                    -- NZ Police event / occurrence number
  police_officer_name     TEXT,                    -- attending officer name/badge
  police_station          TEXT,
  police_notes            TEXT,

  -- Camera review request
  camera_review_requested BOOLEAN     NOT NULL DEFAULT false,
  camera_review_notes     TEXT,        -- which cameras / timeframes to review
  camera_review_status    TEXT        DEFAULT 'not_requested'
    CHECK (camera_review_status IN (
      'not_requested', 'requested', 'in_progress', 'completed', 'no_footage'
    )),

  -- Location
  gps_lat                 DOUBLE PRECISION,
  gps_lng                 DOUBLE PRECISION,
  location_description    TEXT,

  -- Workflow
  status                  TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'reviewed', 'closed')),
  reviewed_by             UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  reviewed_at             TIMESTAMPTZ,
  admin_notes             TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_incidents_org_site
  ON public.site_incidents(organization_id, client_site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_incidents_officer
  ON public.site_incidents(officer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_incidents_poi
  ON public.site_incidents(poi_id)
  WHERE poi_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_site_incidents_police
  ON public.site_incidents(police_notified, status)
  WHERE police_notified = true;

CREATE INDEX IF NOT EXISTS idx_site_incidents_camera
  ON public.site_incidents(camera_review_requested, camera_review_status)
  WHERE camera_review_requested = true;

CREATE OR REPLACE FUNCTION public.update_site_incidents_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_site_incidents_updated_at
  BEFORE UPDATE ON public.site_incidents
  FOR EACH ROW EXECUTE FUNCTION public.update_site_incidents_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.site_incidents ENABLE ROW LEVEL SECURITY;

-- Officers: read and create their own incident reports
DROP POLICY IF EXISTS "officers_manage_own_site_incidents" ON public.site_incidents;
CREATE POLICY "officers_manage_own_site_incidents"
  ON public.site_incidents
  FOR ALL
  TO authenticated
  USING (officer_id = auth.uid())
  WITH CHECK (officer_id = auth.uid());

-- Admins / master / grand_master: full access within their org
DROP POLICY IF EXISTS "admins_manage_site_incidents" ON public.site_incidents;
CREATE POLICY "admins_manage_site_incidents"
  ON public.site_incidents
  FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
    AND get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
    AND get_user_role(auth.uid()) IN ('grand_master', 'master', 'admin', 'admin_officer')
  );

-- Client viewers: can read incidents for their organisation's sites
DROP POLICY IF EXISTS "client_viewer_read_site_incidents" ON public.site_incidents;
CREATE POLICY "client_viewer_read_site_incidents"
  ON public.site_incidents
  FOR SELECT
  TO authenticated
  USING (
    get_user_role(auth.uid()) = 'client_viewer'
    AND organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

-- ── Notify ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 20260429000002 complete:';
  RAISE NOTICE '   client_sites.geofence_radius_metres added (default 150 m)';
  RAISE NOTICE '   client_sites site_type extended: bus_hub, government, commercial, research';
  RAISE NOTICE '   persons_of_interest.client_site_id + site_specific added';
  RAISE NOTICE '   site_incidents table created (trespass, assault, theft, police, camera review)';
END $$;
