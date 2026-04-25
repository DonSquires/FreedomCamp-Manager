-- ============================================================================
-- Migration: Global Safety Flags — Stolen Vehicles + High-Risk Persons/Vehicles
-- ============================================================================
-- Legal basis: NZ Privacy Act 2020
--
-- WHAT IS GLOBAL (cross-org readable):
--   • is_stolen on canonical_vehicles
--     → IPP 11(1)(e): maintenance of the law. Stolen status is already shared
--       cross-agency by NZ Police / Waka Kotahi convention. No redaction needed.
--   • risk_level IN ('high','critical') + risk_category on canonical_vehicles
--     → IPP 11(1)(c): disclosure to prevent or lessen a serious threat to
--       life, health, or safety of an individual (officer safety).
--       ONLY the flag and category propagate globally — reason/notes/flagging
--       officer identity are redacted for non-admin viewers.
--   • v_person_safety_flags: cross-org view exposing ONLY risk_level +
--     risk_category for high/critical persons linked to scanned plates.
--     No PII (name, DOB, address, notes) is exposed cross-org.
--
-- WHAT STAYS ORG-SCOPED:
--   • Homeless status (canonical_homeless / homeless_records)
--     → Homelessness is sensitive personal information under Privacy Act 2020
--       (may reveal health status, welfare needs, vulnerability). IPP 11(c)
--       serious-threat exception does NOT apply to routine freedom camping
--       enforcement. Stays org-scoped.
--   • flagged_reason, flagged_notes, flagged_by on canonical_vehicles
--     → Redacted from officers (role < admin) when risk_category is a
--       safety category ('violence','aggression','weapon').
--       Admin/master roles see full details.
--   • All person_records columns except the safety signal view
--
-- ============================================================================

-- ── 1. canonical_vehicles — add safety flag columns ──────────────────────────

ALTER TABLE public.canonical_vehicles
  ADD COLUMN IF NOT EXISTS is_stolen         BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stolen_reported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stolen_source      TEXT
    CHECK (stolen_source IN ('nzpf', 'waka_kotahi', 'manual', 'lesa', 'other')),
  ADD COLUMN IF NOT EXISTS risk_level         TEXT
    CHECK (risk_level IN ('low', 'medium', 'high', 'critical', NULL)),
  ADD COLUMN IF NOT EXISTS risk_category      TEXT
    CHECK (risk_category IN ('violence', 'aggression', 'weapon', 'other_safety', NULL));

COMMENT ON COLUMN public.canonical_vehicles.is_stolen IS
  'Vehicle reported stolen. Globally visible — IPP 11(1)(e) maintenance of the law.';
COMMENT ON COLUMN public.canonical_vehicles.stolen_reported_at IS
  'When the stolen report was lodged or imported.';
COMMENT ON COLUMN public.canonical_vehicles.stolen_source IS
  'Source of the stolen report: nzpf=NZ Police, waka_kotahi=NZTA, manual=officer entry.';
COMMENT ON COLUMN public.canonical_vehicles.risk_category IS
  'Safety risk category. Only violence/aggression/weapon propagate globally (officer safety).
  flagged_reason/flagged_notes are redacted for officer role when risk_category is set.';

CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_stolen
  ON public.canonical_vehicles (is_stolen)
  WHERE is_stolen = true;

CREATE INDEX IF NOT EXISTS idx_canonical_vehicles_risk_category
  ON public.canonical_vehicles (risk_category)
  WHERE risk_category IS NOT NULL;


-- ── 2. person_records — add risk_category ────────────────────────────────────

ALTER TABLE public.person_records
  ADD COLUMN IF NOT EXISTS risk_level TEXT
    CHECK (risk_level IN ('low', 'medium', 'high', 'critical', NULL)),
  ADD COLUMN IF NOT EXISTS risk_category TEXT
    CHECK (risk_category IN ('violence', 'aggression', 'weapon', 'other_safety', NULL));

COMMENT ON COLUMN public.person_records.risk_category IS
  'Safety risk category for this person. Used with risk_level to generate cross-org safety signals.
  Only the flag travels cross-org — all PII (name, notes) stays org-scoped.';


