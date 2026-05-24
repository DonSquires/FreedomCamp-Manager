import { createClient } from '@supabase/supabase-js';
import { createOpenAI } from '@ai-sdk/openai';
import { stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';

export type BobEngineEnv = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  runpodBaseUrl: string;
  runpodApiKey: string;
  model: string;
  orgId?: string;
  bobSystemUserId?: string;
};

const bobEngineEnvSchema = z.object({
  supabaseUrl: z.string().url(),
  supabaseServiceRoleKey: z.string().min(20),
  runpodBaseUrl: z.string().url(),
  runpodApiKey: z.string().min(8),
  model: z.string().min(1).default('qwen2.5:7b'),
  orgId: z.string().optional(),
  bobSystemUserId: z.string().uuid().optional(),
});

export function resolveBobEngineEnv(input: Partial<BobEngineEnv> & Record<string, unknown>): BobEngineEnv {
  const runpodCandidate = String(
    input.runpodBaseUrl ||
    input.RUNPOD_VLLM_ENDPOINT_URL ||
    input.INFERENCE_SERVICE_URL ||
    input.BOB_SERVICE_URL ||
    '',
  ).trim();

  const normalizedRunpodBase = runpodCandidate
    .replace(/\/(runsync|run|run-sync|status\/.*)$/i, '')
    .replace(/\/+$/, '');

  const parsed = bobEngineEnvSchema.parse({
    supabaseUrl: String(input.supabaseUrl || input.SUPABASE_URL || input.VITE_SUPABASE_URL || '').trim(),
    supabaseServiceRoleKey: String(input.supabaseServiceRoleKey || input.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
    runpodBaseUrl: normalizedRunpodBase,
    runpodApiKey: String(input.runpodApiKey || input.RUNPOD_API_KEY || input.RUNPOD_ENDPOINT_API_KEY || input.DR_BOB_API || '').trim(),
    model: String(input.model || input.RUNPOD_OLLAMA_MODEL || input.OLLAMA_MODEL || 'qwen2.5:7b').trim(),
    orgId: String(input.orgId || input.BOB_ORG_ID || input.ORG_ID || input.DEFAULT_ORG_ID || '').trim() || undefined,
    bobSystemUserId: String(input.bobSystemUserId || input.BOB_SYSTEM_USER_ID || '').trim() || undefined,
  }) as BobEngineEnv;

  return parsed;
}

export type RunBobAgentLoopInput = {
  userId: string;
  sessionId: string;
  userPrompt: string;
  queryEmbedding?: number[];
};

type BobLedgerRow = {
  session_id: string;
  user_id: string;
  record_type: 'short_term' | 'long_term' | 'transaction_step';
  content: string;
  status?: 'queued' | 'running' | 'success' | 'failed';
  metadata?: Record<string, unknown>;
  embedding?: number[] | null;
  operator_id?: string;
  organization_id?: string | null;
};

export function isMissingOrganizationIdError(error: { message?: string | null } | null | undefined) {
  return String(error?.message || '').toLowerCase().includes('organization_id');
}

export async function fetchLedgerHistoryWithFallback(
  supabase: { from: (table: string) => any },
  params: { sessionId: string; userId: string; orgId?: string; limit?: number },
) {
  const limit = params.limit ?? 6;

  const runQuery = async (includeOrganization: boolean) => {
    let query = supabase
      .from('bob_system_ledger')
      .select('content')
      .eq('session_id', params.sessionId)
      .eq('user_id', params.userId)
      .eq('record_type', 'short_term');

    if (includeOrganization && params.orgId) {
      query = query.eq('organization_id', params.orgId);
    }

    return query.order('created_at', { ascending: false }).limit(limit);
  };

  const primary = await runQuery(true);
  if (!primary.error) return primary;
  if (!params.orgId || !isMissingOrganizationIdError(primary.error)) return primary;
  return runQuery(false);
}

export async function insertLedgerRowWithFallback(
  supabase: { from: (table: string) => any },
  row: BobLedgerRow,
) {
  const primary = await supabase.from('bob_system_ledger').insert(row);
  if (!primary.error) return primary;
  if (!row.organization_id || !isMissingOrganizationIdError(primary.error)) return primary;

  const fallbackRow = { ...row };
  delete fallbackRow.organization_id;
  return supabase.from('bob_system_ledger').insert(fallbackRow);
}

export function buildShortTermHistory(rows: Array<{ content?: string | null }> | null | undefined) {
  return (rows || [])
    .map((row) => String(row?.content || '').trim())
    .filter(Boolean)
    .reverse()
    .join('\n');
}

export function createBobEngine(envInput: Partial<BobEngineEnv> & Record<string, unknown>) {
  const env = resolveBobEngineEnv(envInput);

  const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: env.orgId ? { 'x-org-id': env.orgId } : {},
    },
  });

  const provider = createOpenAI({
    baseURL: `${env.runpodBaseUrl}/v1`,
    apiKey: env.runpodApiKey,
  });

  const persistStep = async (
    payload: {
      session_id: string;
      user_id: string;
      record_type: 'short_term' | 'long_term' | 'transaction_step';
      content: string;
      status?: 'queued' | 'running' | 'success' | 'failed';
      metadata?: Record<string, unknown>;
      embedding?: number[] | null;
      operator_id?: string;
    },
  ) => {
    const row = {
      ...payload,
      operator_id: payload.operator_id || env.bobSystemUserId || payload.user_id,
      organization_id: env.orgId || null,
    };

    const { error } = await insertLedgerRowWithFallback(supabase, row);
    if (error) throw new Error(`Failed to persist ledger event: ${error.message}`);
  };

  async function runBobAgentLoop(input: RunBobAgentLoopInput) {
    const embedding = Array.isArray(input.queryEmbedding) && input.queryEmbedding.length === 1536
      ? input.queryEmbedding
      : new Array(1536).fill(0);

    const [historyRes, contextRes] = await Promise.all([
      fetchLedgerHistoryWithFallback(supabase, {
        sessionId: input.sessionId,
        userId: input.userId,
        orgId: env.orgId,
        limit: 6,
      }),
      supabase.rpc('match_bob_memories', {
        query_embedding: embedding,
        match_threshold: 0.45,
        match_count: 3,
        p_user_id: input.userId,
      }),
    ]);

    if (historyRes.error) throw new Error(`History lookup failed: ${historyRes.error.message}`);
    if (contextRes.error) throw new Error(`Context lookup failed: ${contextRes.error.message}`);

    const shortTerm = buildShortTermHistory(historyRes.data || []);
    const longTerm = (contextRes.data || []).map((row: { content: string }) => row.content).join('\n');

    return streamText({
      model: provider(env.model),
      system: [
        'You are Bob, an autonomous application assistant.',
        'Use concise operational language and execute with tools when needed.',
        `Long-term context:\n${longTerm || 'none'}`,
        `Short-term history:\n${shortTerm || 'none'}`,
      ].join('\n\n'),
      prompt: input.userPrompt,
      tools: {
        navigateApp: tool({
          description: 'Navigates the user to a target application view.',
          inputSchema: z.object({
            targetRoute: z.enum([
              '/dashboard',
              '/admin/dashboard',
              '/patrols',
              '/enforcement',
              '/vehicles',
              '/zones',
              '/compliance',
              '/breaches',
              '/users',
              '/organizations',
              '/incidents',
              '/evidence-packages',
              '/compliance-escalations',
              '/alarm-events',
              '/occupancy-analytics',
              '/patrol-route-optimiser',
              '/fixed-cameras',
              '/patrol-navigation',
              '/data',
              '/access-control',
              '/platform',
              '/client-portal',
              '/billing',
              '/compliance-analytics',
              '/analytics',
              '/settings',
            ]),
          }),
          execute: async ({ targetRoute }) => {
            const normalizedRoute = targetRoute === '/analytics' ? '/compliance-analytics' : targetRoute

            await persistStep({
              session_id: input.sessionId,
              user_id: input.userId,
              operator_id: env.bobSystemUserId || input.userId,
              record_type: 'transaction_step',
              content: `Navigated to ${normalizedRoute}`,
              status: 'success',
              metadata: {
                route: normalizedRoute,
                requestedRoute: targetRoute,
                orgId: env.orgId || null,
              },
            });

            return { status: 'success', active_route: normalizedRoute };
          },
        }),
      },
      stopWhen: stepCountIs(5),
      onFinish: async ({ text }) => {
        await persistStep({
          session_id: input.sessionId,
          user_id: input.userId,
          operator_id: env.bobSystemUserId || input.userId,
          record_type: 'short_term',
          content: `User: ${input.userPrompt} | Bob: ${text}`,
          status: 'success',
          metadata: {
            provider: 'runpod-openai-compatible',
            model: env.model,
            orgId: env.orgId || null,
          },
        });
      },
    });
  }

  return {
    runBobAgentLoop,
  };
}
