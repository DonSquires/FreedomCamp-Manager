-- Bob chat session memory for /api/heal conversational context routing.
-- Stores short-term history by session_id so follow-up prompts can resolve references.

CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_session_created
  ON public.chat_sessions (session_id, created_at DESC);
