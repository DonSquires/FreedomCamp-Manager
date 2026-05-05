import { test, expect } from '@playwright/test'
import { getApiBearerToken, getApiTestCredentials, getTestUser, type TestUserKey } from './auth'

const DEFAULT_SUPABASE_URL = 'https://kxwjcupuxnnbnzcgmkoi.supabase.co'
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const adminOrg1Email = String(process.env.PLAYWRIGHT_ADMIN_ORG1_EMAIL || process.env.PLAYWRIGHT_ADMIN_EMAIL || process.env.E2E_ADMIN_EMAIL || '').trim().toLowerCase()
const adminOrg2Email = String(process.env.PLAYWRIGHT_ADMIN_ORG2_EMAIL || process.env.E2E_ADMIN_ORG2_EMAIL || '').trim().toLowerCase()
const hasDistinctAdminOrg2Creds = !!adminOrg2Email && adminOrg2Email !== adminOrg1Email

function getSupabaseUrl(): string {
  const candidates = [
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_URL,
    DEFAULT_SUPABASE_URL,
  ]

  for (const candidate of candidates) {
    const base = (candidate || '').trim().replace(/^['"]|['"]$/g, '')
    if (/^https?:\/\//i.test(base)) {
      return base.replace(/\/$/, '')
    }
  }

  throw new Error('Unable to resolve Supabase URL.')
}

function getAnonKey(): string {
  const anon = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
  if (!anon) {
    throw new Error('VITE_SUPABASE_ANON_KEY is required for org isolation API tests.')
  }
  return anon
}

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: getAnonKey(),
    'Content-Type': 'application/json',
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

async function resolveBearerToken(): Promise<string | null> {
  const directToken = getApiBearerToken()
  if (directToken) return directToken

  const { email, password } = getApiTestCredentials()
  if (!email || !password) return null

  const res = await fetch(`${getSupabaseUrl()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) return null

  const payload = await res.json() as { access_token?: string }
  return payload.access_token || null
}

async function resolveTokenForCredentials(email: string, password: string): Promise<string | null> {
  if (!email || !password) return null

  const res = await fetch(`${getSupabaseUrl()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) return null

  const payload = await res.json() as { access_token?: string }
  return payload.access_token || null
}

async function resolveApiProfile(token: string): Promise<{ role?: string; organization_id?: string } | null> {
  const me = await restGet('user_profiles?select=role,organization_id&limit=1', token)
  if (me.status !== 200 || !Array.isArray(me.data) || me.data.length === 0) {
    return null
  }

  return (me.data as Array<{ role?: string; organization_id?: string }>)[0] || null
}

async function resolveNonMasterBearerToken(): Promise<string | null> {
  const directToken = await resolveBearerToken()
  if (directToken) {
    const profile = await resolveApiProfile(directToken)
    const role = String(profile?.role || '').toLowerCase()
    if (role && role !== 'master' && role !== 'grand_master') {
      return directToken
    }
  }

  const candidateUsers: TestUserKey[] = ['officerOrg1', 'adminOrg1', 'clientViewer', 'clientStaff', 'adminOrg2']
  for (const candidateUser of candidateUsers) {
    const credentials = getTestUser(candidateUser)
    const token = await resolveTokenForCredentials(credentials.email, credentials.password)
    if (!token) continue

    const profile = await resolveApiProfile(token)
    const role = String(profile?.role || '').toLowerCase()
    if (role && role !== 'master' && role !== 'grand_master') {
      return token
    }
  }

  return null
}

async function resolveTokenForUser(user: TestUserKey): Promise<string | null> {
  const credentials = getTestUser(user)
  return resolveTokenForCredentials(credentials.email, credentials.password)
}

async function resolveDistinctForeignOrgId(): Promise<string | null> {
  if (!hasDistinctAdminOrg2Creds) return null

  const adminOrg1Token = await resolveTokenForUser('adminOrg1')
  const adminOrg2Token = await resolveTokenForUser('adminOrg2')
  if (!adminOrg1Token || !adminOrg2Token) return null

  const adminOrg1Profile = await resolveApiProfile(adminOrg1Token)
  const adminOrg2Profile = await resolveApiProfile(adminOrg2Token)
  const adminOrg1Role = String(adminOrg1Profile?.role || '').toLowerCase()
  const adminOrg2Role = String(adminOrg2Profile?.role || '').toLowerCase()
  const adminOrg1OrgId = adminOrg1Profile?.organization_id || null
  const adminOrg2OrgId = adminOrg2Profile?.organization_id || null

  if (!adminOrg1OrgId || !adminOrg2OrgId || adminOrg1OrgId === adminOrg2OrgId) {
    return null
  }

  if ([adminOrg1Role, adminOrg2Role].some((role) => role === 'master' || role === 'grand_master')) {
    return null
  }

  return adminOrg2OrgId
}

async function restGet(path: string, token: string) {
  const res = await fetch(`${getSupabaseUrl()}/rest/v1/${path}`, {
    method: 'GET',
    headers: authHeaders(token),
  })

  const body = await res.text()
  let data: unknown = null
  try {
    data = body ? JSON.parse(body) : null
  } catch {
    data = body
  }

  return { status: res.status, data }
}

async function createSyntheticOrg(): Promise<string> {
  const suffix = Date.now()

  const res = await fetch(`${getSupabaseUrl()}/rest/v1/organizations`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      name: `[TEST-ISO-API] ${suffix}`,
      is_active: true,
      organization_type: 'security_company',
    }),
  })

  if (!res.ok) {
    throw new Error(`Failed to create synthetic org: HTTP ${res.status}`)
  }

  const rows = await res.json() as Array<{ id: string }>
  if (!rows?.[0]?.id) {
    throw new Error('Synthetic org creation returned no id')
  }

  return rows[0].id
}

