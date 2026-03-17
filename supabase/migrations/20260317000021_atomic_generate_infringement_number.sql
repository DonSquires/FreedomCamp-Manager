-- Make infringement notice number generation concurrency-safe.
-- Replaces MAX(...) + 1 logic with an atomic UPSERT counter per org/year.

CREATE TABLE IF NOT EXISTS public.infringement_notice_counters (
  organization_id uuid NOT NULL,
  year_code text NOT NULL,
  last_seq integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT infringement_notice_counters_pkey PRIMARY KEY (organization_id, year_code),
  CONSTRAINT infringement_notice_counters_last_seq_check CHECK (last_seq >= 0)
);

CREATE OR REPLACE FUNCTION public.generate_infringement_number(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_year text;
  v_seq integer;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'p_org_id is required';
  END IF;

  v_year := to_char(now(), 'YY');

  INSERT INTO public.infringement_notice_counters (organization_id, year_code, last_seq)
  VALUES (p_org_id, v_year, 1)
  ON CONFLICT (organization_id, year_code)
  DO UPDATE
    SET last_seq = public.infringement_notice_counters.last_seq + 1,
        updated_at = now()
  RETURNING last_seq INTO v_seq;

  RETURN 'INF-' || v_year || '-' || LPAD(v_seq::text, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_infringement_number(uuid) TO authenticated;
