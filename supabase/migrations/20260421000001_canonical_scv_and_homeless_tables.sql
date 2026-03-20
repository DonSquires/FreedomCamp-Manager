-- ============================================================================
-- Migration: Create canonical_scv and canonical_homeless reference tables
-- ============================================================================
-- These tables provide a single canonical source of truth for:
--   1. Self-Contained Vehicle (SCV) certification status
--   2. Homeless vehicle designations
--
-- Previously this data was scattered across canonical_vehicles columns
-- (self_contained, self_contained_expiry, homeless_status, etc.) and the
-- org-scoped homeless_records table. These new tables serve as the
-- plate-level canonical reference that cleanup-and-recalculate and other
-- functions can efficiently query.
-- ============================================================================

-- ── 1. canonical_scv ─────────────────────────────────────────────────────────
-- Authoritative record of SCV certification per plate.

CREATE TABLE IF NOT EXISTS public.canonical_scv (
  plate_number       TEXT PRIMARY KEY,
  is_self_contained  BOOLEAN NOT NULL DEFAULT false,
  certificate_expiry DATE,
  source             TEXT DEFAULT 'unknown',   -- 'scv_list', 'nzscv_api', 'photo_analysis', 'manual'
  verified_at        TIMESTAMPTZ,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.canonical_scv IS
  'Canonical reference for Self-Contained Vehicle (SCV) certification status per plate number.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_canonical_scv_self_contained
  ON public.canonical_scv (is_self_contained)
  WHERE is_self_contained = true;

CREATE INDEX IF NOT EXISTS idx_canonical_scv_expiry
  ON public.canonical_scv (certificate_expiry)
  WHERE certificate_expiry IS NOT NULL;

-- Auto-update updated_at on change
CREATE OR REPLACE FUNCTION public.update_canonical_scv_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canonical_scv_updated_at ON public.canonical_scv;
CREATE TRIGGER trg_canonical_scv_updated_at
  BEFORE UPDATE ON public.canonical_scv
  FOR EACH ROW
  EXECUTE FUNCTION public.update_canonical_scv_updated_at();

-- RLS
ALTER TABLE public.canonical_scv ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "authenticated_read_canonical_scv" ON public.canonical_scv;
  CREATE POLICY "authenticated_read_canonical_scv"
    ON public.canonical_scv FOR SELECT
    TO authenticated
    USING (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "service_role_all_canonical_scv" ON public.canonical_scv;
  CREATE POLICY "service_role_all_canonical_scv"
    ON public.canonical_scv FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Backfill from canonical_vehicles
INSERT INTO public.canonical_scv (plate_number, is_self_contained, certificate_expiry, source, verified_at, created_at, updated_at)
SELECT
  cv.plate_number,
  COALESCE(cv.self_contained, false),
  cv.self_contained_expiry,
  COALESCE(cv.nzscv_source, 'canonical_backfill'),
  cv.nzscv_last_checked,
  COALESCE(cv.created_at, now()),
  COALESCE(cv.updated_at, now())
FROM public.canonical_vehicles cv
WHERE cv.self_contained = true
   OR cv.self_contained_expiry IS NOT NULL
ON CONFLICT (plate_number) DO UPDATE SET
  is_self_contained  = EXCLUDED.is_self_contained,
  certificate_expiry = EXCLUDED.certificate_expiry,
  source             = EXCLUDED.source,
  verified_at        = EXCLUDED.verified_at,
  updated_at         = now();


-- ── 2. canonical_homeless ────────────────────────────────────────────────────
-- Authoritative plate-level record of homeless vehicle designation.
-- Unlike the org-scoped homeless_records table, this is a single
-- cross-organisation canonical reference per plate.

CREATE TABLE IF NOT EXISTS public.canonical_homeless (
  plate_number   TEXT PRIMARY KEY,
  status         TEXT NOT NULL DEFAULT 'none'
                   CHECK (status IN ('confirmed', 'claimed', 'suspected', 'declined', 'none')),
  confirmed_by   UUID,
  confirmed_at   TIMESTAMPTZ,
  source         TEXT DEFAULT 'unknown',   -- 'manual', 'import', 'process-homeless-data', 'canonical_backfill'
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe FK — only create if user_profiles exists (it should, but guard for replay safety)
DO $$ BEGIN
  ALTER TABLE public.canonical_homeless
    ADD CONSTRAINT fk_canonical_homeless_confirmed_by
    FOREIGN KEY (confirmed_by) REFERENCES public.user_profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
          WHEN undefined_table THEN NULL;
END $$;

COMMENT ON TABLE public.canonical_homeless IS
  'Canonical cross-organisation reference for homeless vehicle designations per plate number.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_canonical_homeless_status
  ON public.canonical_homeless (status)
  WHERE status != 'none';

-- Auto-update updated_at on change
CREATE OR REPLACE FUNCTION public.update_canonical_homeless_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canonical_homeless_updated_at ON public.canonical_homeless;
CREATE TRIGGER trg_canonical_homeless_updated_at
  BEFORE UPDATE ON public.canonical_homeless
  FOR EACH ROW
  EXECUTE FUNCTION public.update_canonical_homeless_updated_at();

-- RLS
ALTER TABLE public.canonical_homeless ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "authenticated_read_canonical_homeless" ON public.canonical_homeless;
  CREATE POLICY "authenticated_read_canonical_homeless"
    ON public.canonical_homeless FOR SELECT
    TO authenticated
    USING (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "service_role_all_canonical_homeless" ON public.canonical_homeless;
  CREATE POLICY "service_role_all_canonical_homeless"
    ON public.canonical_homeless FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Backfill from canonical_vehicles (plate-level canonical data)
INSERT INTO public.canonical_homeless (plate_number, status, confirmed_by, confirmed_at, source, notes, created_at, updated_at)
SELECT
  cv.plate_number,
  COALESCE(cv.homeless_status, 'none'),
  cv.homeless_confirmed_by,
  cv.homeless_confirmed_at,
  'canonical_backfill',
  cv.homeless_notes,
  COALESCE(cv.created_at, now()),
  COALESCE(cv.updated_at, now())
FROM public.canonical_vehicles cv
WHERE cv.homeless_status IS NOT NULL
  AND cv.homeless_status != 'none'
ON CONFLICT (plate_number) DO UPDATE SET
  status       = EXCLUDED.status,
  confirmed_by = EXCLUDED.confirmed_by,
  confirmed_at = EXCLUDED.confirmed_at,
  notes        = EXCLUDED.notes,
  updated_at   = now();

-- Also backfill from homeless_records (org-scoped table), picking the most
-- recently updated active record per plate. This may overwrite canonical_vehicles
-- data if homeless_records has a more recent status.
INSERT INTO public.canonical_homeless (plate_number, status, source, notes, created_at, updated_at)
SELECT DISTINCT ON (hr.plate_number)
  hr.plate_number,
  hr.status,
  'homeless_records_backfill',
  hr.notes,
  hr.created_at,
  hr.updated_at
FROM public.homeless_records hr
WHERE hr.is_active = true
  AND hr.status != 'declined'
ORDER BY hr.plate_number, hr.updated_at DESC
ON CONFLICT (plate_number) DO UPDATE SET
  status     = CASE
                 -- Only upgrade status (confirmed > claimed > suspected)
                 WHEN EXCLUDED.status = 'confirmed' THEN 'confirmed'
                 WHEN public.canonical_homeless.status = 'confirmed' THEN 'confirmed'
                 WHEN EXCLUDED.status = 'claimed' THEN 'claimed'
                 WHEN public.canonical_homeless.status = 'claimed' THEN 'claimed'
                 ELSE EXCLUDED.status
               END,
  notes      = COALESCE(EXCLUDED.notes, public.canonical_homeless.notes),
  updated_at = GREATEST(EXCLUDED.updated_at, public.canonical_homeless.updated_at);


-- ── 3. Grant access ──────────────────────────────────────────────────────────
DO $$ BEGIN
  GRANT SELECT ON public.canonical_scv TO authenticated;
  GRANT ALL    ON public.canonical_scv TO service_role;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  GRANT SELECT ON public.canonical_homeless TO authenticated;
  GRANT ALL    ON public.canonical_homeless TO service_role;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
