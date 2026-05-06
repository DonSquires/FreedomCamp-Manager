-- =============================================================================
-- Fix: public_noise_complaints security hardening (B-13)
--
-- 1. Make generate_noise_complaint_reference() SECURITY DEFINER so it runs
--    as the function owner rather than the calling anon role.  This means
--    anon no longer needs direct INSERT/UPDATE/SELECT grants on the counters
--    table — the function handles that internally.
--
-- 2. Revoke the broad grants on the counter table from anon.
--    Anon still gets INSERT on public_noise_complaints (needed to submit).
-- =============================================================================

-- Re-create function as SECURITY DEFINER (owner executes the counter write)
CREATE OR REPLACE FUNCTION public.generate_noise_complaint_reference()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year   INTEGER := EXTRACT(YEAR FROM NOW())::INTEGER;
  v_seq    INTEGER;
BEGIN
  INSERT INTO public.public_noise_complaint_counters(year, next_seq)
    VALUES (v_year, 2)
    ON CONFLICT (year) DO UPDATE
      SET next_seq = public_noise_complaint_counters.next_seq + 1
    RETURNING next_seq - 1 INTO v_seq;
  RETURN 'NCC-' || v_year || '-' || LPAD(v_seq::TEXT, 6, '0');
END;
$$;

-- Revoke direct counter table access from anon — function handles it now
REVOKE ALL ON public.public_noise_complaint_counters FROM anon;

-- Anon still needs INSERT on complaints (to submit) + SELECT (to check status by ref)
-- These are already granted in the previous migration; confirm they are correct.
GRANT INSERT, SELECT ON public.public_noise_complaints TO anon;
