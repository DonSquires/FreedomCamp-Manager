-- ============================================================================
-- Service Agreements Compatibility: default name for legacy NOT NULL contract
-- Date: 2026-07-13
--
-- Some environments still enforce NOT NULL on public.service_agreements.name
-- from the older dispatch contract schema. C4 bridge inserts do not provide
-- name, so set a deterministic default to keep writes compatible.
-- ============================================================================

ALTER TABLE public.service_agreements
  ALTER COLUMN name SET DEFAULT 'Service Agreement';
