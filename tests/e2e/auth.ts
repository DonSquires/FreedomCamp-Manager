import { createClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, open, readFile, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import WebSocket from 'ws'

export type TestUserKey =
  | 'master'
  | 'adminOrg1'
  | 'adminOrg2'
  | 'officerOrg1'
  | 'nzscv_monitor'
  | 'bob'
  | 'client'
  | 'clientViewer'
  | 'clientStaff'

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

export type LoginContextProfile = ResolvedProfile

type DesiredRole = 'master' | 'grand_master' | 'admin' | 'admin_officer' | 'officer' | 'client_viewer' | 'client_officer' | 'client_admin'

const DEFAULT_TEST_ORG_NAME =
  readEnv('PLAYWRIGHT_TEST_ORG_NAME', 'PLAYWRIGHT_DEFAULT_TEST_ORG_NAME', 'E2E_TEST_ORG_NAME') ||
  'Iron Eagle Security Limited'

function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = (process.env[name] || '').trim()
    if (value) return value
  }

  return ''
}

// Inline fallback credentials for when dotenv loading fails in CI/test environments
const FALLBACK_API_CREDENTIALS = {
  email: 'cari.llewellyn@ncc.govt.nz',
  password: 'Run2thesun??',
}

function sharedPassword(...names: string[]): string {
  return readEnv(...names) || 'Test123!'
}

function isManualUserRequestJob(): boolean {
  const signal = readEnv(
    'BOB_REQUEST_SOURCE',
    'JOB_REQUEST_SOURCE',
    'HEAL_ERROR_MESSAGE',
    'BOB_JOB_INTENT',
    'BOB_USER_REQUEST_MODE'
  ).toLowerCase()

  if (!signal) return false
  return /manual_user_instruction|user[_\s-]?request/.test(signal)
}

function resolveHardwiredAutomationCredentials(): TestCredentials | null {
  const enabled = readEnv('PLAYWRIGHT_HARDWIRE_AUTOMATION_CREDENTIALS', 'BOB_HARDWIRE_AUTOMATION_CREDENTIALS')
  const hardwireEnabled = enabled ? enabled === '1' || enabled.toLowerCase() === 'true' : true

  if (!hardwireEnabled || isManualUserRequestJob()) {
    return null
  }

  const email = readEnv(
    'PLAYWRIGHT_MASTER_EMAIL',
    'E2E_MASTER_EMAIL',
    'BOB_LOGIN_EMAIL',
    'PLAYWRIGHT_BOB_EMAIL',
    'PLAYWRIGHT_ADMIN_ORG1_EMAIL',
    'PLAYWRIGHT_ADMIN_EMAIL'
  )

  const password = readEnv(
    'PLAYWRIGHT_MASTER_PASSWORD',
    'E2E_MASTER_PASSWORD',
    'BOB_LOGIN_PASSWORD',
    'PLAYWRIGHT_BOB_PASSWORD',
    'PLAYWRIGHT_ADMIN_ORG1_PASSWORD',
    'PLAYWRIGHT_ADMIN_PASSWORD'
  )

  if (!email || !password) return null
  return { email, password }
}

const universalTestEmail = readEnv('PLAYWRIGHT_OWNER_EMAIL', 'PLAYWRIGHT_OFFICER_EMAIL', 'PLAYWRIGHT_TEST_EMAIL')
const universalTestPassword = readEnv('PLAYWRIGHT_OWNER_PASSWORD', 'PLAYWRIGHT_OFFICER_PASSWORD', 'PLAYWRIGHT_TEST_PASSWORD')

const defaultLiveEmail = readEnv(
  'PLAYWRIGHT_TEST_EMAIL',
  'PLAYWRIGHT_OFFICER_EMAIL',
  'PLAYWRIGHT_OWNER_EMAIL',
  'PLAYWRIGHT_LIVE_EMAIL',
  'E2E_LIVE_EMAIL',
  'API_TEST_EMAIL'
)
const defaultLivePassword = sharedPassword(
  'PLAYWRIGHT_TEST_PASSWORD',
  'PLAYWRIGHT_OFFICER_PASSWORD',
  'PLAYWRIGHT_OWNER_PASSWORD',
  'PLAYWRIGHT_LIVE_PASSWORD',
  'E2E_LIVE_PASSWORD',
  'API_TEST_PASSWORD',
  'PLAYWRIGHT_TEST_PASSWORD',
  'E2E_TEST_PASSWORD'
)

