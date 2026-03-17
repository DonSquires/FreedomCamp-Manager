-- Restore notice number RPC used by generate-infringement edge function.
-- Idempotent: safe to apply if function already exists.

CREATE OR REPLACE FUNCTION public.generate_infringement_number(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_year text;
  v_seq integer;
BEGIN
  v_year := to_char(now(), 'YY');

  SELECT COALESCE(
           MAX(
             CAST(
               NULLIF(regexp_replace(notice_number, '[^0-9]', '', 'g'), '')
               AS integer
             )
           ),
           0
         ) + 1
    INTO v_seq
    FROM public.infringement_notices
   WHERE organization_id = p_org_id
     AND notice_number LIKE 'INF-' || v_year || '-%';

  RETURN 'INF-' || v_year || '-' || LPAD(v_seq::text, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_infringement_number(uuid) TO authenticated;
