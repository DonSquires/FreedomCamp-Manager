-- Organization policy for Bob secure-cancel voiceprint usage.
-- Default keeps existing behavior (allowed) until an admin opts out.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS bob_voiceprint_enrollment_allowed boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.bob_voiceprint_enrollment_allowed
  IS 'When false, Bob secure-cancel voiceprint enrollment/mode is blocked for all users in the organization.';
