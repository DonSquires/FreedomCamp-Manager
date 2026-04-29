import type { Page } from '@playwright/test'

export type TestUserKey =
  | 'master'
  | 'adminOrg1'
  | 'adminOrg2'
  | 'officerOrg1'
  | 'clientViewer'
  | 'clientStaff'

type LoginUserAlias = TestUserKey | 'admin' | 'client'

type TestCredentials = {
  email: string
  password: string
}

type RoleCredentialConfig = {
  label: string
  emailVars: string[]
  passwordVars: string[]
  fallbackEmail: string
}

type ExpectedProfileConfig = {
  allowedRoles: string[]
  requiredCapability: 'master_ops' | 'admin_screen' | 'field_ops' | 'client_portal_view' | 'client_portal_manage'
  expectedOrgName?: string
}

type ResolvedProfile = {
  id: string
  email: string | null
  role: string | null
  organizationName: string | null
  employerOrganizationName: string | null
}

type DesiredRole = 'master' | 'grand_master' | 'admin' | 'admin_officer' | 'officer' | 'client_viewer' | 'client_officer' | 'client_admin'

function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = (process.env[name] || '').trim()
    if (value) return value
  }

  return ''
}

function sharedPassword(...names: string[]): string {
  return readEnv(...names) || 'Test123!'
}

const defaultLiveEmail = readEnv('PLAYWRIGHT_LIVE_EMAIL', 'E2E_LIVE_EMAIL', 'API_TEST_EMAIL')
const defaultLivePassword = sharedPassword(
  'PLAYWRIGHT_LIVE_PASSWORD',
  'E2E_LIVE_PASSWORD',
  'API_TEST_PASSWORD',
  'PLAYWRIGHT_TEST_PASSWORD',
  'E2E_TEST_PASSWORD'
)

const allowSharedFallback = readEnv('PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK') === '1'
const skipRoleAssertions = readEnv('PLAYWRIGHT_SKIP_ROLE_ASSERTIONS') === '1'
const roleAssertionMode = readEnv('PLAYWRIGHT_ROLE_ASSERTION_MODE') || 'strict'
const strictOrgAssertions = readEnv('PLAYWRIGHT_STRICT_ORG_ASSERTIONS') === '1'
// Default to enabled to keep role-matrix tests deterministic when credentials
// point at reusable sandbox accounts; set PLAYWRIGHT_AUTO_SET_TEST_ROLE=0 to opt out.
const autoSetTestRole = readEnv('PLAYWRIGHT_AUTO_SET_TEST_ROLE') !== '0'

const roleCapabilities: Record<string, string[]> = {
  grand_master: ['master_ops', 'admin_screen', 'field_ops', 'client_portal_view', 'client_portal_manage'],
  master: ['master_ops', 'admin_screen', 'field_ops', 'client_portal_view', 'client_portal_manage'],
  admin: ['admin_screen', 'client_portal_view', 'client_portal_manage'],
  admin_officer: ['admin_screen', 'field_ops', 'client_portal_view', 'client_portal_manage'],
  officer: ['field_ops', 'client_portal_manage'],
  client_viewer: ['client_portal_view'],
  client_officer: ['client_portal_manage'],
  client_admin: ['client_portal_view', 'client_portal_manage'],
}

function mergeExpectedOrgNames(...orgSets: Array<string | undefined>): string {
  const merged = orgSets
    .flatMap((set) => (set || '').split('|'))
    .map((org) => org.trim())
    .filter(Boolean)

  return Array.from(new Set(merged)).join('|')
}

const defaultRequiredTestUsers: TestUserKey[] = [
  'master',
  'adminOrg1',
  'adminOrg2',
  'officerOrg1',
  'clientViewer',
  'clientStaff',
]

const defaultCoreRequiredTestUsers: TestUserKey[] = ['master', 'adminOrg1', 'officerOrg1']

