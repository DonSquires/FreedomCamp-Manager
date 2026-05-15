const test = require('node:test');
const assert = require('node:assert/strict');

const { executeBobAgentLoop } = require('../lib/bob-agent-ledger');

function jsonResponse(ok, status, payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return {
    ok,
    status,
    text: async () => text,
  };
}

test('executeBobAgentLoop falls back when the ledger schema lacks organization_id', async () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    BOB_SYSTEM_USER_ID: process.env.BOB_SYSTEM_USER_ID,
  };

  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  process.env.BOB_SYSTEM_USER_ID = '11111111-1111-4111-8111-111111111111';

  const fetchCalls = [];
  const originalFetch = global.fetch;
  global.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init.method || 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;

    fetchCalls.push({ url, method, body });

    if (method === 'GET' && url.includes('/rest/v1/bob_system_ledger?')) {
      if (url.includes('organization_id=eq.org-123')) {
        return jsonResponse(false, 400, { message: 'column "organization_id" does not exist' });
      }

      return jsonResponse(true, 200, [
        { content: 'Older note' },
        { content: 'Newer note' },
      ]);
    }

    if (method === 'POST' && url.includes('/rest/v1/rpc/match_bob_memories')) {
      return jsonResponse(true, 200, []);
    }

    if (method === 'POST' && url.includes('/rest/v1/bob_system_ledger')) {
      if (body && Object.prototype.hasOwnProperty.call(body, 'organization_id')) {
        return jsonResponse(false, 400, { message: 'column "organization_id" does not exist' });
      }

      return jsonResponse(true, 201, [{ id: 'ledger-row-id' }]);
    }

    throw new Error(`Unexpected fetch call: ${method} ${url}`);
  };

  try {
    const reply = await executeBobAgentLoop({
      userId: 'user-123',
      operatorId: 'operator-123',
      sessionId: 'session-123',
      userPrompt: 'Check the latest status',
      queryEmbedding: [0.1, 0.2, 0.3],
      currentRoute: '/dashboard',
      orgId: 'org-123',
      systemPromptOverride: 'override prompt',
      generateReply: async ({ message, context, systemPromptOverride }) => ({
        text: `reply:${message}:${context.short_term_history}`,
        provider: 'mock-provider',
        fallback: false,
        echoedSystemPromptOverride: systemPromptOverride,
      }),
    });

    assert.equal(reply.sessionId, 'session-123');
    assert.equal(reply.routeAction, null);
    assert.equal(reply.shortTermCount, 2);
    assert.equal(reply.longTermCount, 0);
    assert.equal(reply.reply.text, 'reply:Check the latest status:Newer note\nOlder note');

    const primaryHistoryCall = fetchCalls.find((entry) => entry.method === 'GET' && entry.url.includes('organization_id=eq.org-123'));
    assert.ok(primaryHistoryCall, 'expected primary history lookup with organization_id');

    const fallbackHistoryCall = fetchCalls.find((entry) => entry.method === 'GET' && entry.url.includes('/rest/v1/bob_system_ledger?') && !entry.url.includes('organization_id=eq.org-123'));
    assert.ok(fallbackHistoryCall, 'expected fallback history lookup without organization_id');

    const insertCalls = fetchCalls.filter((entry) => entry.method === 'POST' && entry.url.includes('/rest/v1/bob_system_ledger'));
    assert.equal(insertCalls.length, 2, 'expected primary and fallback insert attempts');
    assert.equal(insertCalls[0].body.organization_id, 'org-123');
    assert.equal(insertCalls[0].body.operator_id, '11111111-1111-4111-8111-111111111111');
    assert.ok(!Object.prototype.hasOwnProperty.call(insertCalls[1].body, 'organization_id'));
    assert.equal(insertCalls[1].body.record_type, 'short_term');
    assert.equal(insertCalls[1].body.metadata.org_id, 'org-123');
    assert.equal(insertCalls[1].body.metadata.actor_mode, 'bob_system');
  } finally {
    global.fetch = originalFetch;
    process.env.SUPABASE_URL = originalEnv.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.SUPABASE_SERVICE_ROLE_KEY;
    process.env.BOB_SYSTEM_USER_ID = originalEnv.BOB_SYSTEM_USER_ID;
  }
});
