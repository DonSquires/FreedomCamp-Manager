-- Persistent Team Chat: threads, messages, read-receipts, and language preference
-- Adds: chat_threads, chat_messages, chat_read_receipts
-- Adds: preferred_language column to user_profiles

-- ────────────────────────────────────────────────────────────
-- 1.  preferred_language on user_profiles
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en-NZ';

-- ────────────────────────────────────────────────────────────
-- 2.  chat_threads
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_threads (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  thread_type      text        NOT NULL CHECK (thread_type IN ('group', 'direct', 'bob')),
  participant_ids  uuid[]      NOT NULL DEFAULT '{}',
  title            text,
  created_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  last_message_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_org
  ON public.chat_threads (organization_id);

CREATE INDEX IF NOT EXISTS idx_chat_threads_org_type
  ON public.chat_threads (organization_id, thread_type);

-- ────────────────────────────────────────────────────────────
-- 3.  chat_messages
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id         uuid        NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  organization_id   uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sender_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_name       text        NOT NULL DEFAULT '',
  sender_role       text        NOT NULL DEFAULT '',
  body              text        NOT NULL DEFAULT '',
  original_body     text,
  original_language text,
  attachments       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  is_bob_message    boolean     NOT NULL DEFAULT false,
  bob_spoken        boolean     NOT NULL DEFAULT false,
  translation_map   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created
  ON public.chat_messages (thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_messages_org_created
  ON public.chat_messages (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_sender
  ON public.chat_messages (sender_id);

-- ────────────────────────────────────────────────────────────
-- 4.  chat_read_receipts
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_read_receipts (
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id    uuid        NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_read_receipts_user
  ON public.chat_read_receipts (user_id);

-- ────────────────────────────────────────────────────────────
-- 5.  Row-Level Security
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.chat_threads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_read_receipts  ENABLE ROW LEVEL SECURITY;

-- Helper: is the calling user in the same org as the given organization_id?
-- We inline this check to avoid defining a separate function.

-- chat_threads: org members can read; org members can create
DROP POLICY IF EXISTS chat_threads_select_org  ON public.chat_threads;
CREATE POLICY chat_threads_select_org ON public.chat_threads
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid() AND is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('master', 'grand_master')
    )
  );

DROP POLICY IF EXISTS chat_threads_insert_org  ON public.chat_threads;
CREATE POLICY chat_threads_insert_org ON public.chat_threads
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid() AND is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('master', 'grand_master')
    )
  );

DROP POLICY IF EXISTS chat_threads_update_org  ON public.chat_threads;
CREATE POLICY chat_threads_update_org ON public.chat_threads
  FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_profiles
      WHERE id = auth.uid() AND is_active = true
    )
  );

-- chat_messages: org-scoped read (non-deleted), sender or Bob can insert
DROP POLICY IF EXISTS chat_messages_select_org  ON public.chat_messages;
CREATE POLICY chat_messages_select_org ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      organization_id IN (
        SELECT organization_id FROM public.user_profiles
        WHERE id = auth.uid() AND is_active = true
      )
      OR EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid()
          AND up.role IN ('master', 'grand_master')
      )
    )
  );

DROP POLICY IF EXISTS chat_messages_insert_org  ON public.chat_messages;
CREATE POLICY chat_messages_insert_org ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Normal user messages: sender must be the authenticated user
    -- Bob messages: is_bob_message=true, sender_id may be null
    (sender_id = auth.uid() OR (is_bob_message = true AND sender_id IS NULL))
    AND (
      organization_id IN (
        SELECT organization_id FROM public.user_profiles
        WHERE id = auth.uid() AND is_active = true
      )
      OR EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid()
          AND up.role IN ('master', 'grand_master')
      )
    )
  );

DROP POLICY IF EXISTS chat_messages_update_own  ON public.chat_messages;
CREATE POLICY chat_messages_update_own ON public.chat_messages
  FOR UPDATE TO authenticated
  USING (
    sender_id = auth.uid()
    OR is_bob_message = true
  );

-- chat_read_receipts: each user manages their own rows only
DROP POLICY IF EXISTS chat_read_receipts_own  ON public.chat_read_receipts;
CREATE POLICY chat_read_receipts_own ON public.chat_read_receipts
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 6.  Realtime publication for live delivery
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  END IF;
END;
$$;

-- Also publish thread last_message_at updates so sidebar refreshes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'chat_threads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_threads;
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 7.  Auto-update last_message_at on thread when message inserted
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_messages_update_thread_last_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.chat_threads
  SET last_message_at = NEW.created_at
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_messages_update_thread ON public.chat_messages;
CREATE TRIGGER trg_chat_messages_update_thread
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_messages_update_thread_last_message();
