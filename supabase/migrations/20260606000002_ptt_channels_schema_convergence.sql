-- PTT schema convergence for independent radio rollout
-- Ensures legacy ptt_channels schemas are upgraded to channel_number-based model
-- without breaking older deployments that used channel_key semantics.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'ptt_channels'
  ) THEN
    RAISE NOTICE 'ptt_channels table does not exist; skipping convergence migration.';
    RETURN;
  END IF;

  -- Core independent-radio columns expected by PTTRadio.
  ALTER TABLE public.ptt_channels ADD COLUMN IF NOT EXISTS channel_number smallint;
  ALTER TABLE public.ptt_channels ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#3b82f6';
  ALTER TABLE public.ptt_channels ADD COLUMN IF NOT EXISTS is_priority boolean NOT NULL DEFAULT false;
  ALTER TABLE public.ptt_channels ADD COLUMN IF NOT EXISTS is_encrypted boolean NOT NULL DEFAULT false;
  ALTER TABLE public.ptt_channels ADD COLUMN IF NOT EXISTS allowed_roles text[] NOT NULL DEFAULT '{}';

  -- Normalize nullable name from legacy schema.
  UPDATE public.ptt_channels
  SET name = COALESCE(NULLIF(name, ''), 'Channel')
  WHERE name IS NULL OR name = '';

  BEGIN
    ALTER TABLE public.ptt_channels ALTER COLUMN name SET NOT NULL;
  EXCEPTION WHEN others THEN
    -- Some legacy schemas may still violate this due to concurrent writes.
    RAISE NOTICE 'Could not enforce NOT NULL on ptt_channels.name yet; continuing.';
  END;

  -- Backfill channel_number from legacy channel_key patterns when possible.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ptt_channels'
      AND column_name = 'channel_key'
  ) THEN
    UPDATE public.ptt_channels
    SET channel_number = CASE
      WHEN channel_key LIKE '%:all-units' THEN 1
      WHEN channel_key LIKE '%:dispatch' THEN 2
      WHEN channel_key LIKE '%:operations' THEN 3
      WHEN channel_key LIKE '%:primary' THEN 4
      WHEN channel_key LIKE '%:secondary' THEN 5
      WHEN channel_key LIKE '%:welfare' THEN 6
      WHEN channel_key LIKE '%:admin' THEN 7
      WHEN channel_key LIKE '%:emergency' THEN 9
      ELSE channel_number
    END
    WHERE channel_number IS NULL;
  END IF;

  -- Fill remaining NULL channel numbers deterministically within each organization.
  WITH ranked AS (
    SELECT
      id,
      organization_id,
      ROW_NUMBER() OVER (
        PARTITION BY organization_id
        ORDER BY created_at NULLS LAST, id
      ) AS rn
    FROM public.ptt_channels
    WHERE channel_number IS NULL
  )
  UPDATE public.ptt_channels p
  SET channel_number = LEAST(99, ranked.rn)
  FROM ranked
  WHERE p.id = ranked.id;

  -- Reassign duplicates to available slots (1..99) within each organization.
  WITH duplicates AS (
    SELECT
      id,
      organization_id,
      channel_number,
      ROW_NUMBER() OVER (
        PARTITION BY organization_id, channel_number
        ORDER BY created_at NULLS LAST, id
      ) AS dup_rank
    FROM public.ptt_channels
    WHERE channel_number IS NOT NULL
  ),
  needs_reassign AS (
    SELECT
      id,
      organization_id,
      ROW_NUMBER() OVER (
        PARTITION BY organization_id
        ORDER BY channel_number, id
      ) AS seq
    FROM duplicates
    WHERE dup_rank > 1
  ),
  available_slots AS (
    SELECT
      org.organization_id,
      slot.channel_number,
      ROW_NUMBER() OVER (
        PARTITION BY org.organization_id
        ORDER BY slot.channel_number
      ) AS seq
    FROM (SELECT DISTINCT organization_id FROM public.ptt_channels) org
    CROSS JOIN LATERAL generate_series(1, 99) AS slot(channel_number)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.ptt_channels p
      WHERE p.organization_id = org.organization_id
        AND p.channel_number = slot.channel_number
    )
  ),
  reassignment AS (
    SELECT r.id, s.channel_number
    FROM needs_reassign r
    JOIN available_slots s
      ON s.organization_id = r.organization_id
     AND s.seq = r.seq
  )
  UPDATE public.ptt_channels p
  SET channel_number = reassignment.channel_number
  FROM reassignment
  WHERE p.id = reassignment.id;

  -- Ensure values are in valid radio range.
  UPDATE public.ptt_channels
  SET channel_number = GREATEST(1, LEAST(channel_number, 99))
  WHERE channel_number IS NOT NULL;

  -- Add constraints/indexes idempotently.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ptt_channels_channel_number_range'
      AND conrelid = 'public.ptt_channels'::regclass
  ) THEN
    ALTER TABLE public.ptt_channels
      ADD CONSTRAINT ptt_channels_channel_number_range
      CHECK (channel_number BETWEEN 1 AND 99);
  END IF;

  BEGIN
    ALTER TABLE public.ptt_channels ALTER COLUMN channel_number SET NOT NULL;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Could not enforce NOT NULL on ptt_channels.channel_number yet; continuing.';
  END;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_ptt_channels_org_channel_number
    ON public.ptt_channels (organization_id, channel_number);

  CREATE INDEX IF NOT EXISTS idx_ptt_channels_org
    ON public.ptt_channels (organization_id);
END;
$$;