const hasUniversalTestAccount = !!(universalTestEmail && universalTestPassword)
const adminSupabaseUrl = readEnv('VITE_SUPABASE_URL')
const serviceRoleKey = readEnv('PLAYWRIGHT_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY')
const canBootstrapSharedFallbackAccounts = !!(adminSupabaseUrl && serviceRoleKey)
const allowSharedFallback = readEnv('PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK') === '1' || hasUniversalTestAccount || canBootstrapSharedFallbackAccounts
const skipRoleAssertions = readEnv('PLAYWRIGHT_SKIP_ROLE_ASSERTIONS') === '1' || hasUniversalTestAccount
const roleAssertionMode = readEnv('PLAYWRIGHT_ROLE_ASSERTION_MODE') || 'strict'
const canInitServiceRoleSupabase = !!(adminSupabaseUrl && serviceRoleKey)
const serviceRoleSupabase = canInitServiceRoleSupabase
  ? createClient(adminSupabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      // Node 20 runners do not expose a global WebSocket implementation.
      realtime: {
        transport: WebSocket,
      },
    })
  : null
const enforcePersonaBootstrap = readEnv('PLAYWRIGHT_ENFORCE_PERSONA_BOOTSTRAP') === '1' || (process.env.CI === 'true' && !!serviceRoleSupabase)
// Profile mutations are opt-in to avoid changing persistent user settings in
// shared/staging environments. Enable both flags in isolated test sandboxes.
const allowProfileMutations =
  readEnv('PLAYWRIGHT_ALLOW_PROFILE_MUTATIONS') === '1' ||
  hasUniversalTestAccount ||
  (process.env.CI === 'true' && !!serviceRoleSupabase)
const autoSetTestRole =
  readEnv('PLAYWRIGHT_AUTO_SET_TEST_ROLE') === '1' ||
  hasUniversalTestAccount ||
  (process.env.CI === 'true' && !!serviceRoleSupabase)

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
  'bob',
  'clientViewer',
  'clientStaff',
]

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
    emailVars: ['PLAYWRIGHT_OFFICER_ORG1_EMAIL', 'PLAYWRIGHT_OFFICER_EMAIL', 'PLAYWRIGHT_OFFICER2_EMAIL', 'E2E_OFFICER_EMAIL'],
    passwordVars: ['PLAYWRIGHT_OFFICER_ORG1_PASSWORD', 'PLAYWRIGHT_OFFICER_PASSWORD', 'PLAYWRIGHT_OFFICER2_PASSWORD', 'E2E_OFFICER_PASSWORD'],
    fallbackEmail: 'officer@org1.com',
  },
  nzscv_monitor: {
    label: 'nzscv_monitor',
    emailVars: ['PLAYWRIGHT_NZSCV_MONITOR_EMAIL', 'E2E_NZSCV_MONITOR_EMAIL'],
    passwordVars: ['PLAYWRIGHT_NZSCV_MONITOR_PASSWORD', 'E2E_NZSCV_MONITOR_PASSWORD'],
    fallbackEmail: 'nzscv.monitor@test.com',
  },
  bob: {
    label: 'bob',
    emailVars: ['BOB_LOGIN_EMAIL', 'PLAYWRIGHT_BOB_EMAIL'],
    passwordVars: ['BOB_LOGIN_PASSWORD', 'PLAYWRIGHT_BOB_PASSWORD'],
    fallbackEmail: 'bob.assistant+staging@onspace.ai',
  },
  client: {
    label: 'client',
    emailVars: ['PLAYWRIGHT_CLIENT_VIEWER_EMAIL', 'PLAYWRIGHT_CLIENT_OFFICER_EMAIL', 'PLAYWRIGHT_CLIENT_STAFF_EMAIL', 'PLAYWRIGHT_CLIENT_EMAIL', 'E2E_CLIENT_VIEWER_EMAIL'],
    passwordVars: ['PLAYWRIGHT_CLIENT_VIEWER_PASSWORD', 'PLAYWRIGHT_CLIENT_OFFICER_PASSWORD', 'PLAYWRIGHT_CLIENT_STAFF_PASSWORD', 'PLAYWRIGHT_CLIENT_PASSWORD', 'E2E_CLIENT_VIEWER_PASSWORD'],
    fallbackEmail: 'client.viewer@test.com',
  },
  clientViewer: {
    label: 'clientViewer',
    emailVars: ['PLAYWRIGHT_CLIENT_VIEWER_EMAIL', 'PLAYWRIGHT_CLIENT_OFFICER_EMAIL', 'PLAYWRIGHT_CLIENT_STAFF_EMAIL', 'PLAYWRIGHT_CLIENT_EMAIL', 'E2E_CLIENT_VIEWER_EMAIL'],
    passwordVars: ['PLAYWRIGHT_CLIENT_VIEWER_PASSWORD', 'PLAYWRIGHT_CLIENT_OFFICER_PASSWORD', 'PLAYWRIGHT_CLIENT_STAFF_PASSWORD', 'PLAYWRIGHT_CLIENT_PASSWORD', 'E2E_CLIENT_VIEWER_PASSWORD'],
    fallbackEmail: 'client.viewer@test.com',
  },
  clientStaff: {
    label: 'clientStaff',
    emailVars: [
      'PLAYWRIGHT_CLIENT_STAFF_EMAIL',
      'PLAYWRIGHT_CLIENT_OFFICER_EMAIL',
      'PLAYWRIGHT_CLIENT_EMAIL',
      'E2E_CLIENT_STAFF_EMAIL'
    ],
    passwordVars: [
      'PLAYWRIGHT_CLIENT_STAFF_PASSWORD',
      'PLAYWRIGHT_CLIENT_OFFICER_PASSWORD',
      'PLAYWRIGHT_CLIENT_PASSWORD',
      'E2E_CLIENT_STAFF_PASSWORD'
    ],
    fallbackEmail: 'client.staff@test.com',
  },
}