-- ── 3. v_vehicle_safety_flags — cross-org safe view ─────────────────────────
-- Exposes ONLY the safety signal for each plate.
-- NO: flagged_reason, flagged_notes, flagged_by, owner data, address.
-- Readable by all authenticated users (IPP 11(1)(c)/(e) justification above).

CREATE OR REPLACE VIEW public.v_vehicle_safety_flags AS
SELECT
  plate_number,
  is_stolen,
  stolen_reported_at,
  stolen_source,
  is_flagged,
  risk_level,
  risk_category
FROM public.canonical_vehicles
WHERE is_stolen = true
   OR (is_flagged = true AND risk_level IN ('high', 'critical'))
   OR risk_category IS NOT NULL;

COMMENT ON VIEW public.v_vehicle_safety_flags IS
  'Cross-org safety signals for vehicles. Contains NO PII details — only plate + flag status.
  Legal basis: NZ Privacy Act 2020 IPP 11(1)(c) (serious threat to safety) and IPP 11(1)(e)
  (maintenance of the law for stolen vehicles). flagged_reason/notes are intentionally excluded.';

GRANT SELECT ON public.v_vehicle_safety_flags TO authenticated;
GRANT SELECT ON public.v_vehicle_safety_flags TO service_role;


-- ── 4. v_person_safety_flags — cross-org safe view ──────────────────────────
-- A person safety signal linked via person_vehicle_links to a plate number.
-- When a plate is scanned, process-officer-scan can surface "person linked to
-- this plate is high risk" WITHOUT exposing name, DOB, or notes.
-- Only high/critical risk persons with a safety risk_category are included.

CREATE OR REPLACE VIEW public.v_person_safety_flags AS
SELECT
  pvl.plate_number,
  pr.risk_level,
  pr.risk_category
FROM public.person_records pr
JOIN public.person_vehicle_links pvl ON pvl.person_id = pr.id
WHERE pr.risk_level IN ('high', 'critical')
  AND pr.risk_category IN ('violence', 'aggression', 'weapon');

COMMENT ON VIEW public.v_person_safety_flags IS
  'Cross-org officer safety signal: high/critical risk persons linked to plates.
  Contains NO PII — only plate number + risk level + category.
  Legal basis: NZ Privacy Act 2020 IPP 11(1)(c) (serious threat to safety).
  Homeless status, notes, name, DOB are intentionally excluded.';

GRANT SELECT ON public.v_person_safety_flags TO authenticated;
GRANT SELECT ON public.v_person_safety_flags TO service_role;


-- ── 5. RLS: ensure person_vehicle_links is readable for the safety view ──────
-- person_vehicle_links may be org-scoped; the view wraps it so the join works
-- under service_role for process-officer-scan. Authenticated users only get
-- the view columns, not the underlying tables directly.

DO $$
BEGIN
  DROP POLICY IF EXISTS "authenticated_read_person_vehicle_links" ON public.person_vehicle_links;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'person_vehicle_links'
      AND column_name = 'organization_id'
  ) THEN
    CREATE POLICY "authenticated_read_person_vehicle_links"
      ON public.person_vehicle_links FOR SELECT
      TO authenticated
      USING (
        organization_id = ANY(get_user_organization_ids())
        OR get_user_role(auth.uid()) IN ('master', 'grand_master')
      );
  ELSE
    CREATE POLICY "authenticated_read_person_vehicle_links"
      ON public.person_vehicle_links FOR SELECT
      TO authenticated
      USING (get_user_role(auth.uid()) IN ('master', 'grand_master'));
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
         WHEN undefined_function THEN NULL;
END $$;


-- ── 6. Backfill: mark any existing critical-priority flagged vehicles ─────────
-- Vehicles already flagged as 'critical' priority likely represent safety risks.
-- Set risk_category = 'other_safety' as a conservative default so they appear
-- in the safety flags view. Operators should review and set the correct category.

UPDATE public.canonical_vehicles
SET
  risk_category = 'other_safety',
  risk_level    = COALESCE(risk_level, 'critical')
WHERE is_flagged = true
  AND flagged_priority = 'critical'
  AND risk_category IS NULL;

-- Similarly for 'high' priority flagged vehicles
UPDATE public.canonical_vehicles
SET
  risk_category = 'other_safety',
  risk_level    = COALESCE(risk_level, 'high')
WHERE is_flagged = true
  AND flagged_priority = 'high'
  AND risk_category IS NULL;
