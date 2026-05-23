-- Migration: Add Bob conversation memory tables
-- Purpose: Enable persistent conversation history, message storage, and learning logs
-- Date: 2026-04-30

-- ============================================================================
-- Bob Conversations Table
-- ============================================================================
-- Stores conversation metadata (threads between user and Bob)
CREATE TABLE IF NOT EXISTS public.bob_conversations (
  conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  organization_id UUID REFERENCES public.organizations NOT NULL,
  title TEXT NOT NULL,
  summary TEXT, -- optional summary of conversation purpose
  tags TEXT[], -- tags for categorization (e.g., ['bug-triage', 'feature-design'])
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bob_conversations_user_org
  ON public.bob_conversations(user_id, organization_id DESC);
CREATE INDEX IF NOT EXISTS idx_bob_conversations_created_at
  ON public.bob_conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bob_conversations_archived
  ON public.bob_conversations(is_archived, updated_at DESC);

-- ============================================================================
-- Bob Messages Table
-- ============================================================================
-- Stores individual messages in the conversation thread
CREATE TABLE IF NOT EXISTS public.bob_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.bob_conversations ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  
  -- Metadata: model, provider, performance metrics
  metadata JSONB DEFAULT '{}'::jsonb,
  -- {
  --   "model": "qwen2.5:7b",
  --   "provider": "runpod-serverless-ollama" | "openai" | "ollama-local",
  --   "confidence": 0.85,
  --   "sources": ["src/types/database.ts", "supabase/migrations/..."],
  --   "tokens_input": 245,
  --   "tokens_output": 198,
  --   "latency_ms": 1250,
  --   "temperature": 0.2,
  --   "system_prompt_version": "20260430-v1"
  -- }
  
  -- Organization & user context
  organization_id UUID REFERENCES public.organizations NOT NULL,
  user_id UUID REFERENCES auth.users, -- NULL for system messages
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT bob_messages_org_match CHECK (organization_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_bob_messages_conversation
  ON public.bob_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_bob_messages_org
  ON public.bob_messages(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bob_messages_role
  ON public.bob_messages(role, created_at DESC);

-- ============================================================================
-- Bob Learning Log Table
-- ============================================================================
-- Tracks response quality scores and lessons learned
CREATE TABLE IF NOT EXISTS public.bob_learning_log (
  entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.bob_conversations ON DELETE CASCADE NOT NULL,
  message_id UUID REFERENCES public.bob_messages ON DELETE CASCADE NOT NULL,
  
  -- Score and feedback
  score NUMERIC NOT NULL CHECK (score >= 0 AND score <= 1),
  -- 0.0 = complete failure
  -- 0.5 = partially successful, needed revision
  -- 1.0 = completely successful on first try
  
  feedback TEXT, -- Why was this scored? What could improve?
  
  -- Lesson categorization
  lesson_key TEXT NOT NULL,
  -- Examples: 'hallucination_invented_file', 'stale_api_reference',
  --          'incomplete_solution', 'correct_first_time', 'self_healed',
  --          'accurate_schema_reference', 'good_context_retention'
  lesson_detail JSONB DEFAULT '{}'::jsonb,
  -- {
  --   "pattern": "Reference to non-existent table",
  --   "root_cause": "Schema context out of date",
  --   "how_fixed": "Forced schema refresh before response",
  --   "prevention": "Always query LIVE_SCHEMA.md before table claims"
  -- }
  
  -- Metadata
  organization_id UUID REFERENCES public.organizations NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bob_learning_log_conversation
  ON public.bob_learning_log(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bob_learning_log_message
  ON public.bob_learning_log(message_id);
CREATE INDEX IF NOT EXISTS idx_bob_learning_log_lesson
  ON public.bob_learning_log(lesson_key, score DESC);
CREATE INDEX IF NOT EXISTS idx_bob_learning_log_org
  ON public.bob_learning_log(organization_id, created_at DESC);

-- ============================================================================
-- RLS Policies: Conversations
-- ============================================================================
ALTER TABLE public.bob_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bob_conversations_insert_own_org" ON public.bob_conversations
  FOR INSERT WITH CHECK (
    organization_id = ANY(get_user_organization_ids())
  );

CREATE POLICY "bob_conversations_select_own_org" ON public.bob_conversations
  FOR SELECT USING (
    organization_id = ANY(get_user_organization_ids())
  );

CREATE POLICY "bob_conversations_update_own" ON public.bob_conversations
  FOR UPDATE USING (
    user_id = auth.uid() AND organization_id = ANY(get_user_organization_ids())
  );

CREATE POLICY "bob_conversations_delete_own" ON public.bob_conversations
  FOR DELETE USING (
    user_id = auth.uid() AND organization_id = ANY(get_user_organization_ids())
  );

-- ============================================================================
-- RLS Policies: Messages
-- ============================================================================
ALTER TABLE public.bob_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bob_messages_insert_own_org" ON public.bob_messages
  FOR INSERT WITH CHECK (
    organization_id = ANY(get_user_organization_ids())
  );

CREATE POLICY "bob_messages_select_own_org" ON public.bob_messages
  FOR SELECT USING (
    organization_id = ANY(get_user_organization_ids())
  );

-- ============================================================================
-- RLS Policies: Learning Log
-- ============================================================================
ALTER TABLE public.bob_learning_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bob_learning_log_insert_own_org" ON public.bob_learning_log
  FOR INSERT WITH CHECK (
    organization_id = ANY(get_user_organization_ids())
  );

CREATE POLICY "bob_learning_log_select_own_org" ON public.bob_learning_log
  FOR SELECT USING (
    organization_id = ANY(get_user_organization_ids())
  );

-- Admins can see learning patterns for all messages
CREATE POLICY "bob_learning_log_select_admin" ON public.bob_learning_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('admin', 'master', 'grand_master', 'admin_officer')
        AND up.organization_id = ANY(get_user_organization_ids())
    )
  );

-- ============================================================================
-- Trigger: Update bob_conversations.updated_at on message insert
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bob_conversations_touch_on_message()
  RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.bob_conversations
  SET updated_at = now()
  WHERE conversation_id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER bob_conversations_touch_on_message
  AFTER INSERT ON public.bob_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.bob_conversations_touch_on_message();

-- ============================================================================
-- Function: Get conversation context (for Bob system prompt)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_bob_conversation_context(
  p_conversation_id UUID,
  p_limit INT DEFAULT 10
)
  RETURNS TABLE (
    message_role TEXT,
    message_content TEXT,
    message_order INT
  ) AS $$
BEGIN
  RETURN QUERY
  SELECT
    bm.role,
    bm.content,
    ROW_NUMBER() OVER (ORDER BY bm.created_at ASC) AS message_order
  FROM public.bob_messages bm
  WHERE bm.conversation_id = p_conversation_id
    AND bm.organization_id = (
      SELECT organization_id FROM public.bob_conversations
      WHERE conversation_id = p_conversation_id
    )
  ORDER BY bm.created_at ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================================
-- Function: Summarize lesson patterns (for Dr Bob review)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_bob_lesson_summary(
  p_organization_id UUID,
  p_hours INT DEFAULT 24
)
  RETURNS TABLE (
    lesson_key TEXT,
    count INT,
    average_score NUMERIC,
    sample_feedback TEXT
  ) AS $$
BEGIN
  RETURN QUERY
  SELECT
    bll.lesson_key,
    COUNT(*) AS count,
    AVG(bll.score) AS average_score,
    (ARRAY_AGG(bll.feedback ORDER BY bll.created_at DESC) FILTER (WHERE bll.feedback IS NOT NULL))[1] AS sample_feedback
  FROM public.bob_learning_log bll
  WHERE bll.organization_id = p_organization_id
    AND bll.created_at > now() - (p_hours || ' hours')::INTERVAL
  GROUP BY bll.lesson_key
  ORDER BY average_score ASC, count DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
