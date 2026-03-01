-- Migration: Record Access Log (Privacy Act 2020 – Principle 5)
-- Tracks who viewed sensitive records and when for mandatory privacy audits.

CREATE TABLE IF NOT EXISTS public.record_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  record_type TEXT NOT NULL,  -- e.g. 'observation', 'incident', 'vehicle', 'breach_alert'
  record_id UUID,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_record_access_log_record ON public.record_access_log(record_type, record_id);
CREATE INDEX IF NOT EXISTS idx_record_access_log_user ON public.record_access_log(user_id);
CREATE INDEX IF NOT EXISTS idx_record_access_log_org ON public.record_access_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_record_access_log_accessed_at ON public.record_access_log(accessed_at);

-- Enable RLS
ALTER TABLE public.record_access_log ENABLE ROW LEVEL SECURITY;

-- Admins and masters can read access logs for their org
CREATE POLICY "admins_read_record_access_log"
  ON public.record_access_log FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM public.user_profiles
      WHERE role IN ('admin', 'master', 'admin_officer')
        AND (organization_id = record_access_log.organization_id OR role = 'master')
    )
  );

-- Any authenticated user can insert (logging their own access)
CREATE POLICY "users_insert_record_access_log"
  ON public.record_access_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.record_access_log IS
  'Privacy Act 2020 – records who viewed each sensitive record and when, for mandatory privacy audits.';