async function findForeignOrgId(myOrgId?: string | null): Promise<string | null> {
  const query = myOrgId
    ? `id=not.eq.${myOrgId}&select=id&limit=1`
    : 'select=id&limit=1'

  const res = await fetch(`${getSupabaseUrl()}/rest/v1/organizations?${query}`, {
    method: 'GET',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  })

  if (!res.ok) return null

  const rows = await res.json() as Array<{ id: string }>
  return rows?.[0]?.id || null
}

async function createSyntheticAuditLog(orgId: string): Promise<string> {
  const res = await fetch(`${getSupabaseUrl()}/rest/v1/audit_log`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      action: 'org_isolation_api_proof',
      entity_type: 'org_isolation_test',
      entity_id: `iso-${Date.now()}`,
      organization_id: orgId,
      new_values: { source: 'playwright-api-proof' },
    }),
  })

  if (!res.ok) {
    throw new Error(`Failed to create synthetic audit log: HTTP ${res.status}`)
  }

  const rows = await res.json() as Array<{ id: string }>
  if (!rows?.[0]?.id) {
    throw new Error('Synthetic audit log creation returned no id')
  }

  return rows[0].id
}

async function deleteSyntheticAuditLog(auditLogId: string): Promise<void> {
  await fetch(`${getSupabaseUrl()}/rest/v1/audit_log?id=eq.${auditLogId}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  })
}

async function deleteSyntheticOrg(orgId: string): Promise<void> {
  await fetch(`${getSupabaseUrl()}/rest/v1/organizations?id=eq.${orgId}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  })
}

async function countUserProfilesForOrg(orgId: string): Promise<number | null> {
  if (!serviceRoleKey) return null

  const res = await fetch(`${getSupabaseUrl()}/rest/v1/user_profiles?select=id&organization_id=eq.${orgId}&limit=1`, {
    method: 'GET',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  })

  if (!res.ok) return null
  const rows = await res.json() as Array<{ id: string }>
  return Array.isArray(rows) ? rows.length : null
}

async function countRowsForOrg(table: string, orgId: string): Promise<number | null> {
  if (!serviceRoleKey) return null

  const res = await fetch(`${getSupabaseUrl()}/rest/v1/${table}?select=id&organization_id=eq.${orgId}&limit=1`, {
    method: 'GET',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  })

  if (!res.ok) return null
  const rows = await res.json() as Array<{ id: string }>
  return Array.isArray(rows) ? rows.length : null
}

