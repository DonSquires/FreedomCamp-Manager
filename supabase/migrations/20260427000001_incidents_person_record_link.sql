-- ============================================================================
-- Link incidents to person_records
-- ============================================================================
-- Adds person_record_id to incidents so that an incident report can be
-- associated with a known person.  Also adds incident_id to face_records
-- so that a face capture taken during an incident is traceable back to it.
-- ============================================================================

-- 1. Add person_record_id to incidents
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS person_record_id UUID
    REFERENCES public.person_records(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_person
  ON public.incidents(person_record_id)
  WHERE person_record_id IS NOT NULL;

-- 2. Add incident_id to face_records so a face capture can be tied to an incident
ALTER TABLE public.face_records
  ADD COLUMN IF NOT EXISTS incident_id UUID
    REFERENCES public.incidents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_face_records_incident
  ON public.face_records(incident_id)
  WHERE incident_id IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE '✅ incidents.person_record_id added';
  RAISE NOTICE '✅ face_records.incident_id added';
END;
$$;
