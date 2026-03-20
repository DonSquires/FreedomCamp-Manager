-- Ensure zone legal/governance columns exist and force PostgREST schema cache reload.
-- This migration is idempotent and safe to run in environments with partial drift.

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS land_manager TEXT,
  ADD COLUMN IF NOT EXISTS enforcement_authority TEXT,
  ADD COLUMN IF NOT EXISTS bylaw_clause TEXT,
  ADD COLUMN IF NOT EXISTS bylaw_source_url TEXT;

COMMENT ON COLUMN public.zones.land_manager IS
  'Land manager for governance context (e.g., Council, DOC, LINZ, NZTA, Private).';
COMMENT ON COLUMN public.zones.enforcement_authority IS
  'Organization/agency authorized to enforce in this zone.';
COMMENT ON COLUMN public.zones.bylaw_clause IS
  'Specific bylaw clause used in legal evidence and notices.';
COMMENT ON COLUMN public.zones.bylaw_source_url IS
  'Reference URL for bylaw source document.';

-- Refresh schema cache so PostgREST immediately recognizes these columns.
NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');