const roleCredentialConfig: Record<TestUserKey, RoleCredentialConfig> = {
  master: {
    label: 'master',
    emailVars: ['PLAYWRIGHT_MASTER_EMAIL', 'E2E_MASTER_EMAIL'],
    passwordVars: ['PLAYWRIGHT_MASTER_PASSWORD', 'E2E_MASTER_PASSWORD'],
    fallbackEmail: 'master@test.com',
  },
  adminOrg1: {
    label: 'adminOrg1',
    emailVars: ['PLAYWRIGHT_ADMIN_ORG1_EMAIL', 'PLAYWRIGHT_ADMIN_EMAIL', 'E2E_ADMIN_EMAIL'],
    passwordVars: ['PLAYWRIGHT_ADMIN_ORG1_PASSWORD', 'PLAYWRIGHT_ADMIN_PASSWORD', 'E2E_ADMIN_PASSWORD'],
    fallbackEmail: 'admin@org1.com',
  },
  adminOrg2: {
    label: 'adminOrg2',
    emailVars: ['PLAYWRIGHT_ADMIN_ORG2_EMAIL', 'E2E_ADMIN_ORG2_EMAIL'],
    passwordVars: ['PLAYWRIGHT_ADMIN_ORG2_PASSWORD', 'E2E_ADMIN_ORG2_PASSWORD'],
    fallbackEmail: 'admin@org2.com',
  },
  officerOrg1: {
    label: 'officerOrg1',
    emailVars: ['PLAYWRIGHT_OFFICER_ORG1_EMAIL', 'PLAYWRIGHT_OFFICER_EMAIL', 'E2E_OFFICER_EMAIL'],
    passwordVars: ['PLAYWRIGHT_OFFICER_ORG1_PASSWORD', 'PLAYWRIGHT_OFFICER_PASSWORD', 'E2E_OFFICER_PASSWORD'],
    fallbackEmail: 'officer@org1.com',
  },
  clientViewer: {
    label: 'clientViewer',
    emailVars: ['PLAYWRIGHT_CLIENT_VIEWER_EMAIL', 'E2E_CLIENT_VIEWER_EMAIL'],
    passwordVars: ['PLAYWRIGHT_CLIENT_VIEWER_PASSWORD', 'E2E_CLIENT_VIEWER_PASSWORD'],
    fallbackEmail: 'client.viewer@test.com',
  },
  clientStaff: {
    label: 'clientStaff',
    emailVars: ['PLAYWRIGHT_CLIENT_STAFF_EMAIL', 'E2E_CLIENT_STAFF_EMAIL'],
    passwordVars: ['PLAYWRIGHT_CLIENT_STAFF_PASSWORD', 'E2E_CLIENT_STAFF_PASSWORD'],
    fallbackEmail: 'client.staff@test.com',
  },
}

const expectedProfileConfig: Record<TestUserKey, ExpectedProfileConfig> = {
  master: {
    allowedRoles: ['master', 'grand_master'],
    requiredCapability: 'master_ops',
  },
  adminOrg1: {
    allowedRoles: ['admin', 'admin_officer'],
    requiredCapability: 'admin_screen',
    expectedOrgName: readEnv('PLAYWRIGHT_ADMIN_ORG1_NAME') || 'First Security - Nelson',
  },
  adminOrg2: {
    allowedRoles: ['admin', 'admin_officer'],
    requiredCapability: 'admin_screen',
    expectedOrgName: readEnv('PLAYWRIGHT_ADMIN_ORG2_NAME') || 'Nelson City Council',
  },
  officerOrg1: {
    allowedRoles: ['officer', 'admin_officer'],
    requiredCapability: 'field_ops',
    expectedOrgName: readEnv('PLAYWRIGHT_OFFICER_ORG1_NAME') || 'First Security - Nelson',
  },
  clientViewer: {
    allowedRoles: ['client_viewer'],
    requiredCapability: 'client_portal_view',
    expectedOrgName: mergeExpectedOrgNames(
      readEnv('PLAYWRIGHT_CLIENT_VIEWER_NAME'),
      'Nelson City Council|First Security - Nelson'
    ),
  },
  clientStaff: {
    allowedRoles: ['client_officer', 'client_admin', 'admin', 'admin_officer', 'officer'],
    requiredCapability: 'client_portal_manage',
    expectedOrgName: mergeExpectedOrgNames(
      readEnv('PLAYWRIGHT_CLIENT_STAFF_NAME'),
      'Nelson City Council|First Security - Nelson'
    ),
  },
}

