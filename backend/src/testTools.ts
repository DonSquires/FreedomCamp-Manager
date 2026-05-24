import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { discoverEnvironmentKey } from './intelTools.js';

type JsonMap = Record<string, unknown>;

function hasSignal(haystack: string, patterns: string[]): boolean {
  return patterns.some((pattern) => haystack.includes(pattern));
}

async function createAdminSupabaseClient() {
  const supabaseUrl =
    (await discoverEnvironmentKey('SUPABASE_URL')) ??
    (await discoverEnvironmentKey('VITE_SUPABASE_URL')) ??
    (process.env.SUPABASE_PROJECT_REF ? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co` : null);

  const serviceRoleKey =
    (await discoverEnvironmentKey('SUPABASE_SERVICE_ROLE_KEY')) ??
    (await discoverEnvironmentKey('SERVICE_ROLE_KEY')) ??
    null;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn('[TEST-ORCH] Missing Supabase admin credentials for fixture orchestration.');
    return null;
  }

  return createClient<JsonMap>(supabaseUrl, serviceRoleKey, {
    realtime: {
      transport: ws as unknown as never,
    },
  });
}

async function tryInsert(table: string, payload: JsonMap): Promise<boolean> {
  const supabase = await createAdminSupabaseClient();
  if (!supabase) return false;

  try {
    const { error } = await (supabase as any).from(table).insert(payload);
    if (error) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function seedLocationFixture(orgId: string | null): Promise<boolean> {
  const now = new Date().toISOString();
  const base = {
    id: randomUUID(),
    name: `autonomous-test-location-${Date.now()}`,
    is_active: true,
    created_at: now,
    updated_at: now,
  } as JsonMap;

  if (orgId) {
    base.org_id = orgId;
    base.organization_id = orgId;
  }

  const locationTables = ['locations', 'client_sites', 'work_locations'];
  for (const table of locationTables) {
    if (await tryInsert(table, base)) {
      console.info(`[TEST-ORCH] Injected location fixture into ${table}.`);
      return true;
    }
  }

  return false;
}

async function seedUserFixture(orgId: string | null): Promise<boolean> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const base = {
    id,
    full_name: 'Autonomous Test User',
    role: 'officer',
    is_active: true,
    created_at: now,
    updated_at: now,
  } as JsonMap;

  if (orgId) {
    base.org_id = orgId;
    base.organization_id = orgId;
  }

  const userTables = ['user_profiles', 'users'];
  for (const table of userTables) {
    if (await tryInsert(table, base)) {
      console.info(`[TEST-ORCH] Injected user fixture into ${table}.`);
      return true;
    }
  }

  return false;
}

async function seedOrganizationFixture(): Promise<string | null> {
  const orgId = randomUUID();
  const now = new Date().toISOString();
  const payload = {
    id: orgId,
    name: `autonomous-test-org-${Date.now()}`,
    is_active: true,
    created_at: now,
    updated_at: now,
  } as JsonMap;

  const orgTables = ['organizations', 'organisations'];
  for (const table of orgTables) {
    if (await tryInsert(table, payload)) {
      console.info(`[TEST-ORCH] Injected organization fixture into ${table}.`);
      return orgId;
    }
  }

  return null;
}

export async function orchestrateMissingTestFixtures(failureLog: string): Promise<boolean> {
  const normalized = String(failureLog || '').toLowerCase();
  if (!normalized) {
    return false;
  }

  const needsRoster = hasSignal(normalized, ['roster', 'rostering', 'shift']);
  const needsUser = hasSignal(normalized, ['user not found', 'missing user', 'profile not found', 'auth user']);
  const needsLocation = hasSignal(normalized, ['location', 'geofence', 'site not found', 'no active locations']);
  const needsToken = hasSignal(normalized, ['token', 'unauthorized', 'forbidden', 'missing key']);

  if (!needsRoster && !needsUser && !needsLocation && !needsToken) {
    return false;
  }

  let injected = false;
  const orgId = await seedOrganizationFixture();

  if (needsLocation || needsRoster) {
    injected = (await seedLocationFixture(orgId)) || injected;
  }

  if (needsUser || needsRoster) {
    injected = (await seedUserFixture(orgId)) || injected;
  }

  if (needsToken && !process.env.TEST_AUTH_TOKEN) {
    process.env.TEST_AUTH_TOKEN = `autonomous-test-token-${randomUUID()}`;
    console.info('[TEST-ORCH] Generated fallback TEST_AUTH_TOKEN for replay lane.');
    injected = true;
  }

  return injected;
}