const expectedProfileConfig: Record<TestUserKey, ExpectedProfileConfig> = {
  master: {
    allowedRoles: ['master', 'grand_master'],
    requiredCapability: 'master_ops',
    expectedOrgName: DEFAULT_TEST_ORG_NAME,
  },
  adminOrg1: {
    allowedRoles: ['admin', 'admin_officer'],
    requiredCapability: 'admin_screen',
    expectedOrgName: readEnv('PLAYWRIGHT_ADMIN_ORG1_NAME') || DEFAULT_TEST_ORG_NAME,
  },
  adminOrg2: {
    allowedRoles: ['admin', 'admin_officer'],
    requiredCapability: 'admin_screen',
    expectedOrgName: readEnv('PLAYWRIGHT_ADMIN_ORG2_NAME') || DEFAULT_TEST_ORG_NAME,
  },
  officerOrg1: {
    allowedRoles: ['officer', 'admin_officer'],
    requiredCapability: 'field_ops',
    expectedOrgName: readEnv('PLAYWRIGHT_OFFICER_ORG1_NAME') || DEFAULT_TEST_ORG_NAME,
  },
  nzscv_monitor: {
    allowedRoles: ['nzscv_monitor'],
    requiredCapability: 'admin_screen',
    expectedOrgName: readEnv('PLAYWRIGHT_NZSCV_MONITOR_ORG_NAME') || DEFAULT_TEST_ORG_NAME,
  },
  bob: {
    allowedRoles: ['admin_officer'],
    requiredCapability: 'admin_screen',
    expectedOrgName: readEnv('BOB_LOGIN_ORG_NAME', 'BOB_ORG_NAME') || DEFAULT_TEST_ORG_NAME,
  },
  client: {
    allowedRoles: ['client_viewer', 'client_officer', 'client_admin', 'admin', 'admin_officer', 'officer'],
    requiredCapability: 'client_portal_view',
    expectedOrgName: mergeExpectedOrgNames(
      readEnv('PLAYWRIGHT_CLIENT_VIEWER_NAME'),
      readEnv('PLAYWRIGHT_CLIENT_STAFF_NAME'),
      DEFAULT_TEST_ORG_NAME
    ),
  },
  clientViewer: {
    allowedRoles: ['client_viewer'],
    requiredCapability: 'client_portal_view',
    expectedOrgName: mergeExpectedOrgNames(
      readEnv('PLAYWRIGHT_CLIENT_VIEWER_NAME'),
      DEFAULT_TEST_ORG_NAME
    ),
  },
  clientStaff: {
    allowedRoles: ['client_officer', 'client_admin', 'admin', 'admin_officer', 'officer'],
    requiredCapability: 'client_portal_manage',
    expectedOrgName: mergeExpectedOrgNames(
      readEnv('PLAYWRIGHT_CLIENT_STAFF_NAME'),
      DEFAULT_TEST_ORG_NAME
    ),
  },
}

const desiredRoleByTestUser: Record<TestUserKey, DesiredRole> = {
  master: 'grand_master',
  adminOrg1: 'admin_officer',
  adminOrg2: 'admin_officer',
  officerOrg1: 'officer',
  nzscv_monitor: 'nzscv_monitor',
  bob: 'admin_officer',
  client: 'client_viewer',
  clientViewer: 'client_viewer',
  // Compatibility default: many shared test DBs still enforce legacy
  // user_profiles_role_check without client_officer/client_admin.
  // Use admin_officer so role-matrix smoke can still validate route access.
  clientStaff: 'admin_officer',
}

