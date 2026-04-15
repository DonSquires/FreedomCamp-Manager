-- Bob per-user conversation continuity memory
-- Stores conversational turns so Bob can continue context across sessions/devices.

CREATE TABLE IF NOT EXISTS public.bob_conversation_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NULL REFERENCES public.organizations(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  message text NOT NULL,
  route text NOT NULL DEFAULT '/bob-assistant',
  source text NOT NULL DEFAULT 'bob-studio',
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bob_conversation_memory_user_created
  ON public.bob_conversation_memory (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bob_conversation_memory_org_created
  ON public.bob_conversation_memory (organization_id, created_at DESC);

ALTER TABLE public.bob_conversation_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bob_conversation_memory_select_own ON public.bob_conversation_memory;
CREATE POLICY bob_conversation_memory_select_own
ON public.bob_conversation_memory
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role = 'grand_master'
  )
);

DROP POLICY IF EXISTS bob_conversation_memory_insert_own ON public.bob_conversation_memory;
CREATE POLICY bob_conversation_memory_insert_own
ON public.bob_conversation_memory
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS bob_conversation_memory_delete_own ON public.bob_conversation_memory;
CREATE POLICY bob_conversation_memory_delete_own
ON public.bob_conversation_memory
FOR DELETE
TO authenticated
USING (user_id = auth.uid());