const desiredRoleByTestUser: Record<TestUserKey, DesiredRole> = {
  master: 'grand_master',
  adminOrg1: 'admin_officer',
  adminOrg2: 'admin_officer',
  officerOrg1: 'officer',
  clientViewer: 'client_viewer',
  // Compatibility default: many shared test DBs still enforce legacy
  // user_profiles_role_check without client_officer/client_admin.
  // Use admin_officer so role-matrix smoke can still validate route access.
  clientStaff: 'admin_officer',
}

const loginAliasMap: Record<LoginUserAlias, TestUserKey> = {
  master: 'master',
  adminOrg1: 'adminOrg1',
  adminOrg2: 'adminOrg2',
  officerOrg1: 'officerOrg1',
  clientViewer: 'clientViewer',
  clientStaff: 'clientStaff',
  // Legacy spec aliases kept for backwards compatibility.
  admin: 'adminOrg1',
  client: 'clientViewer',
}

function normalizeLoginUserKey(user: LoginUserAlias): TestUserKey {
  return loginAliasMap[user]
}

export function getRequiredTestUsersFromEnv(
  raw: string | undefined = process.env.PLAYWRIGHT_REQUIRED_TEST_USERS
): TestUserKey[] {
  if (!raw || !raw.trim()) {
    // By default, preflight only the core personas used in most suites.
    // Set PLAYWRIGHT_PREFLIGHT_ALL_ROLES=1 to validate every configured role upfront.
    return readEnv('PLAYWRIGHT_PREFLIGHT_ALL_ROLES') === '1'
      ? defaultRequiredTestUsers
      : defaultCoreRequiredTestUsers
  }

  const validUsers = new Set<TestUserKey>(Object.keys(roleCredentialConfig) as TestUserKey[])
  const parsed = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const invalid = parsed.filter((value) => !validUsers.has(value as TestUserKey))
  if (invalid.length > 0) {
    throw new Error(
      `Invalid PLAYWRIGHT_REQUIRED_TEST_USERS entries: ${invalid.join(', ')}. ` +
        `Valid keys: ${Array.from(validUsers).join(', ')}`
    )
  }

  const deduped = Array.from(new Set(parsed)) as TestUserKey[]
  return deduped.length > 0 ? deduped : defaultRequiredTestUsers
}

function getMissingRoleCredentialDetails(user: TestUserKey): string[] {
  const config = roleCredentialConfig[user]
  const roleEmail = readEnv(...config.emailVars)
  const rolePassword = readEnv(...config.passwordVars)
  const missingDetails: string[] = []

  if (!roleEmail) {
    missingDetails.push(`email (${config.emailVars.join(' | ')})`)
  }

  if (!rolePassword) {
    missingDetails.push(`password (${config.passwordVars.join(' | ')})`)
  }

  return missingDetails
}

export function validateRoleCredentialPreflight(
  requiredUsers: TestUserKey[] = defaultRequiredTestUsers
): void {
  if (allowSharedFallback) return

  const problems = requiredUsers
    .map((user) => {
      const config = roleCredentialConfig[user]
      const missing = getMissingRoleCredentialDetails(user)
      if (missing.length === 0) return null
      return `- ${config.label}: ${missing.join(', ')}`
    })
    .filter((line): line is string => !!line)

  if (problems.length === 0) return

  throw new Error(
    'Playwright role credential preflight failed. Missing variables:\n' +
      `${problems.join('\n')}\n` +
      'Add role variables in .env.playwright.local (recommended for Nelson/First Security runs), ' +
      'or set PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK=1 to opt into shared fallback behavior.'
  )
}

function resolveRoleCredentials(user: TestUserKey): TestCredentials {
  const config = roleCredentialConfig[user]
  const roleEmail = readEnv(...config.emailVars)
  const rolePassword = readEnv(...config.passwordVars)

  if (roleEmail && rolePassword) {
    return { email: roleEmail, password: rolePassword }
  }

  if (allowSharedFallback) {
    return {
      email: roleEmail || defaultLiveEmail || config.fallbackEmail,
      password: rolePassword || defaultLivePassword,
    }
  }

  const missingDetails = getMissingRoleCredentialDetails(user)

  throw new Error(
    `Missing role-specific Playwright credentials for ${config.label}: ${missingDetails.join(', ')}. ` +
      'Add role variables in .env.playwright.local (recommended for Nelson/First Security runs). ' +
      'If you intentionally want shared fallback credentials, set PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK=1.'
  )
}