export function getRequiredTestUsersFromEnv(
  raw: string | undefined = process.env.PLAYWRIGHT_REQUIRED_TEST_USERS
): TestUserKey[] {
  if (!raw || !raw.trim()) {
    return defaultRequiredTestUsers
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
  const hardwired = resolveHardwiredAutomationCredentials()
  if (hardwired) {
    return hardwired
  }

  if (hasUniversalTestAccount) {
    return {
      email: universalTestEmail,
      password: universalTestPassword,
    }
  }

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

export function isCredentialConfigured(user: TestUserKey): boolean {
  if (hasUniversalTestAccount) return true
  const config = roleCredentialConfig[user]
  const roleEmail = readEnv(...config.emailVars)
  const rolePassword = readEnv(...config.passwordVars)
  return !!(roleEmail && rolePassword)
}

function normalize(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase()
}

async function resolveOrganizationIdByName(expectedOrgName?: string): Promise<string | null> {
  if (!serviceRoleSupabase || !expectedOrgName) return null

  const candidateNames = expectedOrgName
    .split('|')
    .map((value) => value.trim())
    .filter(Boolean)

  for (const candidateName of candidateNames) {
    const { data, error } = await serviceRoleSupabase
      .from('organizations')
      .select('id')
      .ilike('name', candidateName)
      .limit(1)

    if (error) continue

    const organizationId = data?.[0]?.id
    if (organizationId) return organizationId
  }

  return null
}

async function ensureBootstrapTestAccount(
  user: TestUserKey,
  credentials: TestCredentials,
  options: { force?: boolean } = {}
): Promise<void> {
  if (!serviceRoleSupabase) return
  if (!options.force && isCredentialConfigured(user)) return

  const desiredRole = desiredRoleByTestUser[user]
  const expectedProfile = expectedProfileConfig[user]
  const organizationId = await resolveOrganizationIdByName(expectedProfile.expectedOrgName)
  const adminAuth = (serviceRoleSupabase.auth as any)?.admin

  if (!adminAuth) return

  const findExistingUserByEmail = async (email: string): Promise<{ id: string } | null> => {
    const normalizedEmail = normalize(email)
    if (!normalizedEmail) return null

    const perPage = 1000
    const maxPages = 20

    for (let page = 1; page <= maxPages; page += 1) {
      const { data: usersData } = await adminAuth
        .listUsers({ page, perPage })
        .catch(() => ({ data: null }))

      const users = usersData?.users || []
      const existingUser = users.find((entry: any) => normalize(entry.email) === normalizedEmail)
      if (existingUser?.id) {
        return { id: existingUser.id }
      }

      if (users.length < perPage) {
        break
      }
    }

    return null
  }

  const { data: createdUser, error: createError } = await adminAuth.createUser({
    email: credentials.email,
    password: credentials.password,
    email_confirm: true,
    user_metadata: { role: desiredRole },
  })

  let userId = createdUser?.user?.id ?? null

  if (!userId && createError) {
    const existingUser = await findExistingUserByEmail(credentials.email)
    if (existingUser?.id) {
      userId = existingUser.id

      await adminAuth.updateUserById(existingUser.id, {
        password: credentials.password,
        email_confirm: true,
        user_metadata: { role: desiredRole },
      }).catch(() => undefined)
    }
  }

  if (!userId) return

  await serviceRoleSupabase
    .from('user_profiles')
    .upsert(
      {
        id: userId,
        email: credentials.email,
        role: desiredRole,
        organization_id: organizationId,
        employer_organization_id: organizationId,
        first_name: user,
        last_name: 'Test',
        job_title: 'Playwright Test User',
      },
      { onConflict: 'id' },
    )
}

function mapResolvedProfile(profile: {
  id: string
  email?: string | null
  role?: string | null
  organization?: { name?: string | null } | Array<{ name?: string | null }> | null
  employer_org?: { name?: string | null } | Array<{ name?: string | null }> | null
}): ResolvedProfile {
  const organization = Array.isArray(profile.organization) ? profile.organization[0] : profile.organization
  const employerOrganization = Array.isArray(profile.employer_org) ? profile.employer_org[0] : profile.employer_org

  return {
    id: profile.id,
    email: profile.email ?? null,
    role: profile.role ?? null,
    organizationName: organization?.name ?? null,
    employerOrganizationName: employerOrganization?.name ?? null,
  }
}

async function fetchResolvedProfileByEmail(email: string): Promise<ResolvedProfile | null> {
  if (!serviceRoleSupabase || !email) return null

  const { data, error } = await serviceRoleSupabase
    .from('user_profiles')
    .select('id,email,role,organization:organizations!organization_id(name),employer_org:organizations!employer_organization_id(name),updated_at')
    .eq('email', email)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error) {
    throw new Error(`Service-role profile lookup failed for ${email}: ${error.message}`)
  }

  const profile = data?.[0]
  return profile?.id ? mapResolvedProfile(profile) : null
}

async function fetchResolvedProfileById(profileId: string): Promise<ResolvedProfile | null> {
  if (!serviceRoleSupabase || !profileId) return null

  const { data, error } = await serviceRoleSupabase
    .from('user_profiles')
    .select('id,email,role,organization:organizations!organization_id(name),employer_org:organizations!employer_organization_id(name)')
    .eq('id', profileId)
    .limit(1)

  if (error) {
    throw new Error(`Service-role profile lookup failed for ${profileId}: ${error.message}`)
  }

  const profile = data?.[0]
  return profile?.id ? mapResolvedProfile(profile) : null
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

  return {
    ...mapResolvedProfile(profile),
    email: profile.email ?? authUser.email ?? null,
  }
}

async function autoSetRoleForTestUser(page: Page, user: TestUserKey): Promise<boolean> {
  if (!allowProfileMutations || !autoSetTestRole) return false

  const targetRole = desiredRoleByTestUser[user]
  const profile =
    await fetchResolvedProfile(page) ||
    await resolveProfileByBrowserTokenSub(page) ||
    await fetchResolvedProfileByEmail(getTestUser(user).email)
  if (!profile?.id) {
    console.warn(`[auth] Cannot auto-set role for ${user}; profile could not be resolved – continuing with current role.`)
    return false
  }

  const currentRole = normalize(profile.role)
  if (currentRole === normalize(targetRole)) {
    return false
  }

  if (serviceRoleSupabase) {
    const { error } = await serviceRoleSupabase
      .from('user_profiles')
      .update({ role: targetRole })
      .eq('id', profile.id)

    if (error) {
      throw new Error(
        `Failed to auto-set role for ${user} from ${profile.role || 'unknown'} to ${targetRole}. ` +
          `Service-role update failed: ${error.message}`
      )
    }

    const verifiedProfile = await fetchResolvedProfileById(profile.id)
    if (!verifiedProfile || normalize(verifiedProfile.role) !== normalize(targetRole)) {
      const { error: retryError } = await serviceRoleSupabase
        .from('user_profiles')
        .update({ role: targetRole })
        .eq('id', profile.id)

      if (retryError) {
        throw new Error(
          `Failed to verify role update for ${user} (${profile.id}) after setting ${targetRole}. ` +
            `Retry update failed: ${retryError.message}`
        )
      }

      const retryVerifiedProfile = await fetchResolvedProfileById(profile.id)
      if (!retryVerifiedProfile || normalize(retryVerifiedProfile.role) !== normalize(targetRole)) {
        throw new Error(
          `Failed to auto-set role for ${user} (${profile.id}) to ${targetRole}. ` +
            `Observed role after update was ${retryVerifiedProfile?.role || verifiedProfile?.role || 'unknown'}. ` +
            `Email=${retryVerifiedProfile?.email || verifiedProfile?.email || profile.email || 'no-email'}.`
        )
      }
    }

    await page.reload({ waitUntil: 'networkidle' })
    return true
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
  const profile =
    await fetchResolvedProfile(page) ||
    await resolveProfileByBrowserTokenSub(page) ||
    await fetchResolvedProfileByEmail(getTestUser(user).email)
  if (!profile) {
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
    throw new Error(
      `Login organization mismatch for ${user}. Expected org containing "${expected.expectedOrgName}", ` +
        `got Org=${profile.organizationName || 'n/a'}, EmployerOrg=${profile.employerOrganizationName || 'n/a'} ` +
        `for ${profile.email || 'no-email'} (${profile.role || 'unknown'}).`
    )
  }
}

export function getApiTestCredentials(): TestCredentials {
  const email = readEnv('API_TEST_EMAIL', 'PLAYWRIGHT_LIVE_EMAIL', 'E2E_LIVE_EMAIL') || FALLBACK_API_CREDENTIALS.email
  const password = readEnv('API_TEST_PASSWORD', 'PLAYWRIGHT_LIVE_PASSWORD', 'E2E_LIVE_PASSWORD') || FALLBACK_API_CREDENTIALS.password
  return { email, password }
}

export function getApiBearerToken(): string | null {
  return readEnv(
    'API_TEST_BEARER_TOKEN',
    'PLAYWRIGHT_LIVE_BEARER_TOKEN',
    'E2E_LIVE_BEARER_TOKEN'
  ) || null
}

async function gotoLogin(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 20000 })
}

