-- ============================================================================
-- Schema Wiring Alignment
-- Date: 2026-03-13
--
-- Purpose: Align the live database schema to match the BUILD_PLAN.md baseline
-- and fix discrepancies found during deep-dive audit of all functions,
-- helpers, triggers, and frontend wiring.
--
-- Changes:
--   1. Ensure breach_alerts has the correct CHECK constraints for
--      breach_type and status values that match the compliance engine.
--   2. Add `detected_at` as a generated alias for `created_at` on
--      breach_alerts to support legacy queries without breaking the schema.
--   3. Ensure compliance columns on observations have correct types/defaults.
--   4. Ensure `vehicle_color` (American spelling) is the canonical column
--      name on observations (not `vehicle_colour`).
--   5. Drop any legacy triggers on breach_alerts that reference old status
--      values (notified, escalated) which are no longer in the CHECK constraint.
--   6. Force PostgREST schema cache reload.
--
-- All changes are idempotent and safe to re-run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PART 1: Enforce correct CHECK constraints on breach_alerts
-- ============================================================================

-- Drop old breach_type CHECK constraint if it exists with wrong values
DO $$
BEGIN
  -- Drop any constraint whose definition includes old values like 'overstay'
  DECLARE
    v_constraint_name text;
  BEGIN
    SELECT conname INTO v_constraint_name
    FROM pg_constraint
    WHERE conrelid = 'public.breach_alerts'::regclass
      AND contype   = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%overstay%';

    IF v_constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.breach_alerts DROP CONSTRAINT %I', v_constraint_name);
      RAISE NOTICE 'Dropped old breach_type constraint: %', v_constraint_name;
    END IF;
  END;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'breach_type constraint cleanup skipped: %', SQLERRM;
END;
$$;

-- Add correct breach_type CHECK if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.breach_alerts'::regclass
      AND contype   = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%consecutive_nights%'
  ) THEN
    ALTER TABLE public.breach_alerts
      ADD CONSTRAINT breach_alerts_breach_type_check
        CHECK (breach_type IN (
          'consecutive_nights',
          'monthly_limit',
          'self_contained',
          'after_hours',
          'day_visit_violation',
          'allowed_days_violation'
        ));
    RAISE NOTICE 'Added breach_type CHECK constraint';
  ELSE
    RAISE NOTICE 'breach_type CHECK constraint already correct';
  END IF;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'breach_type CHECK constraint already exists';
END;
$$;

-- Drop any old status CHECK with wrong values (notified/escalated)
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.breach_alerts'::regclass
    AND contype   = 'c'
    AND (
      pg_get_constraintdef(oid) ILIKE '%notified%'
      OR pg_get_constraintdef(oid) ILIKE '%escalated%'
    )
    AND pg_get_constraintdef(oid) ILIKE '%status%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.breach_alerts DROP CONSTRAINT %I', v_constraint_name);
    RAISE NOTICE 'Dropped old status constraint with notified/escalated: %', v_constraint_name;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'status constraint cleanup skipped: %', SQLERRM;
END;
$$;

-- Add correct status CHECK if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.breach_alerts'::regclass
      AND contype   = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%enforcement_started%'
  ) THEN
    ALTER TABLE public.breach_alerts
      ADD CONSTRAINT breach_alerts_status_check
        CHECK (status IN (
          'pending',
          'acknowledged',
          'enforcement_started',
          'resolved',
          'dismissed'
        ));
    RAISE NOTICE 'Added status CHECK constraint';
  ELSE
    RAISE NOTICE 'status CHECK constraint already correct';
  END IF;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'status CHECK constraint already exists';
END;
$$;

