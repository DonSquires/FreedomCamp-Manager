-- 20260425000001_zone_legal_fields_and_seasonal.sql
--
-- Adds legal and operational metadata to zones:
--   1. land_managing_agency  – identifies which authority manages the land
--      (council | doc | linz | nzta | crown | private | other)
--      Determines which legislation applies:
--        council → Freedom Camping Act 2011 + council bylaw
--        doc     → Conservation Act 1987 / National Parks Act 1980 + FCA
--        linz    → Crown Pastoral Land Act 1998 / Land Act 1948 (LINZ-managed)
--        nzta    → Land Transport Act 1998 / NZTA bylaws
--        crown   → Crown-owned land (various acts)
--   2. bylaw_reference       – specific bylaw clause (e.g. "Freedom Camping
--      Bylaw 2024 cl 7.2") pre-fills the legal_basis field of infringement
--      notices issued in this zone.
--   3. seasonal_open_month   – 1-12; month zone opens to freedom camping (NULL = year-round)
--   4. seasonal_close_month  – 1-12; month zone closes (inclusive, NULL = year-round)
--      Example: open_month=4 close_month=10 → April–October permitted.

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS land_managing_agency TEXT
    CHECK (land_managing_agency IN ('council','doc','linz','nzta','crown','private','other')),
  ADD COLUMN IF NOT EXISTS bylaw_reference TEXT,
  ADD COLUMN IF NOT EXISTS seasonal_open_month  SMALLINT
    CHECK (seasonal_open_month  BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS seasonal_close_month SMALLINT
    CHECK (seasonal_close_month BETWEEN 1 AND 12);

COMMENT ON COLUMN public.zones.land_managing_agency IS
  'Authority managing the land: council | doc | linz | nzta | crown | private | other. '
  'LINZ = Land Information New Zealand (manages Crown land, road reserves, pastoral land). '
  'Determines applicable legislation (FCA 2011 for council/DOC, Crown Pastoral Land Act for LINZ, etc.)';

COMMENT ON COLUMN public.zones.bylaw_reference IS
  'Specific bylaw/regulation reference for infringement notices issued in this zone, '
  'e.g. "Freedom Camping Bylaw 2024 cl 7.2" or "FCA 2011 s20(1)(a)".';

COMMENT ON COLUMN public.zones.seasonal_open_month IS
  'First month (1=Jan) freedom camping is permitted in this zone. '
  'NULL means year-round. Works with seasonal_close_month.';

COMMENT ON COLUMN public.zones.seasonal_close_month IS
  'Last month (inclusive) freedom camping is permitted in this zone. '
  'NULL means year-round. E.g. open=4, close=10 means Apr–Oct.';

-- Convenience function: is_zone_seasonally_open(zone_id) → boolean
-- Returns TRUE when no seasonal restriction is set OR current NZ month is within range.
CREATE OR REPLACE FUNCTION public.is_zone_seasonally_open(p_zone_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open  SMALLINT;
  v_close SMALLINT;
  v_month SMALLINT;
BEGIN
  SELECT seasonal_open_month, seasonal_close_month
    INTO v_open, v_close
    FROM public.zones
   WHERE id = p_zone_id;

  -- No restriction → always open
  IF v_open IS NULL OR v_close IS NULL THEN
    RETURN TRUE;
  END IF;

  v_month := EXTRACT(MONTH FROM NOW() AT TIME ZONE 'Pacific/Auckland')::SMALLINT;

  -- Handle wrap-around (e.g., open=10, close=3 means Oct–Mar)
  IF v_open <= v_close THEN
    RETURN v_month BETWEEN v_open AND v_close;
  ELSE
    RETURN v_month >= v_open OR v_month <= v_close;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_zone_seasonally_open(UUID) TO authenticated;


COMMENT ON COLUMN public.zones.bylaw_reference IS
  'Specific bylaw/regulation reference for infringement notices issued in this zone, '
  'e.g. "Freedom Camping Bylaw 2024 cl 7.2" or "FCA 2011 s20(1)(a)".';

COMMENT ON COLUMN public.zones.seasonal_open_month IS
  'First month (1=Jan) freedom camping is permitted in this zone. '
  'NULL means year-round. Works with seasonal_close_month.';

COMMENT ON COLUMN public.zones.seasonal_close_month IS
  'Last month (inclusive) freedom camping is permitted in this zone. '
  'NULL means year-round. E.g. open=4, close=10 means Apr–Oct.';

-- Convenience function: is_zone_open_now(zone_id) → boolean
-- Returns TRUE when no seasonal restriction is set OR current NZ month is within range.
CREATE OR REPLACE FUNCTION public.is_zone_seasonally_open(p_zone_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open  SMALLINT;
  v_close SMALLINT;
  v_month SMALLINT;
BEGIN
  SELECT seasonal_open_month, seasonal_close_month
    INTO v_open, v_close
    FROM public.zones
   WHERE id = p_zone_id;

  -- No restriction → always open
  IF v_open IS NULL OR v_close IS NULL THEN
    RETURN TRUE;
  END IF;

  v_month := EXTRACT(MONTH FROM NOW() AT TIME ZONE 'Pacific/Auckland')::SMALLINT;

  -- Handle wrap-around (e.g., open=10, close=3 means Oct–Mar)
  IF v_open <= v_close THEN
    RETURN v_month BETWEEN v_open AND v_close;
  ELSE
    RETURN v_month >= v_open OR v_month <= v_close;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_zone_seasonally_open(UUID) TO authenticated;
