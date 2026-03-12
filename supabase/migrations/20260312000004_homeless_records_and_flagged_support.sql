-- Ensure homeless tracking and flagging tables support current import/compliance flows.

-- ---------------------------------------------------------------------------
-- 1) Expand flagged_vehicles to match fields used by process-homeless-data
-- ---------------------------------------------------------------------------
ALTER TABLE public.flagged_vehicles
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_known_site TEXT,
  ADD COLUMN IF NOT EXISTS date_recorded TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vehicle_description TEXT,
  ADD COLUMN IF NOT EXISTS name_contact TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_homeless BOOLEAN,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_flagged_vehicles_active
  ON public.flagged_vehicles(is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_flagged_vehicles_recorded_at
  ON public.flagged_vehicles(date_recorded DESC);

-- ---------------------------------------------------------------------------
-- 2) Add homeless_records table (auditable source for homeless status history)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.homeless_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plate_number TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('claimed', 'confirmed', 'suspected', 'declined')),
  source TEXT NOT NULL DEFAULT 'system',
  notes TEXT,
  first_reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_homeless_records_org
  ON public.homeless_records(organization_id);

CREATE INDEX IF NOT EXISTS idx_homeless_records_plate
  ON public.homeless_records(plate_number);

CREATE INDEX IF NOT EXISTS idx_homeless_records_status
  ON public.homeless_records(status)
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS ux_homeless_records_org_plate_active
  ON public.homeless_records(organization_id, plate_number)
  WHERE is_active = true;

ALTER TABLE public.homeless_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_users_select_homeless_records ON public.homeless_records;
DROP POLICY IF EXISTS admin_manage_homeless_records ON public.homeless_records;

CREATE POLICY org_users_select_homeless_records
  ON public.homeless_records FOR SELECT
  TO authenticated
  USING (
    (get_user_role(auth.uid()) = 'master')
    OR
    (organization_id = ANY(get_user_organization_ids()))
  );

CREATE POLICY admin_manage_homeless_records
  ON public.homeless_records FOR ALL
  TO authenticated
  USING (
    (
      (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'admin_officer'::text, 'master'::text]))
      AND
      (
        (get_user_role(auth.uid()) = 'master')
        OR
        (organization_id IN (
          SELECT user_profiles.organization_id
          FROM public.user_profiles
          WHERE user_profiles.id = auth.uid()
        ))
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 3) Backfill flagged_vehicles from canonical_vehicles.is_flagged
-- ---------------------------------------------------------------------------
WITH latest_org AS (
  SELECT DISTINCT ON (o.plate_number)
    o.plate_number,
    o.organization_id,
    o.recorded_at
  FROM public.observations o
  WHERE o.organization_id IS NOT NULL
  ORDER BY o.plate_number, o.recorded_at DESC
)
INSERT INTO public.flagged_vehicles (
  organization_id,
  plate_number,
  reason,
  priority,
  notes,
  is_active,
  date_recorded,
  created_by,
  flagged_by
)
SELECT
  lo.organization_id,
  cv.plate_number,
  COALESCE(cv.flagged_reason, 'Flagged in canonical vehicle registry') AS reason,
  COALESCE(cv.flagged_priority, 'medium') AS priority,
  cv.flagged_notes,
  true,
  COALESCE(cv.flagged_at, lo.recorded_at, now()) AS date_recorded,
  cv.flagged_by,
  cv.flagged_by
FROM public.canonical_vehicles cv
LEFT JOIN latest_org lo
  ON lo.plate_number = cv.plate_number
WHERE cv.is_flagged = true
  AND lo.organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.flagged_vehicles fv
    WHERE fv.plate_number = cv.plate_number
      AND fv.organization_id = lo.organization_id
      AND COALESCE(fv.is_active, true) = true
  );

-- ---------------------------------------------------------------------------
-- 4) Backfill homeless_records from canonical_vehicles.homeless_status
-- ---------------------------------------------------------------------------
WITH latest_org AS (
  SELECT DISTINCT ON (o.plate_number)
    o.plate_number,
    o.organization_id,
    o.recorded_at
  FROM public.observations o
  WHERE o.organization_id IS NOT NULL
  ORDER BY o.plate_number, o.recorded_at DESC
)
INSERT INTO public.homeless_records (
  organization_id,
  plate_number,
  status,
  source,
  notes,
  first_reported_at,
  last_reported_at,
  is_active,
  created_by,
  updated_by
)
SELECT
  lo.organization_id,
  cv.plate_number,
  cv.homeless_status,
  'canonical_backfill',
  cv.homeless_notes,
  COALESCE(cv.homeless_confirmed_at, lo.recorded_at, now()),
  COALESCE(cv.updated_at, lo.recorded_at, now()),
  true,
  cv.homeless_confirmed_by,
  cv.homeless_confirmed_by
FROM public.canonical_vehicles cv
JOIN latest_org lo
  ON lo.plate_number = cv.plate_number
WHERE cv.homeless_status IN ('claimed', 'confirmed', 'suspected', 'declined')
ON CONFLICT (organization_id, plate_number)
WHERE is_active = true
DO UPDATE
SET
  status = EXCLUDED.status,
  source = 'canonical_backfill',
  notes = COALESCE(EXCLUDED.notes, public.homeless_records.notes),
  last_reported_at = GREATEST(public.homeless_records.last_reported_at, EXCLUDED.last_reported_at),
  updated_at = now();