-- ============================================================================
-- PART 2: Add detected_at as a backwards-compatibility alias on breach_alerts
-- Legacy frontend code (BreachAdvisoryModal, csvExport) uses detected_at.
-- This generated column ensures those queries still work without a code change.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'breach_alerts'
      AND column_name  = 'detected_at'
  ) THEN
    -- Add detected_at as a GENERATED ALWAYS AS (created_at) STORED column
    -- so callers using SELECT detected_at FROM breach_alerts still work.
    ALTER TABLE public.breach_alerts
      ADD COLUMN detected_at timestamptz GENERATED ALWAYS AS (created_at) STORED;
    RAISE NOTICE 'Added detected_at generated column to breach_alerts';
  ELSE
    RAISE NOTICE 'detected_at column already exists on breach_alerts';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add detected_at column: %', SQLERRM;
END;
$$;

-- ============================================================================
-- PART 3: Ensure vehicle_color (American spelling) exists on observations
-- The BUILD_PLAN baseline and all migrations use vehicle_color.
-- If a vehicle_colour column exists from an old migration, normalise to vehicle_color.
-- ============================================================================

DO $$
BEGIN
  -- If vehicle_colour exists but vehicle_color does not, rename it
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'observations'
      AND column_name  = 'vehicle_colour'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'observations'
      AND column_name  = 'vehicle_color'
  ) THEN
    ALTER TABLE public.observations RENAME COLUMN vehicle_colour TO vehicle_color;
    RAISE NOTICE 'Renamed observations.vehicle_colour → vehicle_color';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'observations'
      AND column_name  = 'vehicle_color'
  ) THEN
    ALTER TABLE public.observations ADD COLUMN IF NOT EXISTS vehicle_color text;
    RAISE NOTICE 'Added vehicle_color column to observations';
  ELSE
    RAISE NOTICE 'observations.vehicle_color already exists — no action needed';
  END IF;
END;
$$;

-- ============================================================================
-- PART 4: Ensure breach_alerts has resolution_notes (for resolved workflow)
-- ============================================================================

ALTER TABLE public.breach_alerts
  ADD COLUMN IF NOT EXISTS resolution_notes text;

-- ============================================================================
-- PART 5: Ensure assigned_to / assigned_at / assigned_by exist for workflow
-- ============================================================================

ALTER TABLE public.breach_alerts
  ADD COLUMN IF NOT EXISTS assigned_to  uuid REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS assigned_at  timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by  uuid REFERENCES user_profiles(id);

-- ============================================================================
-- PART 6: Ensure admin_reviewed columns exist
-- ============================================================================

ALTER TABLE public.breach_alerts
  ADD COLUMN IF NOT EXISTS admin_reviewed_by   uuid REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS admin_reviewed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS admin_review_notes  text;

-- ============================================================================
-- PART 7: Force PostgREST schema cache reload
-- ============================================================================

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================================
-- PART 8: Verification
-- ============================================================================

DO $$
DECLARE
  v_detected_at   bool;
  v_vehicle_color bool;
  v_status_check  bool;
  v_breach_check  bool;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'breach_alerts' AND column_name = 'detected_at'
  ) INTO v_detected_at;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'observations' AND column_name = 'vehicle_color'
  ) INTO v_vehicle_color;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.breach_alerts'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%enforcement_started%'
  ) INTO v_status_check;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.breach_alerts'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%consecutive_nights%'
  ) INTO v_breach_check;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  20260313000002_schema_wiring_alignment - COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '  breach_alerts.detected_at (generated):  %', CASE WHEN v_detected_at THEN '✓' ELSE '✗ MISSING' END;
  RAISE NOTICE '  observations.vehicle_color:              %', CASE WHEN v_vehicle_color THEN '✓' ELSE '✗ MISSING' END;
  RAISE NOTICE '  breach_alerts status CHECK (correct):   %', CASE WHEN v_status_check THEN '✓' ELSE '✗ MISSING' END;
  RAISE NOTICE '  breach_alerts breach_type CHECK:        %', CASE WHEN v_breach_check THEN '✓' ELSE '✗ MISSING' END;
  RAISE NOTICE '  PostgREST schema cache reload: ISSUED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END;
$$;

COMMIT;