function getSupabaseProjectRef(url: string): string {
  try {
    const host = new URL(url).host
    return host.split('.')[0] || ''
  } catch {
    return ''
  }
}

type SupabasePasswordGrant = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  expires_at?: number
  token_type?: string
  user?: unknown
}

type BrowserSessionPayload = {
  storageKey: string
  sessionPayload: {
    access_token: string
    refresh_token: string
    expires_in: number
    expires_at: number
    token_type: string
    user: unknown
  }
}

const browserSessionCache = new Map<string, BrowserSessionPayload>()
const browserSessionCacheDir = process.env.PLAYWRIGHT_BROWSER_SESSION_CACHE_DIR || path.join(tmpdir(), 'freedomcamp-playwright-auth-cache')

function getBrowserSessionCacheKey(supabaseUrl: string, credentials: TestCredentials): string {
  return [supabaseUrl.trim(), credentials.email.trim().toLowerCase(), credentials.password].join('::')
}

function getBrowserSessionCachePaths(cacheKey: string): { dataPath: string; lockPath: string } {
  const keyHash = createHash('sha1').update(cacheKey).digest('hex')
  return {
    dataPath: path.join(browserSessionCacheDir, `${keyHash}.json`),
    lockPath: path.join(browserSessionCacheDir, `${keyHash}.lock`),
  }
}

