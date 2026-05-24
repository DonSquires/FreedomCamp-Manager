import { createClient } from '@supabase/supabase-js';

type MemoryType = 'semantic' | 'episodic' | 'entity';

type BobMemoryRow = {
  content: string;
  metadata: Record<string, unknown>;
};

type BobSemanticMatch = {
  id: string;
  content: string;
  similarity: number;
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getBobContext(
  userId: string,
  sessionId: string,
  currentPromptEmbedding: number[],
) {
  const supabase = getSupabaseClient();

  const semanticQuery = Array.isArray(currentPromptEmbedding) && currentPromptEmbedding.length > 0
    ? supabase.rpc('match_memories', {
        query_embedding: currentPromptEmbedding,
        match_threshold: 0.45,
        match_count: 5,
        p_user_id: userId,
      })
    : Promise.resolve({ data: [] as BobSemanticMatch[], error: null });

  const [historyRes, semanticRes] = await Promise.all([
    supabase
      .from('bob_memory_vault')
      .select('content, metadata')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .eq('memory_type', 'episodic')
      .order('created_at', { ascending: false })
      .limit(10),
    semanticQuery,
  ]);

  if (historyRes.error) {
    throw new Error(`Failed to read episodic memory: ${historyRes.error.message}`);
  }

  if (semanticRes.error) {
    throw new Error(`Failed to read semantic memory: ${semanticRes.error.message}`);
  }

  return {
    shortTermHistory: ((historyRes.data || []) as BobMemoryRow[]).reverse(),
    longTermContext: (semanticRes.data || []) as BobSemanticMatch[],
  };
}

export async function saveNewMemoryAsync(
  userId: string,
  sessionId: string,
  text: string,
  type: Extract<MemoryType, 'episodic' | 'semantic'>,
  embedding?: number[],
  metadata: Record<string, unknown> = {},
) {
  const supabase = getSupabaseClient();

  const { error } = await supabase.from('bob_memory_vault').insert({
    user_id: userId,
    session_id: sessionId,
    memory_type: type,
    content: text,
    metadata,
    embedding: embedding || null,
  });

  if (error) {
    throw new Error(`Failed to save memory: ${error.message}`);
  }
}
