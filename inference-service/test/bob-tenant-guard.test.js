const test = require('node:test');
const assert = require('node:assert/strict');

const {
  enforceMultiTenantGuard,
  collectAllowedOrgIds,
} = require('../lib/bob-tenant-guard');

function jsonResponse(ok, status, payload) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(payload),
  };
}

test('collectAllowedOrgIds includes all org membership sources', () => {
  const ids = collectAllowedOrgIds({
    organization_id: 'org-a',
    employer_organization_id: 'org-b',
    authorized_work_locations: ['org-c', '   ', null],
    extra_organization_ids: ['org-d', 'org-a'],
  });

  assert.deepEqual([...ids].sort(), ['org-a', 'org-b', 'org-c', 'org-d']);
});

test('enforceMultiTenantGuard rejects missing user_id before any profile lookup', async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => {
    called = true;
    throw new Error('should not fetch');
  };

  try {
    const result = await enforceMultiTenantGuard({ inferenceAuth: { sub: 'user-1' } }, {
      requestingUserId: '',
      activeOrganizationId: 'org-a',
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.message, 'user_id is required for tenant guard');
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('enforceMultiTenantGuard rejects cross-user and cross-tenant mismatches', async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => {
    called = true;
    return jsonResponse(true, 200, [{ organization_id: 'org-a' }]);
  };

  try {
    const userMismatch = await enforceMultiTenantGuard(
      { inferenceAuth: { sub: 'user-auth', organization_id: 'org-a' } },
      { requestingUserId: 'user-other', activeOrganizationId: 'org-a' },
    );
    assert.equal(userMismatch.ok, false);
    assert.equal(userMismatch.status, 403);
    assert.equal(userMismatch.message, 'Access Denied: user scope mismatch.');

    const orgMismatch = await enforceMultiTenantGuard(
      { inferenceAuth: { sub: 'user-auth', organization_id: 'org-a', method: 'supabase_jwt' } },
      { requestingUserId: 'user-auth', activeOrganizationId: 'org-b' },
    );
    assert.equal(orgMismatch.ok, false);
    assert.equal(orgMismatch.status, 403);
    assert.equal(orgMismatch.message, 'Access Denied: Cross-tenant operation detected.');
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('enforceMultiTenantGuard allows org membership resolved from profile', async () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const originalFetch = global.fetch;

  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

  const fetchCalls = [];
  global.fetch = async (input, init = {}) => {
    fetchCalls.push({ url: String(input), method: String(init.method || 'GET').toUpperCase() });
    return jsonResponse(true, 200, [{ organization_id: 'org-a', extra_organization_ids: ['org-z'] }]);
  };

  try {
    const result = await enforceMultiTenantGuard(
      { inferenceAuth: { sub: 'user-1', method: 'api_key' } },
      { requestingUserId: 'user-1', activeOrganizationId: 'org-z' },
    );

    assert.equal(result.ok, true);
    assert.equal(result.verifiedOrgId, 'org-z');
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].method, 'GET');
    assert.match(fetchCalls[0].url, /user_profiles\?/);
  } finally {
    global.fetch = originalFetch;
    process.env.SUPABASE_URL = originalEnv.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.SUPABASE_SERVICE_ROLE_KEY;
  }
});
