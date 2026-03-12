-- Remove exact duplicate observations while preserving one canonical row.
--
-- Strategy:
-- 1) Detect duplicate rows by core evidence fields (excluding row identity).
-- 2) Keep the strongest row per duplicate set (prefers notes/photo, then earliest).
-- 3) Re-point known FK references to the kept row.
-- 4) Delete duplicate rows.

DO $$
DECLARE
  v_id_col text;
  v_photo_expr text;
  v_where_clause text := '';
  v_duplicate_rows integer := 0;
  v_deleted_rows integer := 0;
BEGIN
  -- Resolve identity column across schema variants.
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'observations' AND column_name = 'id'
    ) THEN 'id'
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'observations' AND column_name = 'observation_id'
    ) THEN 'observation_id'
    ELSE NULL
  END INTO v_id_col;

  IF v_id_col IS NULL THEN
    RAISE EXCEPTION 'Could not find observations identity column (id|observation_id)';
  END IF;

  -- Resolve photo column across schema variants.
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'observations' AND column_name = 'photo_url'
    ) THEN 'photo_url'
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'observations' AND column_name = 'image_url'
    ) THEN 'image_url'
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'observations' AND column_name = 'photo'
    ) THEN 'photo'
    ELSE 'NULL::text'
  END INTO v_photo_expr;

  -- Only dedupe active rows when soft-delete column exists.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'observations' AND column_name = 'deleted_at'
  ) THEN
    v_where_clause := 'WHERE deleted_at IS NULL';
  END IF;

  -- Build duplicate map.
  EXECUTE format(
    $sql$
    CREATE TEMP TABLE tmp_obs_exact_dupes ON COMMIT DROP AS
    WITH ranked AS (
      SELECT
        %1$I AS row_id,
        FIRST_VALUE(%1$I) OVER (
          PARTITION BY
            plate_number,
            recorded_at,
            zone_id,
            organization_id,
            gps_latitude,
            gps_longitude,
            COALESCE(%2$s::text, ''),
            COALESCE(officer_notes, ''),
            COALESCE(is_compliant::text, '')
          ORDER BY
            CASE WHEN NULLIF(TRIM(COALESCE(officer_notes, '')), '') IS NOT NULL THEN 1 ELSE 0 END DESC,
            CASE WHEN NULLIF(TRIM(COALESCE(%2$s::text, '')), '') IS NOT NULL THEN 1 ELSE 0 END DESC,
            COALESCE(created_at, recorded_at) ASC,
            %1$I ASC
        ) AS keep_id,
        ROW_NUMBER() OVER (
          PARTITION BY
            plate_number,
            recorded_at,
            zone_id,
            organization_id,
            gps_latitude,
            gps_longitude,
            COALESCE(%2$s::text, ''),
            COALESCE(officer_notes, ''),
            COALESCE(is_compliant::text, '')
          ORDER BY
            CASE WHEN NULLIF(TRIM(COALESCE(officer_notes, '')), '') IS NOT NULL THEN 1 ELSE 0 END DESC,
            CASE WHEN NULLIF(TRIM(COALESCE(%2$s::text, '')), '') IS NOT NULL THEN 1 ELSE 0 END DESC,
            COALESCE(created_at, recorded_at) ASC,
            %1$I ASC
        ) AS rn
      FROM public.observations
      %3$s
    )
    SELECT row_id AS delete_id, keep_id
    FROM ranked
    WHERE rn > 1
      AND row_id <> keep_id;
    $sql$,
    v_id_col,
    v_photo_expr,
    v_where_clause
  );

  SELECT COUNT(*) INTO v_duplicate_rows FROM tmp_obs_exact_dupes;

  IF v_duplicate_rows = 0 THEN
    RAISE NOTICE 'No exact duplicate observations found.';
    RETURN;
  END IF;

  -- Re-point known references before deletion.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'breach_alerts' AND column_name = 'observation_id'
  ) THEN
    UPDATE public.breach_alerts b
    SET observation_id = d.keep_id
    FROM tmp_obs_exact_dupes d
    WHERE b.observation_id = d.delete_id
      AND b.observation_id <> d.keep_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'enforcement_cases' AND column_name = 'observation_id'
  ) THEN
    UPDATE public.enforcement_cases e
    SET observation_id = d.keep_id
    FROM tmp_obs_exact_dupes d
    WHERE e.observation_id = d.delete_id
      AND e.observation_id <> d.keep_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'infringement_notices' AND column_name = 'observation_id'
  ) THEN
    UPDATE public.infringement_notices i
    SET observation_id = d.keep_id
    FROM tmp_obs_exact_dupes d
    WHERE i.observation_id = d.delete_id
      AND i.observation_id <> d.keep_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'observation_jobs' AND column_name = 'observation_id'
  ) THEN
    UPDATE public.observation_jobs j
    SET observation_id = d.keep_id
    FROM tmp_obs_exact_dupes d
    WHERE j.observation_id = d.delete_id
      AND j.observation_id <> d.keep_id;
  END IF;

  -- Delete duplicate rows.
  EXECUTE format(
    'DELETE FROM public.observations o USING tmp_obs_exact_dupes d WHERE o.%1$I = d.delete_id',
    v_id_col
  );

  GET DIAGNOSTICS v_deleted_rows = ROW_COUNT;

  RAISE NOTICE 'Exact duplicates removed: %', v_deleted_rows;
END;
$$;
