-- ============================================================
-- Enterprise Patrol & Dispatch Alignment — Phase 1 Schema
-- ============================================================
-- 1. specialty_type on patrols
-- 2. specialty_type + job_mode on dispatch_jobs
-- 3. patrol_location_events table (onsite/offsite + manual overrides)
-- 4. sla_threshold_minutes on organizations (per-org KPI config)
-- 5. route_distance_km + actual_distance_km on patrols (km efficiency)
-- ============================================================

-- ── 1. patrols.specialty_type ─────────────────────────────────────────────
ALTER TABLE public.patrols
  ADD COLUMN IF NOT EXISTS specialty_type text
    CHECK (specialty_type IN (
      'freedom_camping', 'parking_warden', 'excessive_smoke',
      'noise_control', 'biosecurity', 'general'
    ));

-- km efficiency tracking on patrols
ALTER TABLE public.patrols
  ADD COLUMN IF NOT EXISTS route_distance_km  numeric(8,3),
  ADD COLUMN IF NOT EXISTS actual_distance_km numeric(8,3);

-- ── 2. dispatch_jobs.specialty_type + job_mode ────────────────────────────
ALTER TABLE public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS specialty_type text
    CHECK (specialty_type IN (
      'freedom_camping', 'parking_warden', 'excessive_smoke',
      'noise_control', 'biosecurity', 'general'
    )),
  ADD COLUMN IF NOT EXISTS job_mode text NOT NULL DEFAULT 'dispatch_oneoff'
    CHECK (job_mode IN ('patrol_embed', 'dispatch_oneoff')),
  ADD COLUMN IF NOT EXISTS patrol_id uuid
    REFERENCES public.patrols(id) ON DELETE SET NULL;

-- ── 3. patrol_location_events ─────────────────────────────────────────────
-- Records every onsite / offsite / override event for a patrol
-- Used for KPI: time-on-site vs time-in-transit, geofence audit trail.
CREATE TABLE IF NOT EXISTS public.patrol_location_events (
  id              uuid         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patrol_id       uuid         NOT NULL REFERENCES public.patrols(id) ON DELETE CASCADE,
  organization_id uuid         NOT NULL REFERENCES public.organizations(id),
  officer_id      uuid         REFERENCES public.user_profiles(id),
  event_type      text         NOT NULL
    CHECK (event_type IN ('onsite', 'offsite', 'override_onsite', 'override_offsite')),
  gps_lat         numeric(10,7),
  gps_lng         numeric(10,7),
  gps_accuracy_m  numeric(8,2),
  is_manual_override  boolean  NOT NULL DEFAULT false,
  override_reason text,
  recorded_at     timestamptz  NOT NULL DEFAULT now(),
  created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patrol_location_events_patrol_id
  ON public.patrol_location_events(patrol_id);

CREATE INDEX IF NOT EXISTS idx_patrol_location_events_org_recorded
  ON public.patrol_location_events(organization_id, recorded_at DESC);

-- Row-level security: org-scoped read/write
ALTER TABLE public.patrol_location_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patrol_location_events_org_select"
  ON public.patrol_location_events FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
      UNION
      SELECT employer_organization_id FROM public.user_profiles WHERE id = auth.uid() AND employer_organization_id IS NOT NULL
    )
  );

CREATE POLICY "patrol_location_events_org_insert"
  ON public.patrol_location_events FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
      UNION
      SELECT employer_organization_id FROM public.user_profiles WHERE id = auth.uid() AND employer_organization_id IS NOT NULL
    )
  );

-- ── 4. organizations.sla_threshold_minutes ───────────────────────────────
-- Per-org SLA threshold for patrol arrival (default 15 min late = breach).
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS patrol_sla_threshold_minutes integer NOT NULL DEFAULT 15;

-- ── 5. Specialty job type config table (DB-driven, no hardcoded enums) ───
CREATE TABLE IF NOT EXISTS public.specialty_job_types (
  id              uuid    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid    REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- NULL organization_id = global/system default visible to all orgs
  type_key        text    NOT NULL,
  label           text    NOT NULL,
  portal_path     text    NOT NULL,
  service_type    text    NOT NULL,
  job_mode        text    NOT NULL DEFAULT 'dispatch_oneoff'
    CHECK (job_mode IN ('patrol_embed', 'dispatch_oneoff', 'both')),
  description     text,
  icon_name       text,
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, type_key)
);

CREATE INDEX IF NOT EXISTS idx_specialty_job_types_org
  ON public.specialty_job_types(organization_id, is_active, sort_order);

ALTER TABLE public.specialty_job_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "specialty_job_types_select"
  ON public.specialty_job_types FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id IN (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
      UNION
      SELECT employer_organization_id FROM public.user_profiles WHERE id = auth.uid() AND employer_organization_id IS NOT NULL
    )
  );

CREATE POLICY "specialty_job_types_admin_write"
  ON public.specialty_job_types FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'master', 'admin_officer')
    )
  );

-- Seed global defaults
INSERT INTO public.specialty_job_types
  (organization_id, type_key, label, portal_path, service_type, job_mode, description, icon_name, sort_order)
VALUES
  (NULL, 'freedom_camping',   'Freedom Camping',      '/field-officer?service=freedom_camping', 'freedom_camping',       'both',           'Freedom camping inspection and enforcement',              'Tent',    10),
  (NULL, 'parking_warden',    'Parking Enforcement',  '/parking-officer',                        'parking',              'both',           'Parking infringement and enforcement',                    'ParkingSquare', 20),
  (NULL, 'excessive_smoke',   'Excessive Smoke',      '/smoke-officer',                          'smoke_complaint_ooh',  'both',           'Excessive smoke complaint and assessment',                'Wind',    30),
  (NULL, 'noise_control',     'Noise Control',        '/noise-officer',                          'noise',                'both',           'Noise complaint investigation and enforcement',           'Volume2', 40),
  (NULL, 'biosecurity',       'Biosecurity',          '/biosecurity-officer',                    'biosecurity_inspection','both',          'Biosecurity inspection and threat assessment',            'Leaf',    50),
  (NULL, 'general',           'General Field Job',    '/field-officer?service=patrol',           'patrol',               'dispatch_oneoff','General field officer task',                             'Shield',  60)
ON CONFLICT (organization_id, type_key) DO NOTHING;
