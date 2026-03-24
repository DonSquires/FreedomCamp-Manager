-- Monthly geofence governance support
-- Adds geofence-aware drift metadata and monthly snapshot table.

ALTER TABLE public.drift_events
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'compliance',
  ADD COLUMN IF NOT EXISTS review_month date,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS remediation_notes text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- Keep event_type values controlled but forward-compatible for new drift classes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'drift_events_event_type_check'
      AND conrelid = 'public.drift_events'::regclass
  ) THEN
    ALTER TABLE public.drift_events
      ADD CONSTRAINT drift_events_event_type_check
      CHECK (
        event_type IN (
          'compliance',
          'geofence_new_zone',
          'geofence_boundary_change',
          'geofence_degraded_zone'
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_drift_events_event_type
  ON public.drift_events(event_type);

CREATE INDEX IF NOT EXISTS idx_drift_events_review_month
  ON public.drift_events(review_month);

CREATE INDEX IF NOT EXISTS idx_drift_events_zone_type_month
  ON public.drift_events(zone_id, event_type, review_month);

CREATE TABLE IF NOT EXISTS public.zone_geofence_monthly_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  snapshot_month date NOT NULL,
  zone_name text NOT NULL,
  zone_type text,
  geometry_type text,
  geometry_hash text,
  quality_status text NOT NULL DEFAULT 'ok',
  quality_reason text,
  quality_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (zone_id, snapshot_month)
);

CREATE INDEX IF NOT EXISTS idx_zone_geofence_snapshots_month
  ON public.zone_geofence_monthly_snapshots(snapshot_month);

CREATE INDEX IF NOT EXISTS idx_zone_geofence_snapshots_org_month
  ON public.zone_geofence_monthly_snapshots(organization_id, snapshot_month);
