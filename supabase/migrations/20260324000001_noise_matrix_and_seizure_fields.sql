-- Migration: 20260324000001_noise_matrix_and_seizure_fields.sql
--
-- Purpose:
--   1. Add Volume/Time/Tone matrix scoring columns to noise_assessments to
--      reflect the Noise Control Assessment Matrix used by NZ councils
--      (First Security / Timaru DC format).
--   2. Add additional receipt fields to noise_seizures to match the physical
--      "Receipt for Goods Seized" forms used by Nelson City Council and
--      Tasman District Council (issued under RMA 1991).
--   3. Expand equipment_condition CHECK constraint to include 'excellent'
--      (matching the physical form: EXCELLENT / GOOD / FAIR / POOR).

-- ── 1. noise_assessments — matrix scoring ────────────────────────────────────

ALTER TABLE noise_assessments
  ADD COLUMN IF NOT EXISTS volume_score       SMALLINT CHECK (volume_score BETWEEN 0 AND 4),
  ADD COLUMN IF NOT EXISTS time_score         SMALLINT CHECK (time_score BETWEEN 0 AND 4),
  ADD COLUMN IF NOT EXISTS tone_score         SMALLINT CHECK (tone_score BETWEEN 0 AND 2),
  ADD COLUMN IF NOT EXISTS matrix_total_score SMALLINT;

COMMENT ON COLUMN noise_assessments.volume_score IS
  '0=No Noise, 1=Barely Audible, 2=Clearly Audible, 3=Loud, 4=Extremely Loud';
COMMENT ON COLUMN noise_assessments.time_score IS
  '0 if volume=0; otherwise 1=7am-9pm, 2=9pm-midnight, 3=midnight-2am, 4=2am-7am';
COMMENT ON COLUMN noise_assessments.tone_score IS
  '0=No bass, 1=Slight bass, 2=Heavy bass';
COMMENT ON COLUMN noise_assessments.matrix_total_score IS
  'volume_score + time_score + tone_score. 0=No action, 1-4=Acceptable, 5+=Excessive';

-- ── 2. noise_seizures — receipt fields ────────────────────────────────────────

ALTER TABLE noise_seizures
  ADD COLUMN IF NOT EXISTS equipment_type        TEXT,
  ADD COLUMN IF NOT EXISTS equipment_make        TEXT,
  ADD COLUMN IF NOT EXISTS identification_marks  TEXT,
  ADD COLUMN IF NOT EXISTS owner_name            TEXT,
  ADD COLUMN IF NOT EXISTS defects_noted         TEXT,
  ADD COLUMN IF NOT EXISTS police_present        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS police_officer_name   TEXT;

COMMENT ON COLUMN noise_seizures.equipment_type IS
  'Type of equipment, e.g. "amplifier", "speakers", "DJ deck"';
COMMENT ON COLUMN noise_seizures.equipment_make IS
  'Make/brand of equipment, e.g. "Pioneer", "QSC"';
COMMENT ON COLUMN noise_seizures.identification_marks IS
  'Serial number, stickers, or other identifying marks';
COMMENT ON COLUMN noise_seizures.owner_name IS
  'Name of equipment owner if known at time of seizure';
COMMENT ON COLUMN noise_seizures.defects_noted IS
  'Any pre-existing damage or defects noted at time of seizure';
COMMENT ON COLUMN noise_seizures.police_present IS
  'Whether a police officer was present during seizure (required by some councils)';
COMMENT ON COLUMN noise_seizures.police_officer_name IS
  'Name / badge number of attending police officer';

-- ── 3. Fix equipment_condition CHECK constraint ───────────────────────────────
-- Drop the old implicit check (if the column was created with one), and re-add
-- to include 'excellent'. Supabase/PG stores column checks as unnamed constraints
-- so we drop by listing the column name pattern.

DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  SELECT constraint_name INTO v_constraint
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage cu USING (constraint_name, table_name, table_schema)
  WHERE tc.table_name = 'noise_seizures'
    AND cu.column_name = 'equipment_condition'
    AND tc.constraint_type = 'CHECK'
    AND tc.table_schema = 'public'
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE 'ALTER TABLE noise_seizures DROP CONSTRAINT ' || quote_ident(v_constraint);
  END IF;
END $$;

ALTER TABLE noise_seizures
  ADD CONSTRAINT noise_seizures_equipment_condition_check
  CHECK (equipment_condition IN ('excellent','good','fair','poor','damaged'));
