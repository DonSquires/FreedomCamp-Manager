-- Add configurable overnight stay verification mode per organization.
-- This supports strict two-photo verification and LINZ-style one-photo-per-day
-- verification using inference/GPS same-location checks.

ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS overnight_verification_mode text NOT NULL DEFAULT 'two_photo_verification';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organizations_overnight_verification_mode_check'
  ) THEN
    ALTER TABLE public.organizations
    ADD CONSTRAINT organizations_overnight_verification_mode_check
    CHECK (
      overnight_verification_mode IN (
        'two_photo_verification',
        'one_photo_per_day_inference'
      )
    );
  END IF;
END $$;

COMMENT ON COLUMN public.organizations.overnight_verification_mode IS
'Overnight enforcement evidence policy: two_photo_verification requires day-1 and day-2 evidence in same location; one_photo_per_day_inference allows one scan per day with inference/GPS same-location verification.';
