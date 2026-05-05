-- ============================================================================
-- Phase C3: POI / VOI / Trespass Notices / Alert Queue — Case Bridge
-- Date: 2026-05-08
--
-- Extends operational_cases with poi_alert, voi_alert, and evidence_capture
-- case types, and adds case_id FKs to C3 domain tables.
-- ============================================================================

-- ── 1. Extend operational_cases CHECK constraints ────────────────────────────

ALTER TABLE public.operational_cases
  DROP CONSTRAINT IF EXISTS operational_cases_case_type_check;

ALTER TABLE public.operational_cases
  ADD CONSTRAINT operational_cases_case_type_check
  CHECK (case_type IN (
    'dispatch', 'patrol', 'enforcement', 'investigation', 'audit',
    'site_guard', 'access_control', 'identity_check',
    'poi_alert', 'voi_alert', 'evidence_capture'
  ));

ALTER TABLE public.operational_cases
  DROP CONSTRAINT IF EXISTS operational_cases_created_from_check;

ALTER TABLE public.operational_cases
  ADD CONSTRAINT operational_cases_created_from_check
  CHECK (created_from IN (
    'dispatch', 'patrol', 'breach', 'observation', 'manual',
    'site_guard', 'access_control', 'identity_check',
    'poi_match', 'voi_match', 'evidence'
  ));

-- ── 2. persons_of_interest — attach to case ──────────────────────────────────

ALTER TABLE public.persons_of_interest
  ADD COLUMN IF NOT EXISTS case_id UUID
    REFERENCES public.operational_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_poi_case
  ON public.persons_of_interest(case_id)
  WHERE case_id IS NOT NULL;

-- ── 3. vehicles_of_interest — attach to case ─────────────────────────────────

ALTER TABLE public.vehicles_of_interest
  ADD COLUMN IF NOT EXISTS case_id UUID
    REFERENCES public.operational_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_voi_case
  ON public.vehicles_of_interest(case_id)
  WHERE case_id IS NOT NULL;

-- ── 4. trespass_notices — attach to case ─────────────────────────────────────

ALTER TABLE public.trespass_notices
  ADD COLUMN IF NOT EXISTS case_id UUID
    REFERENCES public.operational_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trespass_notices_case
  ON public.trespass_notices(case_id)
  WHERE case_id IS NOT NULL;

-- ── 5. alert_queue — attach to case ──────────────────────────────────────────

ALTER TABLE public.alert_queue
  ADD COLUMN IF NOT EXISTS case_id UUID
    REFERENCES public.operational_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_alert_queue_case
  ON public.alert_queue(case_id)
  WHERE case_id IS NOT NULL;
