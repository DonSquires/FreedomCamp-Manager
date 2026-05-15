const { randomUUID } = require('crypto');

const LEDGER_TABLE = 'bob_system_ledger';
const MATCH_RPC = 'match_bob_memories';

function resolveSupabaseConfig() {
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required for Bob ledger operations.');
  }

  return { supabaseUrl, serviceRoleKey };
}

function buildSupabaseHeaders(serviceRoleKey, extra = {}) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function fetchShortTermHistory({ supabaseUrl, serviceRoleKey, userId, sessionId, limit = 6 }) {
  const params = new URLSearchParams({
    select: 'content,created_at',
    user_id: `eq.${userId}`,
    session_id: `eq.${sessionId}`,
    record_type: 'eq.short_term',
    order: 'created_at.desc',
    limit: String(limit),
  });

  const res = await fetch(`${supabaseUrl}/rest/v1/${LEDGER_TABLE}?${params.toString()}`, {
    method: 'GET',
    headers: buildSupabaseHeaders(serviceRoleKey),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Short-term history lookup failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return Array.isArray(data) ? data : [];
}

async function matchLongTermContext({ supabaseUrl, serviceRoleKey, userId, queryEmbedding, threshold = 0.7, count = 3 }) {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${MATCH_RPC}`, {
    method: 'POST',
    headers: buildSupabaseHeaders(serviceRoleKey),
    body: JSON.stringify({
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: count,
      p_user_id: userId,
    }),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Long-term context lookup failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return Array.isArray(data) ? data : [];
}

async function insertLedgerRecord({ supabaseUrl, serviceRoleKey, row }) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${LEDGER_TABLE}`, {
    method: 'POST',
    headers: buildSupabaseHeaders(serviceRoleKey, { Prefer: 'return=representation' }),
    body: JSON.stringify(row),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Ledger insert failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

function coerceEmbedding(value) {
  if (!Array.isArray(value)) return new Array(1536).fill(0);
  if (value.length !== 1536) return new Array(1536).fill(0);
  return value.map((entry) => Number(entry) || 0);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function resolveOperatorId({ requestedOperatorId, userId }) {
  const explicit = String(requestedOperatorId || '').trim();
  if (isUuid(explicit)) return explicit;

  const configured = String(
    process.env.BOB_SYSTEM_USER_ID ||
    process.env.BOB_SYSTEM_ACCOUNT_USER_ID ||
    '',
  ).trim();

  if (isUuid(configured)) return configured;
  return userId;
}

function inferRouteAction(prompt = '') {
  const text = String(prompt || '').toLowerCase();
  const patterns = [
    { route: '/dashboard', re: /\b(go to|open|navigate to)\s+dashboard\b/ },
    { route: '/billing', re: /\b(go to|open|navigate to)\s+billing\b/ },
    { route: '/analytics', re: /\b(go to|open|navigate to)\s+analytics\b/ },
    { route: '/settings', re: /\b(go to|open|navigate to)\s+settings\b/ },
  ];

  const match = patterns.find((entry) => entry.re.test(text));
  return match ? match.route : null;
}

async function executeBobAgentLoop({
  userId,
  operatorId,
  sessionId,
  userPrompt,
  queryEmbedding,
  currentRoute,
  orgId,
  systemPromptOverride,
  generateReply,
}) {
  const { supabaseUrl, serviceRoleKey } = resolveSupabaseConfig();
  const effectiveOperatorId = resolveOperatorId({ requestedOperatorId: operatorId, userId });

  const effectiveSessionId = String(sessionId || '').trim() || randomUUID();
  const embedding = coerceEmbedding(queryEmbedding);

  const [history, longTermMatches] = await Promise.all([
    fetchShortTermHistory({
      supabaseUrl,
      serviceRoleKey,
      userId,
      sessionId: effectiveSessionId,
      limit: 6,
    }),
    matchLongTermContext({
      supabaseUrl,
      serviceRoleKey,
      userId,
      queryEmbedding: embedding,
      threshold: 0.7,
      count: 3,
    }),
  ]);

  const shortTerm = history
    .map((entry) => String(entry?.content || '').trim())
    .filter(Boolean)
    .reverse()
    .join('\n');

  const longTerm = longTermMatches
    .map((entry) => String(entry?.content || '').trim())
    .filter(Boolean)
    .join('\n');

  const reply = await generateReply({
    message: userPrompt,
    context: {
      current_route: currentRoute || null,
      long_term_context: longTerm,
      short_term_history: shortTerm,
      org_id: orgId || null,
      bob_memory_ledger_enabled: true,
    },
    systemPromptOverride,
  });

  const routeAction = inferRouteAction(userPrompt);
  if (routeAction) {
    await insertLedgerRecord({
      supabaseUrl,
      serviceRoleKey,
      row: {
        session_id: effectiveSessionId,
        user_id: userId,
        operator_id: effectiveOperatorId,
        record_type: 'transaction_step',
        content: `Navigated to ${routeAction}`,
        status: 'success',
        metadata: {
          target_route: routeAction,
          previous_route: currentRoute || null,
          org_id: orgId || null,
          actor_mode: effectiveOperatorId === userId ? 'customer' : 'bob_system',
        },
      },
    });
  }

  await insertLedgerRecord({
    supabaseUrl,
    serviceRoleKey,
    row: {
      session_id: effectiveSessionId,
      user_id: userId,
      operator_id: effectiveOperatorId,
      record_type: 'short_term',
      content: `User: ${userPrompt} | Bob: ${reply.text}`,
      status: 'success',
      metadata: {
        provider: reply.provider || 'ollama',
        fallback: reply.fallback === true,
        org_id: orgId || null,
        actor_mode: effectiveOperatorId === userId ? 'customer' : 'bob_system',
      },
    },
  });

  return {
    sessionId: effectiveSessionId,
    routeAction,
    shortTermCount: history.length,
    longTermCount: longTermMatches.length,
    reply,
  };
}

module.exports = {
  executeBobAgentLoop,
};
