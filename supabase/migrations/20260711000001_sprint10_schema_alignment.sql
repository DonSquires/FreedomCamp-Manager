-- ============================================================================
-- Sprint 10 Schema Alignment — B-39 / B-40 / B-41
-- Date: 2026-07-11
--
-- Fixes three schema mismatches between the Sprint 10 page components and
-- the database tables they depend on:
--
--   B-39  service_agreements  — drop + recreate with page-expected columns
--   B-41  access_entries      — add officer_override_reason column
--   B-40  persons_of_interest — extend status CHECK to full UI enum
--   B-40  vehicles_of_interest — extend status CHECK to full UI enum
-- ============================================================================

-- ── 1. service_agreements — drop old schema, recreate for B-39 ──────────────
--
-- The table created in phase_c4 used agreement_number / service_type /
-- start_date / end_date.  The ServiceAgreements.tsx page expects:
--   name, reference_number, agreement_type, allows_client_submission,
--   allows_auto_dispatch, default_sla_minutes, default_priority,
--   active_from, active_to, is_active.

DROP TABLE IF EXISTS public.service_agreements CASCADE;

CREATE TABLE public.service_agreements (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_org_id           UUID        REFERENCES public.organizations(id) ON DELETE SET NULL,
  name                    TEXT        NOT NULL,
  reference_number        TEXT,
  agreement_type          TEXT        NOT NULL DEFAULT 'patrol'
    CHECK (agreement_type IN (
      'alarm', 'patrol', 'noise_control', 'freedom_camping',
      'parking', 'investigation', 'guarding', 'biosecurity', 'ems', 'other'
    )),
  allows_client_submission BOOLEAN    NOT NULL DEFAULT false,
  allows_auto_dispatch     BOOLEAN    NOT NULL DEFAULT false,
  default_sla_minutes      INTEGER    NOT NULL DEFAULT 60,
  default_priority         TEXT       NOT NULL DEFAULT 'normal'
    CHECK (default_priority IN ('low', 'normal', 'high', 'urgent')),
  active_from             DATE,
  active_to               DATE,
  notes                   TEXT,
  is_active               BOOLEAN    NOT NULL DEFAULT true,
  created_by              UUID        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.service_agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_agreements_org_policy" ON public.service_agreements;
CREATE POLICY "service_agreements_org_policy" ON public.service_agreements
  FOR ALL TO authenticated
  USING (
    organization_id = (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id = (
      SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_service_agreements_org
  ON public.service_agreements(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_service_agreements_active
  ON public.service_agreements(organization_id, is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_service_agreements_client
  ON public.service_agreements(client_org_id)
  WHERE client_org_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_agreements TO authenticated;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.trg_service_agreements_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_service_agreements_updated_at ON public.service_agreements;
CREATE TRIGGER set_service_agreements_updated_at
  BEFORE UPDATE ON public.service_agreements
  FOR EACH ROW EXECUTE FUNCTION public.trg_service_agreements_updated_at();

-- ── 2. access_entries — add officer_override_reason column (B-41) ────────────
--
-- AccessAuditLog.tsx displays officer_override_reason; the original migration
-- only created flag_reason.  Add the expected column idempotently.

ALTER TABLE public.access_entries
  ADD COLUMN IF NOT EXISTS officer_override_reason TEXT;

COMMENT ON COLUMN public.access_entries.officer_override_reason IS
  'Reason provided when an officer manually overrides a denied access event.';

-- ── 3. persons_of_interest — extend status CHECK (B-40) ──────────────────────
--
-- POIVOIDashboard.tsx statusBadge uses: active, watching, suspended,
-- expired, cleared.  The original CHECK was ('poi','banned','trespassed').
-- Drop and replace with the full set used by the UI.
--
-- Status value guidance (both legacy and workflow values are valid):
--   Legacy (imported / NCC scripts): 'poi', 'banned', 'trespassed'
--   Workflow (created/updated via UI):
--     active    — currently flagged and being monitored
--     watching  — lower-priority monitoring
--     suspended — temporarily paused (not cleared)
--     expired   — watch period elapsed; kept for audit history
--     cleared   — resolved; no further action required
-- All values are retained for backward compatibility with NCC import scripts
-- and existing records.  New UI-created records should use the workflow values.

ALTER TABLE public.persons_of_interest
  DROP CONSTRAINT IF EXISTS persons_of_interest_status_check;

ALTER TABLE public.persons_of_interest
  ADD CONSTRAINT persons_of_interest_status_check
  CHECK (status IN (
    'poi', 'banned', 'trespassed',
    'active', 'watching', 'suspended', 'expired', 'cleared'
  ));

COMMENT ON COLUMN public.persons_of_interest.status IS
  'Watch-list status. Legacy import values: poi, banned, trespassed. '
  'UI workflow values: active, watching, suspended, expired, cleared. '
  'New records created via the admin UI should use the workflow values.';

-- ── 4. vehicles_of_interest — extend status CHECK (B-40) ─────────────────────
--
-- Same mismatch as POI.  Original was ('voi','banned','trespassed').
-- Legacy 'voi'/'banned'/'trespassed' are retained for NCC import compatibility.
-- UI workflow values (active/watching/suspended/expired/cleared) are added for
-- records created or promoted via the POIVOIDashboard admin interface.

ALTER TABLE public.vehicles_of_interest
  DROP CONSTRAINT IF EXISTS vehicles_of_interest_status_check;

ALTER TABLE public.vehicles_of_interest
  ADD CONSTRAINT vehicles_of_interest_status_check
  CHECK (status IN (
    'voi', 'banned', 'trespassed',
    'active', 'watching', 'suspended', 'expired', 'cleared'
  ));

COMMENT ON COLUMN public.vehicles_of_interest.status IS
  'Watch-list status. Legacy import values: voi, banned, trespassed. '
  'UI workflow values: active, watching, suspended, expired, cleared. '
  'New records created via the admin UI should use the workflow values.';
