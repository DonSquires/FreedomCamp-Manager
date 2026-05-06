-- Migration: Tighten Bob memory to user-owned conversation scope
-- Purpose: Ensure Bob conversation and message history is user-specific, not org-global
-- Date: 2026-05-05
-- Note: Wrapped in DO blocks so migration is idempotent and safe if tables
--       don't yet exist in the target environment.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='bob_conversations') THEN
    -- Conversations must belong to the authenticated user.
    DROP POLICY IF EXISTS "bob_conversations_insert_own_org" ON public.bob_conversations;
    DROP POLICY IF EXISTS "bob_conversations_select_own_org" ON public.bob_conversations;
    DROP POLICY IF EXISTS "bob_conversations_update_own" ON public.bob_conversations;
    DROP POLICY IF EXISTS "bob_conversations_delete_own" ON public.bob_conversations;
    DROP POLICY IF EXISTS "bob_conversations_insert_own_user_org" ON public.bob_conversations;
    DROP POLICY IF EXISTS "bob_conversations_select_own_user_org" ON public.bob_conversations;
    DROP POLICY IF EXISTS "bob_conversations_update_own_user_org" ON public.bob_conversations;
    DROP POLICY IF EXISTS "bob_conversations_delete_own_user_org" ON public.bob_conversations;

    EXECUTE $pol$
      CREATE POLICY "bob_conversations_insert_own_user_org" ON public.bob_conversations
        FOR INSERT WITH CHECK (user_id = auth.uid())
    $pol$;
    EXECUTE $pol$
      CREATE POLICY "bob_conversations_select_own_user_org" ON public.bob_conversations
        FOR SELECT USING (user_id = auth.uid())
    $pol$;
    EXECUTE $pol$
      CREATE POLICY "bob_conversations_update_own_user_org" ON public.bob_conversations
        FOR UPDATE USING (user_id = auth.uid())
    $pol$;
    EXECUTE $pol$
      CREATE POLICY "bob_conversations_delete_own_user_org" ON public.bob_conversations
        FOR DELETE USING (user_id = auth.uid())
    $pol$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='bob_messages') THEN
    -- Messages must belong to a conversation owned by the authenticated user.
    DROP POLICY IF EXISTS "bob_messages_insert_own_org" ON public.bob_messages;
    DROP POLICY IF EXISTS "bob_messages_select_own_org" ON public.bob_messages;
    DROP POLICY IF EXISTS "bob_messages_insert_own_user_org" ON public.bob_messages;
    DROP POLICY IF EXISTS "bob_messages_select_own_user_org" ON public.bob_messages;

    EXECUTE $pol$
      CREATE POLICY "bob_messages_insert_own_user_org" ON public.bob_messages
        FOR INSERT WITH CHECK (
          EXISTS (
            SELECT 1 FROM public.bob_conversations bc
            WHERE bc.conversation_id = bob_messages.conversation_id
              AND bc.user_id = auth.uid()
              AND bc.organization_id = bob_messages.organization_id
          )
        )
    $pol$;
    EXECUTE $pol$
      CREATE POLICY "bob_messages_select_own_user_org" ON public.bob_messages
        FOR SELECT USING (
          EXISTS (
            SELECT 1 FROM public.bob_conversations bc
            WHERE bc.conversation_id = bob_messages.conversation_id
              AND bc.user_id = auth.uid()
              AND bc.organization_id = bob_messages.organization_id
          )
        )
    $pol$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='bob_learning_log') THEN
    -- Learning entries should also stay user-scoped by default.
    DROP POLICY IF EXISTS "bob_learning_log_insert_own_org" ON public.bob_learning_log;
    DROP POLICY IF EXISTS "bob_learning_log_select_own_org" ON public.bob_learning_log;
    DROP POLICY IF EXISTS "bob_learning_log_insert_own_user_org" ON public.bob_learning_log;
    DROP POLICY IF EXISTS "bob_learning_log_select_own_user_org" ON public.bob_learning_log;

    EXECUTE $pol$
      CREATE POLICY "bob_learning_log_insert_own_user_org" ON public.bob_learning_log
        FOR INSERT WITH CHECK (
          EXISTS (
            SELECT 1 FROM public.bob_conversations bc
            WHERE bc.conversation_id = bob_learning_log.conversation_id
              AND bc.user_id = auth.uid()
              AND bc.organization_id = bob_learning_log.organization_id
          )
        )
    $pol$;
    EXECUTE $pol$
      CREATE POLICY "bob_learning_log_select_own_user_org" ON public.bob_learning_log
        FOR SELECT USING (
          EXISTS (
            SELECT 1 FROM public.bob_conversations bc
            WHERE bc.conversation_id = bob_learning_log.conversation_id
              AND bc.user_id = auth.uid()
              AND bc.organization_id = bob_learning_log.organization_id
          )
        )
    $pol$;
  END IF;
END $$;