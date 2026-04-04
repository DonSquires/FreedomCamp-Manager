-- Bob long-term learning memory
-- Cross-device durable memory for Bob Assistant conversations.

CREATE TABLE IF NOT EXISTS public.bob_learning_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NULL REFERENCES public.organizations(id) ON DELETE SET NULL,
  route text NOT NULL DEFAULT '/bob-assistant',
  source text NOT NULL DEFAULT 'bob-studio',
  topic text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  user_intent text NOT NULL,
  assistant_outcome text NOT NULL,
  use_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bob_learning_memory_user_last_used
  ON public.bob_learning_memory (user_id, last_used_at DESC);

CREATE INDEX IF NOT EXISTS idx_bob_learning_memory_org_last_used
  ON public.bob_learning_memory (organization_id, last_used_at DESC);

CREATE INDEX IF NOT EXISTS idx_bob_learning_memory_tags
  ON public.bob_learning_memory USING gin (tags);

ALTER TABLE public.bob_learning_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bob_learning_memory_select_own ON public.bob_learning_memory;
CREATE POLICY bob_learning_memory_select_own
ON public.bob_learning_memory
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

DROP POLICY IF EXISTS bob_learning_memory_insert_own ON public.bob_learning_memory;
CREATE POLICY bob_learning_memory_insert_own
ON public.bob_learning_memory
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS bob_learning_memory_update_own ON public.bob_learning_memory;
CREATE POLICY bob_learning_memory_update_own
ON public.bob_learning_memory
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS bob_learning_memory_delete_own ON public.bob_learning_memory;
CREATE POLICY bob_learning_memory_delete_own
ON public.bob_learning_memory
FOR DELETE
TO authenticated
USING (user_id = auth.uid());
