-- Add after_hours_violation column to compliance_results
-- This column tracks violations that occurred outside permitted hours

ALTER TABLE public.compliance_results
  ADD COLUMN IF NOT EXISTS after_hours_violation boolean DEFAULT false;

-- Add index for quick lookups of after-hours violations
CREATE INDEX IF NOT EXISTS idx_compliance_results_after_hours 
  ON public.compliance_results(after_hours_violation) 
  WHERE after_hours_violation = true;

-- Add comment
COMMENT ON COLUMN public.compliance_results.after_hours_violation IS 
  'Indicates if the observation occurred outside the permitted hours for the zone (day-visit-only zones)';

