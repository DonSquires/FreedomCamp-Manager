-- ============================================================================
-- Phase C2: Access Control / Face Recognition / Identity Verification /
--           Site Risk Assessment — Case Model Bridge
-- Date: 2026-05-08
--
-- Extends operational_cases with access_control and identity_check case types,
-- and adds case_id FKs to the four C2 domain tables for unified timeline.
-- ============================================================================

-- ── 1. Extend operational_cases CHECK constraints ────────────────────────────

ALTER TABLE public.operational_cases
  DROP CONSTRAINT IF EXISTS operational_cases_case_type_check;

ALTER TABLE public.operational_cases
  ADD CONSTRAINT operational_cases_case_type_check
  CHECK (case_type IN (
    'dispatch', 'patrol', 'enforcement', 'investigation', 'audit',
    'site_guard', 'access_control', 'identity_check'
  ));

ALTER TABLE public.operational_cases
  DROP CONSTRAINT IF EXISTS operational_cases_created_from_check;

ALTER TABLE public.operational_cases
  ADD CONSTRAINT operational_cases_created_from_check
  CHECK (created_from IN (
    'dispatch', 'patrol', 'breach', 'observation', 'manual',
    'site_guard', 'access_control', 'identity_check'
  ));

-- ── 2. access_control_incidents — attach to case ─────────────────────────────

ALTER TABLE public.access_control_incidents
  ADD COLUMN IF NOT EXISTS case_id UUID
    REFERENCES public.operational_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_access_control_incidents_case
  ON public.access_control_incidents(case_id)
  WHERE case_id IS NOT NULL;

-- ── 3. access_entries — attach to case ───────────────────────────────────────

ALTER TABLE public.access_entries
  ADD COLUMN IF NOT EXISTS case_id UUID
    REFERENCES public.operational_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_access_entries_case
  ON public.access_entries(case_id)
  WHERE case_id IS NOT NULL;

-- ── 4. person_id_documents — attach to case ──────────────────────────────────

ALTER TABLE public.person_id_documents
  ADD COLUMN IF NOT EXISTS case_id UUID
    REFERENCES public.operational_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_person_id_documents_case
  ON public.person_id_documents(case_id)
  WHERE case_id IS NOT NULL;

-- ── 5. site_risk_assessments — attach to case ────────────────────────────────

ALTER TABLE public.site_risk_assessments
  ADD COLUMN IF NOT EXISTS case_id UUID
    REFERENCES public.operational_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_site_risk_assessments_case
  ON public.site_risk_assessments(case_id)
  WHERE case_id IS NOT NULL;
