-- ============================================================================
-- Audit Log Backward Compatibility Bridge
-- Date: 2026-04-28
-- Purpose:
--   Keep both audit contracts working:
--   - legacy: action/table_name/record_id/user_id/details
--   - current: action/entity_type/entity_id/performed_by/new_values
--
-- This prevents runtime failures in older triggers/functions that still insert
-- table_name/record_id/user_id/details while newer UI/hooks read
-- entity_type/entity_id/performed_by/new_values.
-- ============================================================================

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS table_name TEXT,
  ADD COLUMN IF NOT EXISTS record_id TEXT,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS details JSONB;

CREATE INDEX IF NOT EXISTS idx_audit_log_table_name ON public.audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_record_id ON public.audit_log(record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON public.audit_log(user_id);

-- Backfill legacy columns from current contract where possible.
UPDATE public.audit_log
SET
  table_name = COALESCE(table_name, entity_type),
  record_id = COALESCE(record_id, entity_id),
  user_id = COALESCE(user_id, performed_by),
  details = COALESCE(details, new_values)
WHERE table_name IS NULL
   OR record_id IS NULL
   OR user_id IS NULL
   OR details IS NULL;

-- Backfill current columns from legacy contract where possible.
UPDATE public.audit_log
SET
  entity_type = COALESCE(entity_type, table_name),
  entity_id = COALESCE(entity_id, record_id),
  performed_by = COALESCE(performed_by, user_id),
  new_values = COALESCE(new_values, details)
WHERE entity_type IS NULL
   OR entity_id IS NULL
   OR performed_by IS NULL
   OR new_values IS NULL;

CREATE OR REPLACE FUNCTION public.sync_audit_log_contract_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- entity/table
  IF NEW.entity_type IS NULL AND NEW.table_name IS NOT NULL THEN
    NEW.entity_type := NEW.table_name;
  ELSIF NEW.table_name IS NULL AND NEW.entity_type IS NOT NULL THEN
    NEW.table_name := NEW.entity_type;
  END IF;

  -- entity_id/record_id
  IF NEW.entity_id IS NULL AND NEW.record_id IS NOT NULL THEN
    NEW.entity_id := NEW.record_id;
  ELSIF NEW.record_id IS NULL AND NEW.entity_id IS NOT NULL THEN
    NEW.record_id := NEW.entity_id;
  END IF;

  -- performed_by/user_id
  IF NEW.performed_by IS NULL AND NEW.user_id IS NOT NULL THEN
    NEW.performed_by := NEW.user_id;
  ELSIF NEW.user_id IS NULL AND NEW.performed_by IS NOT NULL THEN
    NEW.user_id := NEW.performed_by;
  END IF;

  -- new_values/details
  IF NEW.new_values IS NULL AND NEW.details IS NOT NULL THEN
    NEW.new_values := NEW.details;
  ELSIF NEW.details IS NULL AND NEW.new_values IS NOT NULL THEN
    NEW.details := NEW.new_values;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_audit_log_contract_columns ON public.audit_log;
CREATE TRIGGER trg_sync_audit_log_contract_columns
  BEFORE INSERT OR UPDATE ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_audit_log_contract_columns();
