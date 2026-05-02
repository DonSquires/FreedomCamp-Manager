-- =============================================================================
-- Migration: Dispatch Resources — Patrol Runs / Callsigns / Shift Templates
-- Date: 2026-07-07
-- =============================================================================
--
-- Problem this solves:
--   The existing `zones` table is also used to represent patrol runs
--   (callsigns like "587 Nelson Night Patrol"). This table separates the
--   *operational resource* concern from the *geographic area* concern.
--
-- DispatchResource represents:
--   - A named patrol run or callsign (e.g. "587", "Nelson Night Patrol")
--   - Its shift template (active days, start/end time)
--   - Its home depot / base location (via LOI)
--   - Contact endpoints (app queue, SMS, email)
--   - Auto-dispatch eligibility flag
--
-- A DispatchResource can be scheduled (runs on a recurring template) or used
-- ad-hoc (manually dispatched for a single job).
--
-- Relationship summary:
--   dispatch_resources  *──* geo_zones     (via geo_zone_dispatch_map)
--   dispatch_resources  1──1 LOI           (optional depot/base)
--   dispatch_jobs       *──1 dispatch_resources  (assigned_run_id — new column)
--   zones               1──1 dispatch_resources  (optional bridge FK)
--
-- NOTE: The existing `patrol_routes` table (20260507000001) is the closest
-- equivalent but is route-centric (checkpoints, sites). DispatchResource is
-- *callsign/run-centric* and owns the scheduling template.  In the future,
-- patrol_routes may be linked to dispatch_resources; for now they coexist.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.dispatch_resources (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Identity
  callsign              TEXT        NOT NULL,  -- e.g. "587", "Nelson Night"
  name                  TEXT        NOT NULL,  -- e.g. "587 Nelson Night Patrol"
  description           TEXT,
  resource_kind         TEXT        NOT NULL DEFAULT 'patrol_run'
                          CHECK (resource_kind IN (
                            'patrol_run',      -- mobile patrol covering a zone
                            'static_guard',    -- fixed post (mall, site)
                            'response_unit',   -- reactive response vehicle
                            'supervisor',      -- supervisory callsign
                            'other'
                          )),

  -- Home depot / base location (references LOI)
  -- TODO: populate via backfill from patrol_routes.primary_zone_id → LOI
  base_loi_id           UUID        REFERENCES public.locations_of_interest(id) ON DELETE SET NULL,

  -- Shift template — active days (1=Mon … 7=Sun, ISO weekday)
  active_days           INTEGER[]   DEFAULT '{1,2,3,4,5,6,7}',

  -- Default shift window (local NZ time stored as TIME)
  default_shift         TEXT        DEFAULT 'night'
                          CHECK (default_shift IN ('day', 'swing', 'night', 'custom')),
  default_start_time    TIME,
  default_end_time      TIME,

  -- Scheduling groundwork (stub — full ServicePlan/Occurrence not yet implemented)
  -- When TRUE this resource participates in the scheduling engine.
  -- See: docs/DOMAIN_MODEL.md §Scheduling Groundwork
  scheduling_enabled    BOOLEAN     NOT NULL DEFAULT false,
  -- TODO: link to service_plans.dispatch_resource_id when scheduling engine is built

  -- Auto-dispatch eligibility
  auto_dispatch_enabled BOOLEAN     NOT NULL DEFAULT false,

  -- Contact / notification endpoints
  app_queue_id          TEXT,       -- PTT channel or app notification queue
  sms_number            TEXT,
  email_address         TEXT,

  -- Bridge to existing patrol_routes (optional; preserves backwards compat)
  patrol_route_id       UUID        REFERENCES public.patrol_routes(id) ON DELETE SET NULL,

  -- Display / UI
  color                 TEXT        DEFAULT '#10B981',
  icon                  TEXT        DEFAULT 'car',

  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_by            UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique callsign per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_resources_callsign
  ON public.dispatch_resources(organization_id, callsign);

CREATE INDEX IF NOT EXISTS idx_dispatch_resources_org_active
  ON public.dispatch_resources(organization_id, is_active, resource_kind);

CREATE INDEX IF NOT EXISTS idx_dispatch_resources_patrol_route
  ON public.dispatch_resources(patrol_route_id) WHERE patrol_route_id IS NOT NULL;

-- ── Updated-at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_dispatch_resources_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_resources_updated_at ON public.dispatch_resources;
CREATE TRIGGER trg_dispatch_resources_updated_at
  BEFORE UPDATE ON public.dispatch_resources
  FOR EACH ROW EXECUTE FUNCTION public.update_dispatch_resources_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.dispatch_resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dispatch_resources_select_org_members"
  ON public.dispatch_resources FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT unnest(get_user_organization_ids()))
  );

CREATE POLICY "dispatch_resources_write_admins"
  ON public.dispatch_resources FOR ALL TO authenticated
  USING (
    organization_id IN (SELECT unnest(get_user_organization_ids()))
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master')
    )
  )
  WITH CHECK (
    organization_id IN (SELECT unnest(get_user_organization_ids()))
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'admin_officer', 'master')
    )
  );

-- ── Column comments ───────────────────────────────────────────────────────────
COMMENT ON TABLE  public.dispatch_resources IS
  'Patrol runs / callsigns / shift templates. '
  'Distinct from geo_zones (polygon areas). A dispatch resource covers one or '
  'more geo_zones (defined via geo_zone_dispatch_map) and can be scheduled or '
  'used ad-hoc. Maps loosely to the WILSAR concept of a patrol run/callsign.';

COMMENT ON COLUMN public.dispatch_resources.callsign IS
  'Short operational callsign, e.g. "587", "Nelson Night". '
  'Unique per organization.';
COMMENT ON COLUMN public.dispatch_resources.base_loi_id IS
  'Home depot or base location (LOI). Used for nearest-depot routing.';
COMMENT ON COLUMN public.dispatch_resources.active_days IS
  'ISO weekday numbers (1=Mon … 7=Sun) when this run operates.';
COMMENT ON COLUMN public.dispatch_resources.scheduling_enabled IS
  'Stub flag: TRUE when this resource participates in the scheduling engine. '
  'Full ServicePlan/Occurrence support is planned for a future migration.';
COMMENT ON COLUMN public.dispatch_resources.patrol_route_id IS
  'Optional bridge to the existing patrol_routes table (backwards compat).';