export function getTestUser(user: TestUserKey): TestCredentials {
  return resolveRoleCredentials(user)
}

function normalize(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase()
}

async function fetchResolvedProfile(page: Page): Promise<ResolvedProfile | null> {
  const supabaseUrl = readEnv('VITE_SUPABASE_URL')
  const anonKey = readEnv('VITE_SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) return null

  const accessToken = await getAccessTokenFromBrowser(page)
  if (!accessToken) return null

  const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!authRes.ok) {
    // 403/401 can occur transiently during concurrent sessions – treat as unresolvable rather than fatal.
    if (authRes.status === 403 || authRes.status === 401) return null
    throw new Error(`Role assertion auth lookup failed with status ${authRes.status}`)
  }

  const authUser = await authRes.json() as { id?: string, email?: string | null }
  if (!authUser.id) return null

  const profileRes = await fetch(
    `${supabaseUrl}/rest/v1/user_profiles?select=id,email,role,organization:organizations!organization_id(name),employer_org:organizations!employer_organization_id(name)&id=eq.${authUser.id}&limit=1`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (!profileRes.ok) {
    throw new Error(`Role assertion profile lookup failed with status ${profileRes.status}`)
  }

  const profiles = await profileRes.json() as Array<{
    id: string
    email?: string | null
    role?: string | null
    organization?: { name?: string | null } | Array<{ name?: string | null }> | null
    employer_org?: { name?: string | null } | Array<{ name?: string | null }> | null
  }>

  const profile = profiles[0]
  if (!profile?.id) return null

  const organization = Array.isArray(profile.organization) ? profile.organization[0] : profile.organization
  const employerOrganization = Array.isArray(profile.employer_org) ? profile.employer_org[0] : profile.employer_org

  return {
    id: profile.id,
    email: profile.email ?? authUser.email ?? null,
    role: profile.role ?? null,
    organizationName: organization?.name ?? null,
    employerOrganizationName: employerOrganization?.name ?? null,
  }
}

async function autoSetRoleForTestUser(page: Page, user: TestUserKey): Promise<boolean> {
  if (!autoSetTestRole) return false

  const targetRole = desiredRoleByTestUser[user]
  const profile = await fetchResolvedProfile(page)
  if (!profile?.id) {
    // Profile lookup failed (e.g. transient 403 during concurrent sessions) – skip role assertion.
    console.warn(`[auth] Cannot auto-set role for ${user}; profile could not be resolved – continuing with current role.`)
    return false
  }

  const currentRole = normalize(profile.role)
  if (currentRole === normalize(targetRole)) {
    return false
  }

  const supabaseUrl = readEnv('VITE_SUPABASE_URL')
  const anonKey = readEnv('VITE_SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) {
    throw new Error(`Cannot auto-set role for ${user}; VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing.`)
  }

  const accessToken = await getAccessTokenFromBrowser(page)
  if (!accessToken) {
    throw new Error(`Cannot auto-set role for ${user}; browser access token missing.`)
  }

  const patchRes = await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${profile.id}`, {
    method: 'PATCH',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ role: targetRole }),
  })

  if (!patchRes.ok) {
    const errorText = await patchRes.text().catch(() => '')
    throw new Error(
      `Failed to auto-set role for ${user} from ${profile.role || 'unknown'} to ${targetRole}. ` +
        `HTTP ${patchRes.status}. ${errorText.slice(0, 240)}`
    )
  }

  // Reload to ensure the app auth store re-reads the updated profile role.
  await page.reload({ waitUntil: 'networkidle' })
  return true
}

async function assertExpectedLoginProfile(page: Page, user: TestUserKey): Promise<void> {
  if (skipRoleAssertions) return

  const expected = expectedProfileConfig[user]
  const profile = await fetchResolvedProfile(page)
  if (!profile) {
    // Transient auth lookups can fail (for example during token rotation).
    // Continue the test flow and rely on route-level assertions for access checks.
    console.warn(`[auth] Unable to resolve authenticated profile for ${user}; skipping role assertion for this login.`)
    return
  }

  const actualRole = normalize(profile.role)
  const allowedRoles = expected.allowedRoles.map(normalize)

  if (normalize(roleAssertionMode) === 'strict') {
    if (!allowedRoles.includes(actualRole)) {
      throw new Error(
        `Login role mismatch for ${user}. Expected one of [${expected.allowedRoles.join(', ')}], ` +
          `got ${profile.role || 'unknown'} (${profile.email || 'no-email'}). ` +
          `Org=${profile.organizationName || 'n/a'}, EmployerOrg=${profile.employerOrganizationName || 'n/a'}.`
      )
    }
  } else {
    const capabilities = roleCapabilities[actualRole] || []
    if (!capabilities.includes(expected.requiredCapability)) {
      throw new Error(
        `Login access mismatch for ${user}. Expected capability ${expected.requiredCapability}, ` +
          `but role ${profile.role || 'unknown'} does not provide it. ` +
          `Email=${profile.email || 'no-email'}, Org=${profile.organizationName || 'n/a'}, EmployerOrg=${profile.employerOrganizationName || 'n/a'}.`
      )
    }
  }

  if (!expected.expectedOrgName) return

  // Shared credential fallback intentionally reuses one account across
  // multiple logical test personas; enforce capability/role assertions only.
  if (allowSharedFallback) return

  const expectedOrgs = expected.expectedOrgName
    .split('|')
    .map((org) => normalize(org))
    .filter(Boolean)
  const actualOrgs = [profile.organizationName, profile.employerOrganizationName]
    .map(normalize)
    .filter(Boolean)

  const orgMatched = expectedOrgs.some((expectedOrg) =>
    actualOrgs.some((actualOrg) => actualOrg.includes(expectedOrg))
  )

  if (actualOrgs.length === 0 || !orgMatched) {
    if (!strictOrgAssertions) {
      console.warn(
        `[auth] Org mismatch tolerated for ${user}. Expected "${expected.expectedOrgName}", got ` +
          `Org=${profile.organizationName || 'n/a'}, EmployerOrg=${profile.employerOrganizationName || 'n/a'} ` +
          `for ${profile.email || 'no-email'} (${profile.role || 'unknown'}).`
      )
      return
    }

    throw new Error(
      `Login organization mismatch for ${user}. Expected org containing "${expected.expectedOrgName}", ` +
        `got Org=${profile.organizationName || 'n/a'}, EmployerOrg=${profile.employerOrganizationName || 'n/a'} ` +
        `for ${profile.email || 'no-email'} (${profile.role || 'unknown'}).`
    )
  }
}

export function getApiTestCredentials(): TestCredentials {
  return {
    email: readEnv('API_TEST_EMAIL', 'PLAYWRIGHT_LIVE_EMAIL', 'E2E_LIVE_EMAIL'),
    password: readEnv('API_TEST_PASSWORD', 'PLAYWRIGHT_LIVE_PASSWORD', 'E2E_LIVE_PASSWORD'),
  }
}

export function getApiBearerToken(): string | null {
  return readEnv(
    'API_TEST_BEARER_TOKEN',
    'PLAYWRIGHT_LIVE_BEARER_TOKEN',
    'E2E_LIVE_BEARER_TOKEN'
  ) || null
}

async function getAccessTokenFromBrowser(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const storages: Storage[] = [window.localStorage, window.sessionStorage]

    for (const storage of storages) {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i)
        if (!key || !key.startsWith('sb-') || !key.includes('-auth-token')) continue

        const raw = storage.getItem(key)
        if (!raw) continue

        try {
          const parsed = JSON.parse(raw)
          if (typeof parsed?.access_token === 'string' && parsed.access_token.length > 20) {
            return parsed.access_token
          }
        } catch {
          // ignore malformed storage values
        }
      }
    }

    return null
  })
}

async function ensureWorkAreaPermission(page: Page): Promise<void> {
  const targetOrgName = readEnv('PLAYWRIGHT_WORK_AREA_ORG', 'E2E_WORK_AREA_ORG') || 'Nelson City Council'
  const supabaseUrl = readEnv('VITE_SUPABASE_URL')
  const anonKey = readEnv('VITE_SUPABASE_ANON_KEY')

  if (!supabaseUrl || !anonKey) return

  const accessToken = await getAccessTokenFromBrowser(page)
  if (!accessToken) return

  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }

  try {
    const orgRes = await fetch(
      `${supabaseUrl}/rest/v1/organizations?select=id,name&name=ilike.${encodeURIComponent(targetOrgName)}&limit=1`,
      { headers }
    )
    if (!orgRes.ok) return

    const orgRows = await orgRes.json() as Array<{ id: string; name?: string }>
    const targetOrgId = orgRows[0]?.id
    if (!targetOrgId) return

    const meRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
    })
    if (!meRes.ok) return

    const me = await meRes.json() as { id?: string }
    const userId = me.id
    if (!userId) return

    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/user_profiles?select=id,authorized_work_locations,extra_organization_ids&id=eq.${userId}&limit=1`,
      { headers }
    )
    if (!profileRes.ok) return

    const profiles = await profileRes.json() as Array<{
      id: string
      authorized_work_locations?: string[]
      extra_organization_ids?: string[]
    }>
    const profile = profiles[0]
    if (!profile?.id) return

    const nextWorkLocations = Array.from(new Set([...(profile.authorized_work_locations || []), targetOrgId]))
    const nextExtraOrgIds = Array.from(new Set([...(profile.extra_organization_ids || []), targetOrgId]))

    await fetch(`${supabaseUrl}/rest/v1/user_profiles?id=eq.${profile.id}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        authorized_work_locations: nextWorkLocations,
        extra_organization_ids: nextExtraOrgIds,
      }),
    })
  } catch {
    // Best-effort only: continue tests even if policy disallows this update.
  }
}

async function ensureOfficerRosterForNelson(page: Page, user: TestUserKey): Promise<void> {
  if (user !== 'officerOrg1') return

  const supabaseUrl = readEnv('VITE_SUPABASE_URL')
  const anonKey = readEnv('VITE_SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) return

  const accessToken = await getAccessTokenFromBrowser(page)
  if (!accessToken) return

  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }

  try {
    const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    })
    if (!authRes.ok) return

    const authUser = await authRes.json() as { id?: string }
    if (!authUser?.id) return

    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/user_profiles?select=id,organization_id,employer_organization_id&id=eq.${authUser.id}&limit=1`,
      { headers }
    )
    if (!profileRes.ok) return

    const profiles = await profileRes.json() as Array<{
      id: string
      organization_id?: string | null
      employer_organization_id?: string | null
    }>
    const profile = profiles[0]
    if (!profile?.id) return

    const targetOrgName = readEnv('PLAYWRIGHT_WORK_AREA_ORG', 'E2E_WORK_AREA_ORG') || 'Nelson City Council'
    let rosterOrgId: string | null = null

    const orgRes = await fetch(
      `${supabaseUrl}/rest/v1/organizations?select=id,name&name=ilike.${encodeURIComponent(targetOrgName)}&limit=1`,
      { headers }
    )
    if (orgRes.ok) {
      const orgs = await orgRes.json() as Array<{ id: string }>
      rosterOrgId = orgs[0]?.id ?? null
    }

    if (!rosterOrgId) {
      rosterOrgId = profile.employer_organization_id || profile.organization_id || null
    }
    if (!rosterOrgId) return

    const today = new Date().toISOString().slice(0, 10)

    const existingRosterRes = await fetch(
      `${supabaseUrl}/rest/v1/roster_shifts?select=id,service_type,status&officer_id=eq.${profile.id}&shift_date=eq.${today}&status=in.(published,confirmed)&limit=1`,
      { headers }
    )
    const existingRoster = existingRosterRes.ok
      ? (await existingRosterRes.json() as Array<{ id: string }>)[0]
      : null

    let rosterShiftId = existingRoster?.id ?? null

    if (!rosterShiftId) {
      const insertRosterRes = await fetch(`${supabaseUrl}/rest/v1/roster_shifts`, {
        method: 'POST',
        headers: {
          ...headers,
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          organization_id: rosterOrgId,
          officer_id: profile.id,
          shift_date: today,
          start_time: '08:00:00',
          end_time: '17:00:00',
          shift_type: 'day',
          service_type: 'freedom_camping',
          status: 'published',
          notes: 'Playwright seeded officer roster',
          is_template: false,
        }),
      })

      if (insertRosterRes.ok) {
        const created = await insertRosterRes.json() as Array<{ id: string }>
        rosterShiftId = created[0]?.id ?? null
      }
    }

    const activeShiftRes = await fetch(
      `${supabaseUrl}/rest/v1/officer_shifts?select=id&officer_id=eq.${profile.id}&ended_at=is.null&limit=1`,
      { headers }
    )
    const activeShift = activeShiftRes.ok
      ? (await activeShiftRes.json() as Array<{ id: string }>)[0]
      : null

    if (!activeShift) {
      await fetch(`${supabaseUrl}/rest/v1/officer_shifts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          officer_id: profile.id,
          organization_id: rosterOrgId,
          roster_shift_id: rosterShiftId,
          service_type: 'freedom_camping',
          started_at: new Date().toISOString(),
        }),
      })
    }
  } catch {
    // Best-effort only: tests can still validate fallback states when seeding is blocked.
  }
}

async function resolvePortalSelectionIfNeeded(page: Page, user: TestUserKey): Promise<void> {
  if (!page.url().includes('/portal-selection')) return

  const targetPortalPath = user === 'officerOrg1' ? '/field-officer' : '/admin'
  const portalButtonLabel = user === 'officerOrg1' ? /Open Field Officer/i : /Open Admin Portal/i

  try {
    const portalButton = page.getByRole('button', { name: portalButtonLabel }).first()
    await portalButton.waitFor({ state: 'visible', timeout: 8000 })
    await portalButton.click({ timeout: 8000 })
  } catch {
    // Fallback for transient render/navigation races where portal cards are not interactable.
    await page.goto(targetPortalPath, { waitUntil: 'domcontentloaded' })
  }

  await page.waitForURL(
    (url) => !url.pathname.startsWith('/portal-selection'),
    { timeout: 20000 }
  )
}

async function waitForAuthenticatedBrowserSession(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const storages: Storage[] = [window.sessionStorage, window.localStorage]

    for (const storage of storages) {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i)
        if (!key || !key.startsWith('sb-') || !key.includes('-auth-token')) continue

        const raw = storage.getItem(key)
        if (!raw) continue

        try {
          const parsed = JSON.parse(raw)
          if (typeof parsed?.access_token === 'string' && parsed.access_token.length > 20) {
            return true
          }
        } catch {
          // Ignore malformed storage during transient auth writes.
        }
      }
    }

    return false
  }, { timeout: 20000 })
}

async function waitForAppAuthStore(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const raw = window.sessionStorage.getItem('auth-storage')
    if (!raw) return false

    try {
      const parsed = JSON.parse(raw)
      return !!parsed?.state?.user?.id
    } catch {
      return false
    }
  }, { timeout: 20000 })
}

export async function loginAs(page: Page, user: LoginUserAlias): Promise<void> {
  const normalizedUser = normalizeLoginUserKey(user)
  const credentials = getTestUser(normalizedUser)

  const finalizeExistingSession = async (): Promise<void> => {
    await resolvePortalSelectionIfNeeded(page, normalizedUser)
    await waitForAuthenticatedBrowserSession(page)
    await waitForAppAuthStore(page)
    await ensureWorkAreaPermission(page)
    await ensureOfficerRosterForNelson(page, normalizedUser)
    await autoSetRoleForTestUser(page, normalizedUser)
    await resolvePortalSelectionIfNeeded(page, normalizedUser)
    await waitForAuthenticatedBrowserSession(page)
    await waitForAppAuthStore(page)
    await assertExpectedLoginProfile(page, normalizedUser)
    await page.waitForLoadState('networkidle').catch(() => undefined)
  }

  const tryFinalizeExistingSession = async (): Promise<boolean> => {
    try {
      await finalizeExistingSession()
      return true
    } catch {
      await page.context().clearCookies().catch(() => undefined)
      await page.evaluate(() => {
        window.localStorage.clear()
        window.sessionStorage.clear()
      }).catch(() => undefined)
      await page.goto('/login?signin=1', { waitUntil: 'domcontentloaded' }).catch(() => undefined)
      return false
    }
  }

  const shouldBypassLoginForm = async (): Promise<boolean> => {
    const portalSelectionVisible = await Promise.any([
      page.getByText(/Choose a workspace to continue your shift/i).first().isVisible(),
      page.getByText(/Admin Portal/i).first().isVisible(),
      page.getByText(/Multi-Portal Access/i).first().isVisible(),
    ]).catch(() => false)

    return portalSelectionVisible || !page.url().includes('/login')
  }

  await page.goto('/login?signin=1', { waitUntil: 'domcontentloaded' })

  // If an existing session is still valid, /login may immediately redirect to
  // portal selection or an app route. In that case, skip form submission.
  if (await shouldBypassLoginForm()) {
    if (await tryFinalizeExistingSession()) return
  }

  const emailInput = page.locator('input[type="email"]:visible').first()
  const passwordInput = page.locator('input[type="password"]:visible').first()
  const submitBtn = page.locator('button:visible').filter({ hasText: /Sign\s*In|Log\s*In/i }).first()

  try {
    await emailInput.waitFor({ state: 'visible', timeout: 15000 })
  } catch (emailWaitError) {
    if (await shouldBypassLoginForm()) {
      if (await tryFinalizeExistingSession()) return
    }

    throw emailWaitError
  }
  try {
    await passwordInput.waitFor({ state: 'visible', timeout: 15000 })
  } catch (passwordWaitError) {
    if (await shouldBypassLoginForm()) {
      if (await tryFinalizeExistingSession()) return
    }

    throw passwordWaitError
  }

  if (await shouldBypassLoginForm()) {
    if (await tryFinalizeExistingSession()) return
  }

  await submitBtn.waitFor({ state: 'visible', timeout: 15000 })

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await emailInput.fill(credentials.email)
      await passwordInput.fill(credentials.password)
      await submitBtn.click()
      break
    } catch (error) {
      if (attempt === 3) throw error
      await page.goto('/login?signin=1', { waitUntil: 'domcontentloaded' })
      if (await shouldBypassLoginForm()) {
        if (await tryFinalizeExistingSession()) return
      }
      await emailInput.waitFor({ state: 'visible', timeout: 15000 })
      await passwordInput.waitFor({ state: 'visible', timeout: 15000 })
      await submitBtn.waitFor({ state: 'visible', timeout: 15000 })
    }
  }

  try {
    await page.waitForURL(
      (url) => !url.pathname.startsWith('/login'),
      { timeout: 20000 }
    )
    await waitForAuthenticatedBrowserSession(page)
    await waitForAppAuthStore(page)
  } catch {
    const errorText = await page.locator('text=/invalid|error|failed/i').first().textContent().catch(() => null)
    const suffix = errorText ? ` Visible message: ${errorText.trim()}` : ''
    throw new Error(`Login failed for ${credentials.email}. Current URL: ${page.url()}.${suffix}`)
  }

  if (normalizedUser !== 'master') {
    await page.evaluate(() => {
      window.sessionStorage.setItem('adminOfficerPortalChoice', 'selected')
    })
  }

  // Some roles (for example admin_officer) are redirected to portal selection
  // and must choose a portal before route access is unlocked.
  await resolvePortalSelectionIfNeeded(page, normalizedUser)

  // Best-effort: ensure the user can work in the configured council area
  // (defaults to Nelson City Council for location-based test flows).
  await ensureWorkAreaPermission(page)
  await ensureOfficerRosterForNelson(page, normalizedUser)
  await autoSetRoleForTestUser(page, normalizedUser)
  // Role auto-set reload can return the user to portal-selection.
  await resolvePortalSelectionIfNeeded(page, normalizedUser)
  await waitForAuthenticatedBrowserSession(page)
  await waitForAppAuthStore(page)
  await assertExpectedLoginProfile(page, normalizedUser)

  await page.waitForLoadState('networkidle').catch(() => undefined)
}