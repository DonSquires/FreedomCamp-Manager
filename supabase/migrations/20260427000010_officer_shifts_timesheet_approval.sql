-- Migration: Officer Shifts – Timesheet Approval Workflow
-- Adds approval columns to officer_shifts so admins can review, approve or
-- reject an officer's recorded hours before exporting to payroll.

ALTER TABLE public.officer_shifts
  ADD COLUMN IF NOT EXISTS approval_status TEXT
    NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_by     UUID
    REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_notes     TEXT;

-- Index for fast "pending timesheets" queries by admins
CREATE INDEX IF NOT EXISTS idx_officer_shifts_approval
  ON public.officer_shifts(organization_id, approval_status, started_at DESC);

-- RLS: admins (admin / admin_officer / master) can update approval columns.
-- The policy mirrors the existing admin-read policy on this table.
CREATE POLICY "admins can update shift approval"
  ON public.officer_shifts
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'admin_officer', 'master')
        AND up.organization_id = officer_shifts.organization_id
    )
  );