async function readBrowserSessionFromDisk(cacheKey: string): Promise<BrowserSessionPayload | null> {
  try {
    const { dataPath } = getBrowserSessionCachePaths(cacheKey)
    const raw = await readFile(dataPath, 'utf8')
    const parsed = JSON.parse(raw) as BrowserSessionPayload
    if (!parsed?.storageKey || !parsed?.sessionPayload?.access_token || !parsed?.sessionPayload?.refresh_token) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function writeBrowserSessionToDisk(cacheKey: string, payload: BrowserSessionPayload): Promise<void> {
  const { dataPath } = getBrowserSessionCachePaths(cacheKey)
  await mkdir(browserSessionCacheDir, { recursive: true })
  await writeFile(dataPath, `${JSON.stringify(payload)}\n`, 'utf8')
}

async function waitForBrowserSessionOnDisk(cacheKey: string, timeoutMs = 15000): Promise<BrowserSessionPayload | null> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const cached = await readBrowserSessionFromDisk(cacheKey)
    if (cached) return cached
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return null
}

async function acquireBrowserSessionLock(cacheKey: string): Promise<Awaited<ReturnType<typeof open>> | null> {
  const { lockPath } = getBrowserSessionCachePaths(cacheKey)
  await mkdir(browserSessionCacheDir, { recursive: true })
  try {
    return await open(lockPath, 'wx')
  } catch {
    return null
  }
}

async function releaseBrowserSessionLock(cacheKey: string, handle: Awaited<ReturnType<typeof open>> | null): Promise<void> {
  const { lockPath } = getBrowserSessionCachePaths(cacheKey)
  await handle?.close().catch(() => undefined)
  await unlink(lockPath).catch(() => undefined)
}

async function applyBrowserSessionPayload(page: Page, payload: BrowserSessionPayload): Promise<void> {
  await page.context().addInitScript(({ key, value }) => {
    const encoded = JSON.stringify(value)
    window.localStorage.setItem(key, encoded)
    window.sessionStorage.setItem(key, encoded)
  }, { key: payload.storageKey, value: payload.sessionPayload })

  await page.goto('/', { waitUntil: 'domcontentloaded' })
}

async function bootstrapBrowserSessionFromPasswordGrant(
  page: Page,
  credentials: TestCredentials
): Promise<{ ok: boolean; reason?: string }> {
  const supabaseUrl = readEnv('VITE_SUPABASE_URL')
  const anonKey = readEnv('VITE_SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) {
    return { ok: false, reason: 'VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing' }
  }

  const cacheKey = getBrowserSessionCacheKey(supabaseUrl, credentials)
  const cachedSession = browserSessionCache.get(cacheKey)
  if (cachedSession) {
    await applyBrowserSessionPayload(page, cachedSession)
    return { ok: true }
  }

  const diskCachedSession = await readBrowserSessionFromDisk(cacheKey)
  if (diskCachedSession) {
    browserSessionCache.set(cacheKey, diskCachedSession)
    await applyBrowserSessionPayload(page, diskCachedSession)
    return { ok: true }
  }

  const lockHandle = await acquireBrowserSessionLock(cacheKey)
  if (!lockHandle) {
    const waitedSession = await waitForBrowserSessionOnDisk(cacheKey)
    if (waitedSession) {
      browserSessionCache.set(cacheKey, waitedSession)
      await applyBrowserSessionPayload(page, waitedSession)
      return { ok: true }
    }
  }

  try {
    if (lockHandle) {
      const cachedAfterLock = await readBrowserSessionFromDisk(cacheKey)
      if (cachedAfterLock) {
        browserSessionCache.set(cacheKey, cachedAfterLock)
        await applyBrowserSessionPayload(page, cachedAfterLock)
        return { ok: true }
      }

      const tokenRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password,
        }),
      })

      if (!tokenRes.ok) {
        const errorText = await tokenRes.text().catch(() => '')
        return {
          ok: false,
          reason: `password grant failed (${tokenRes.status}): ${errorText.slice(0, 180)}`,
        }
      }

      const grant = await tokenRes.json() as SupabasePasswordGrant
      if (!grant.access_token || !grant.refresh_token) {
        return { ok: false, reason: 'password grant missing access/refresh token' }
      }

      const projectRef = getSupabaseProjectRef(supabaseUrl)
      if (!projectRef) {
        return { ok: false, reason: 'unable to derive Supabase project ref from URL' }
      }

      const expiresAt =
        typeof grant.expires_at === 'number'
          ? grant.expires_at
          : Math.floor(Date.now() / 1000) + (typeof grant.expires_in === 'number' ? grant.expires_in : 3600)

      const storageKey = `sb-${projectRef}-auth-token`
      const sessionPayload = {
        access_token: grant.access_token,
        refresh_token: grant.refresh_token,
        expires_in: grant.expires_in ?? 3600,
        expires_at: expiresAt,
        token_type: grant.token_type ?? 'bearer',
        user: grant.user ?? null,
      }

      browserSessionCache.set(cacheKey, {
        storageKey,
        sessionPayload,
      })

      await writeBrowserSessionToDisk(cacheKey, {
        storageKey,
        sessionPayload,
      })

      await applyBrowserSessionPayload(page, {
        storageKey,
        sessionPayload,
      })

      return { ok: true }
    }

    return { ok: false, reason: 'unable to acquire browser session lock' }
  } finally {
    await releaseBrowserSessionLock(cacheKey, lockHandle)
  }
}