test.describe('Org Isolation API Proof', () => {
  let bearerToken: string | null = null
  let foreignOrgIdFromDistinctCreds: string | null = null

  test.beforeAll(async () => {
    bearerToken = await resolveNonMasterBearerToken()
    foreignOrgIdFromDistinctCreds = await resolveDistinctForeignOrgId()
  })

  test('authenticated token can resolve its own profile org', async () => {
    test.skip(!bearerToken, 'No API bearer token or API test credentials available')

    const me = await restGet('user_profiles?select=id,role,organization_id&limit=1', bearerToken as string)

    expect(me.status).toBe(200)
    expect(Array.isArray(me.data)).toBe(true)

    const rows = me.data as Array<{ organization_id?: string }>
    expect(rows.length).toBeGreaterThan(0)
    expect(typeof rows[0]?.organization_id).toBe('string')
  })

  test('non-master token cannot read synthetic foreign organization', async () => {
    test.skip(!bearerToken, 'No non-master API bearer token or role credentials available')
    test.skip(!serviceRoleKey && !foreignOrgIdFromDistinctCreds, 'Need SUPABASE_SERVICE_ROLE_KEY or distinct org credentials for foreign-org proof')

    const me = await restGet('user_profiles?select=role,organization_id&limit=1', bearerToken as string)
    expect(me.status).toBe(200)
    const meRow = ((me.data as Array<{ role?: string; organization_id?: string }>)?.[0] || {})
    const myRole = (meRow.role || '').toLowerCase()
    const myOrgId = meRow.organization_id || null

    expect(myRole === 'master' || myRole === 'grand_master').toBe(false)

    // Prefer real distinct-org proof when available; synthetic org rows can be noisy in shared staging contexts.
    if (foreignOrgIdFromDistinctCreds) {
      const foreignRead = await restGet(
        `user_profiles?select=id,organization_id&organization_id=eq.${foreignOrgIdFromDistinctCreds}&limit=1`,
        bearerToken as string
      )
      expect(foreignRead.status).toBe(200)
      expect(Array.isArray(foreignRead.data)).toBe(true)
      expect((foreignRead.data as unknown[]).length).toBe(0)
      return
    }

    let syntheticOrgId: string | null = await findForeignOrgId(myOrgId)
    let createdOrg = false

    if (!syntheticOrgId) {
      syntheticOrgId = await createSyntheticOrg()
      createdOrg = true
    }

    const syntheticAuditId = await createSyntheticAuditLog(syntheticOrgId)
    try {
      const foreignRead = await restGet(`audit_log?select=id,organization_id&id=eq.${syntheticAuditId}&organization_id=eq.${syntheticOrgId}&limit=1`, bearerToken as string)
      expect(foreignRead.status).toBe(200)
      expect(Array.isArray(foreignRead.data)).toBe(true)
      expect((foreignRead.data as unknown[]).length).toBe(0)
    } finally {
      await deleteSyntheticAuditLog(syntheticAuditId)
      if (createdOrg && syntheticOrgId) {
        await deleteSyntheticOrg(syntheticOrgId)
      }
    }
  })

  test('non-master token cannot read foreign user_profiles rows', async () => {
    test.skip(!bearerToken, 'No non-master API bearer token or role credentials available')
    test.skip(!foreignOrgIdFromDistinctCreds, 'Need distinct Org 2 credentials for foreign-org user_profiles proof')

    const foreignOrgUserCount = await countUserProfilesForOrg(foreignOrgIdFromDistinctCreds as string)
    if (foreignOrgUserCount !== null) {
      test.skip(foreignOrgUserCount === 0, 'Foreign org has no user_profiles rows to validate against')
    }

    const foreignProfiles = await restGet(
      `user_profiles?select=id,organization_id&organization_id=eq.${foreignOrgIdFromDistinctCreds}&limit=5`,
      bearerToken as string
    )

    expect(foreignProfiles.status).toBe(200)
    expect(Array.isArray(foreignProfiles.data)).toBe(true)
    expect((foreignProfiles.data as unknown[]).length).toBe(0)
  })

  test('non-master token organization list is scoped to own org', async () => {
    test.skip(!bearerToken, 'No non-master API bearer token or role credentials available')

    const me = await restGet('user_profiles?select=role,organization_id&limit=1', bearerToken as string)
    expect(me.status).toBe(200)
    const meRow = ((me.data as Array<{ role?: string; organization_id?: string }>)?.[0] || {})
    const myRole = (meRow.role || '').toLowerCase()
    const myOrgId = meRow.organization_id || null

    test.skip(
      myRole === 'master' || myRole === 'grand_master',
      'Resolved bearer token maps to master scope in this environment; non-master organization-list proof not applicable'
    )
    const orgRows = await restGet('organizations?select=id,name&limit=100', bearerToken as string)
    expect(orgRows.status).toBe(200)
    expect(Array.isArray(orgRows.data)).toBe(true)

    const rows = orgRows.data as Array<{ id?: string }>
    test.skip(rows.length === 0, 'No organization rows visible for this role in this environment')

    const memberships = await restGet('user_organizations?select=organization_id&limit=200', bearerToken as string)
    test.skip(memberships.status !== 200, 'user_organizations is not directly readable for this role in this environment')
    expect(Array.isArray(memberships.data)).toBe(true)

    const allowedOrgIds = new Set(
      (memberships.data as Array<{ organization_id?: string }>)
        .map((row) => row.organization_id)
        .filter((id): id is string => !!id)
    )

    if (myOrgId) {
      allowedOrgIds.add(myOrgId)
    }

    test.skip(allowedOrgIds.size === 0, 'No membership-scoped organization ids available for this role in this environment')

    expect(rows.every((row) => !!row.id && allowedOrgIds.has(row.id))).toBe(true)
  })

  test('non-master token cannot read foreign audit_log rows', async () => {
    test.skip(!bearerToken, 'No non-master API bearer token or role credentials available')
    test.skip(!serviceRoleKey && !foreignOrgIdFromDistinctCreds, 'Need SUPABASE_SERVICE_ROLE_KEY or distinct org credentials for foreign-org audit log proof')

    const me = await restGet('user_profiles?select=role,organization_id&limit=1', bearerToken as string)
    expect(me.status).toBe(200)
    const meRow = ((me.data as Array<{ role?: string; organization_id?: string }>)?.[0] || {})
    const myOrgId = meRow.organization_id || null

    let foreignOrgId: string | null = foreignOrgIdFromDistinctCreds

    if (!foreignOrgId && serviceRoleKey) {
      foreignOrgId = await findForeignOrgId(myOrgId)
    }

    test.skip(!foreignOrgId, 'Unable to resolve a foreign organization id for audit-log proof')

    let syntheticAuditId: string | null = null
    if (serviceRoleKey) {
      syntheticAuditId = await createSyntheticAuditLog(foreignOrgId as string)
    }

    try {
      const path = syntheticAuditId
        ? `audit_log?select=id,organization_id&id=eq.${syntheticAuditId}&organization_id=eq.${foreignOrgId}&limit=1`
        : `audit_log?select=id,organization_id&organization_id=eq.${foreignOrgId}&limit=1`

      const foreignAudit = await restGet(path, bearerToken as string)

      expect(foreignAudit.status).toBe(200)
      expect(Array.isArray(foreignAudit.data)).toBe(true)
      expect((foreignAudit.data as unknown[]).length).toBe(0)
    } finally {
      if (syntheticAuditId) {
        await deleteSyntheticAuditLog(syntheticAuditId)
      }
    }
  })

  test('non-master token cannot read foreign client_sites rows', async () => {
    test.skip(!bearerToken, 'No non-master API bearer token or role credentials available')
    test.skip(!serviceRoleKey && !foreignOrgIdFromDistinctCreds, 'Need SUPABASE_SERVICE_ROLE_KEY or distinct org credentials for foreign-org client sites proof')

    const me = await restGet('user_profiles?select=role,organization_id&limit=1', bearerToken as string)
    expect(me.status).toBe(200)
    const meRow = ((me.data as Array<{ role?: string; organization_id?: string }>)?.[0] || {})
    const myRole = (meRow.role || '').toLowerCase()
    const myOrgId = meRow.organization_id || null

    expect(myRole === 'master' || myRole === 'grand_master').toBe(false)

    let foreignOrgId: string | null = foreignOrgIdFromDistinctCreds
    if (!foreignOrgId && serviceRoleKey) foreignOrgId = await findForeignOrgId(myOrgId)
    test.skip(!foreignOrgId, 'Unable to resolve a foreign organization id for client sites proof')

    const foreignRows = await countRowsForOrg('client_sites', foreignOrgId as string)
    if (foreignRows !== null) {
      test.skip(foreignRows === 0, 'Foreign org has no client_sites rows to validate against')
    }

    const foreignRead = await restGet(
      `client_sites?select=id,organization_id&organization_id=eq.${foreignOrgId}&limit=5`,
      bearerToken as string
    )

    expect(foreignRead.status).toBe(200)
    expect(Array.isArray(foreignRead.data)).toBe(true)
    expect((foreignRead.data as unknown[]).length).toBe(0)
  })

  test('non-master token cannot read foreign contractor_profiles rows', async () => {
    test.skip(!bearerToken, 'No non-master API bearer token or role credentials available')
    test.skip(!serviceRoleKey && !foreignOrgIdFromDistinctCreds, 'Need SUPABASE_SERVICE_ROLE_KEY or distinct org credentials for foreign-org contractor profile proof')

    const me = await restGet('user_profiles?select=role,organization_id&limit=1', bearerToken as string)
    expect(me.status).toBe(200)
    const meRow = ((me.data as Array<{ role?: string; organization_id?: string }>)?.[0] || {})
    const myRole = (meRow.role || '').toLowerCase()
    const myOrgId = meRow.organization_id || null

    expect(myRole === 'master' || myRole === 'grand_master').toBe(false)

    let foreignOrgId: string | null = foreignOrgIdFromDistinctCreds
    if (!foreignOrgId && serviceRoleKey) foreignOrgId = await findForeignOrgId(myOrgId)
    test.skip(!foreignOrgId, 'Unable to resolve a foreign organization id for contractor profile proof')

    const foreignRows = await countRowsForOrg('contractor_profiles', foreignOrgId as string)
    if (foreignRows !== null) {
      test.skip(foreignRows === 0, 'Foreign org has no contractor_profiles rows to validate against')
    }

    const foreignRead = await restGet(
      `contractor_profiles?select=id,organization_id&organization_id=eq.${foreignOrgId}&limit=5`,
      bearerToken as string
    )

    expect(foreignRead.status).toBe(200)
    expect(Array.isArray(foreignRead.data)).toBe(true)
    expect((foreignRead.data as unknown[]).length).toBe(0)
  })

  // P4-9: CRM organisations bleed — non-master token cannot see a foreign org's
  // user_profiles rows via the organizations → user_profiles join path.
  test('non-master token cannot read foreign org via CRM organizations endpoint', async () => {
    test.skip(!bearerToken, 'No non-master API bearer token or role credentials available')
    test.skip(!serviceRoleKey && !foreignOrgIdFromDistinctCreds, 'Need SUPABASE_SERVICE_ROLE_KEY or distinct org credentials for CRM org proof')

    const me = await restGet('user_profiles?select=role,organization_id&limit=1', bearerToken as string)
    expect(me.status).toBe(200)
    const meRow = ((me.data as Array<{ role?: string; organization_id?: string }>)?.[0] || {})
    const myRole = (meRow.role || '').toLowerCase()
    const myOrgId = meRow.organization_id || null

    test.skip(
      myRole === 'master' || myRole === 'grand_master',
      'Resolved bearer token maps to master scope; CRM bleed proof requires single-org role.'
    )

    let foreignOrgId: string | null = foreignOrgIdFromDistinctCreds
    if (!foreignOrgId && serviceRoleKey) foreignOrgId = await findForeignOrgId(myOrgId)
    test.skip(!foreignOrgId, 'Unable to resolve a foreign organization id for CRM org proof')

    // The CRM module queries `organizations` scoped by organization_id membership.
    // A non-master user should NOT see a foreign organization row.
    const foreignOrgRead = await restGet(
      `organizations?select=id,name,organization_type&id=eq.${foreignOrgId}&limit=1`,
      bearerToken as string
    )

    expect(foreignOrgRead.status).toBe(200)
    expect(Array.isArray(foreignOrgRead.data)).toBe(true)
    expect((foreignOrgRead.data as unknown[]).length).toBe(0)
  })

  // P4-9: /users bleed — non-master cannot see user_profiles for a foreign org
  // (strengthens the existing user_profiles test with a direct org-scoped query).
  test('non-master token cannot list users for a foreign org (P4-9 /users bleed)', async () => {
    test.skip(!bearerToken, 'No non-master API bearer token or role credentials available')
    test.skip(!foreignOrgIdFromDistinctCreds, 'Need distinct Org 2 credentials for /users bleed proof')

    const me = await restGet('user_profiles?select=role,organization_id&limit=1', bearerToken as string)
    expect(me.status).toBe(200)
    const meRow = ((me.data as Array<{ role?: string; organization_id?: string }>)?.[0] || {})
    const myRole = (meRow.role || '').toLowerCase()

    test.skip(
      myRole === 'master' || myRole === 'grand_master',
      'Resolved bearer token maps to master scope; /users bleed proof requires single-org role.'
    )

    const foreignUsersRead = await restGet(
      `user_profiles?select=id,organization_id&organization_id=eq.${foreignOrgIdFromDistinctCreds}&limit=5`,
      bearerToken as string
    )

    expect(foreignUsersRead.status).toBe(200)
    expect(Array.isArray(foreignUsersRead.data)).toBe(true)
    expect((foreignUsersRead.data as unknown[]).length).toBe(0)
  })
})