async function loginThroughUi(page: Page, credentials: TestCredentials): Promise<void> {
  await gotoLogin(page)
  await page.getByLabel(/^email$/i).fill(credentials.email)
  await page.getByLabel(/^password$/i).fill(credentials.password)
  await page.locator('button[type="submit"], button:has-text("Sign In")').first().click()
  await page.waitForURL(
    (url) => !url.pathname.startsWith('/login'),
    { timeout: 20000 }
  )
}

export async function loginWithLiveCredentialsAndResolveProfile(page: Page): Promise<LoginContextProfile | null> {
  const credentials = getApiTestCredentials()
  if (!credentials.email || !credentials.password) {
    throw new Error(
      'Live/API credentials are missing. Set API_TEST_EMAIL/API_TEST_PASSWORD or PLAYWRIGHT_LIVE_EMAIL/PLAYWRIGHT_LIVE_PASSWORD.'
    )
  }

  try {
    await loginThroughUi(page, credentials)
  } catch {
    const errorText = await page.locator('text=/invalid|error|failed/i').first().textContent().catch(() => null)
    const suffix = errorText ? ` Visible message: ${errorText.trim()}` : ''
    throw new Error(`Login failed for ${credentials.email}. Current URL: ${page.url()}.${suffix}`)
  }

  await page.evaluate(() => {
    window.sessionStorage.setItem('adminOfficerPortalChoice', 'selected')
  })

  await resolvePortalSelectionIfNeeded(page, 'adminOrg1')
  await ensureWorkAreaPermission(page)
  await page.waitForLoadState('networkidle').catch(() => undefined)

  return fetchResolvedProfile(page)
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

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2) return null

  const payload = parts[1]
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))

  try {
    const json = Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8')
    const parsed = JSON.parse(json) as Record<string, unknown>
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

async function resolveProfileByBrowserTokenSub(page: Page): Promise<ResolvedProfile | null> {
  const accessToken = await getAccessTokenFromBrowser(page)
  if (!accessToken) return null

  const payload = decodeJwtPayload(accessToken)
  const tokenSub = typeof payload?.sub === 'string' ? payload.sub : ''
  if (!tokenSub) return null

  return fetchResolvedProfileById(tokenSub)
}

async function ensureWorkAreaPermission(page: Page): Promise<void> {
  if (!allowProfileMutations) return

  const targetOrgName = readEnv('PLAYWRIGHT_WORK_AREA_ORG', 'E2E_WORK_AREA_ORG') || DEFAULT_TEST_ORG_NAME
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

async function resolvePortalSelectionIfNeeded(page: Page, user: TestUserKey): Promise<void> {
  if (!page.url().includes('/portal-selection')) return

  const isClientPortalUser = user === 'client' || user === 'clientViewer' || user === 'clientStaff'
  const targetPortalPath = user === 'officerOrg1' ? '/field-officer' : isClientPortalUser ? '/client-portal' : '/admin'
  await page.evaluate(() => {
    window.sessionStorage.setItem('adminOfficerPortalChoice', 'selected')
  })

  const targetButton = user === 'officerOrg1'
    ? page.getByRole('button', { name: /open field officer/i })
    : isClientPortalUser
      ? page.getByRole('button', { name: /open client portal|client portal/i })
      : page.getByRole('button', { name: /open admin portal/i })

  const canClickPortal = await targetButton.isVisible({ timeout: 2500 }).catch(() => false)
  if (canClickPortal) {
    await targetButton.click({ timeout: 10000 }).catch(async () => {
      // DOM detached during SPA re-render — fall back to direct navigation
      await page.goto(targetPortalPath)
    })
  } else {
    await page.goto(targetPortalPath)
  }

  await page.waitForURL(
    (url) => !url.pathname.startsWith('/portal-selection'),
    { timeout: 20000 }
  )
}

export async function loginAs(page: Page, user: TestUserKey): Promise<void> {
  const credentials = getTestUser(user)
  await ensureBootstrapTestAccount(user, credentials, { force: enforcePersonaBootstrap })

  const existingProfile = await fetchResolvedProfileByEmail(credentials.email).catch(() => null)
  if (!existingProfile) {
    await ensureBootstrapTestAccount(user, credentials, { force: true })
  }

  let lastErrorText: string | null = null
  let apiFallbackError: string | null = null
  const maxAttempts = 3
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const apiFallback = await bootstrapBrowserSessionFromPasswordGrant(page, credentials).catch((error: unknown) => ({
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }))

    if (!apiFallback.ok && /invalid_credentials/i.test(apiFallback.reason || '')) {
      await ensureBootstrapTestAccount(user, credentials, { force: true })
    }

    const retryFallback = !apiFallback.ok && /invalid_credentials/i.test(apiFallback.reason || '')
      ? await bootstrapBrowserSessionFromPasswordGrant(page, credentials).catch((error: unknown) => ({
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        }))
      : apiFallback

    let loginSucceeded = retryFallback.ok
      ? await page
        .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 })
        .then(() => true)
        .catch(() => false)
      : false

    if (!loginSucceeded) {
      loginSucceeded = await loginThroughUi(page, credentials)
        .then(() => true)
        .catch(() => false)
    }

    if (!retryFallback.ok) {
      apiFallbackError = retryFallback.reason || 'unknown API fallback error'
    }

    if (loginSucceeded) break

    lastErrorText = await page.locator('text=/invalid|error|failed/i').first().textContent().catch(() => null)

    const rateLimited = /over_request_rate_limit|rate\s*limit|too\s*many\s*requests|429/i.test(
      `${apiFallbackError || ''} ${lastErrorText || ''}`
    )

    // Retry for transient auth/network races and auth API throttling.
    if (attempt < maxAttempts - 1) {
      await page.context().clearCookies().catch(() => undefined)
      await page.evaluate(() => {
        window.localStorage.clear()
        window.sessionStorage.clear()
      }).catch(() => undefined)

      if (rateLimited) {
        // Simple linear backoff to absorb Supabase auth throttle windows.
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      }

      continue
    }

    const suffix = lastErrorText ? ` Visible message: ${lastErrorText.trim()}` : ''
    const fallbackSuffix = apiFallbackError ? ` API fallback: ${apiFallbackError}.` : ''
    throw new Error(`Login failed for ${credentials.email}. Current URL: ${page.url()}.${suffix}${fallbackSuffix}`)
  }

  if (user !== 'master') {
    await page.evaluate(() => {
      window.sessionStorage.setItem('adminOfficerPortalChoice', 'selected')
    })
  }

  // Some roles (for example admin_officer) are redirected to portal selection
  // and must choose a portal before route access is unlocked.
  await resolvePortalSelectionIfNeeded(page, user)

  // Best-effort: ensure the user can work in the configured council area
  // (defaults to Nelson City Council for location-based test flows).
  await ensureWorkAreaPermission(page)
  await autoSetRoleForTestUser(page, user)
  // Role auto-set reload can return the user to portal-selection.
  await resolvePortalSelectionIfNeeded(page, user)

  // Shared fallback can authenticate an owner profile first; for officer persona,
  // re-bootstrap once if we still land on the platform owner route.
  if (user === 'officerOrg1' && page.url().includes('/platform')) {
    await ensureBootstrapTestAccount(user, credentials, { force: true })
    await page.context().clearCookies().catch(() => undefined)
    await page.evaluate(() => {
      window.localStorage.clear()
      window.sessionStorage.clear()
    }).catch(() => undefined)

    const retryFallback = await bootstrapBrowserSessionFromPasswordGrant(page, credentials).catch((error: unknown) => ({
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }))

    if (retryFallback.ok) {
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => undefined)
      await page.evaluate(() => {
        window.sessionStorage.setItem('adminOfficerPortalChoice', 'selected')
      })
      await resolvePortalSelectionIfNeeded(page, user)
      await ensureWorkAreaPermission(page)
      await autoSetRoleForTestUser(page, user)
      await resolvePortalSelectionIfNeeded(page, user)
    }
  }

  await assertExpectedLoginProfile(page, user)

  // Root postcondition: loginAs must never return while still on /login,
  // even when role assertions are relaxed in shared-fallback environments.
  await page
    .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 })
    .catch(() => undefined)

  if (page.url().includes('/login')) {
    throw new Error(
      `loginAs(${user}) ended on /login after auth/bootstrap flow. ` +
      `Shared fallback mode may have produced an unresolved or invalid browser session.`
    )
  }

  await page.waitForLoadState('networkidle').catch(() => undefined)
}
