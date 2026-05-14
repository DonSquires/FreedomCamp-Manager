#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const ALLOWED_ROLES = new Set([
  'officer',
  'admin',
  'admin_officer',
  'master',
  'grand_master',
  'nzscv_monitor',
  'client_viewer',
  'client_officer',
  'client_admin',
])

function arg(name, fallback = '') {
  const key = `--${name}`
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '')
    if (token === key) return String(argv[i + 1] || fallback)
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1) || fallback
  }
  return fallback
}

function hasFlag(name) {
  const key = `--${name}`
  return process.argv.slice(2).some((token) => token === key)
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@')
  if (!local || !domain) return 'unknown'
  if (local.length <= 2) return `${local[0] || '*'}*@${domain}`
  return `${local[0]}${'*'.repeat(Math.max(1, local.length - 2))}${local[local.length - 1]}@${domain}`
}

async function resolveUserIdByEmail(admin, email) {
  let page = 1
  const perPage = 200

  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`Unable to list existing users: ${error.message}`)

    const users = data?.users || []
    const found = users.find((u) => String(u.email || '').toLowerCase() === email.toLowerCase())
    if (found?.id) return found.id

    if (users.length < perPage) break
    page += 1
  }

  return null
}

async function main() {
  if (hasFlag('help')) {
    console.log('Create or update Bob login account')
    console.log('')
    console.log('Usage:')
    console.log('  node scripts/create-bob-login.mjs --email <email> --password <password> --org-id <uuid> [--role admin_officer] [--first-name Bob] [--last-name OnSpace] [--dry-run]')
    console.log('')
    console.log('Env fallbacks:')
    console.log('  SUPABASE_URL or VITE_SUPABASE_URL')
    console.log('  SUPABASE_SERVICE_ROLE_KEY')
    console.log('  BOB_LOGIN_EMAIL')
    console.log('  BOB_LOGIN_PASSWORD')
    console.log('  BOB_ORG_ID / ORG_ID / DEFAULT_ORG_ID')
    console.log('  BOB_LOGIN_ROLE')
    console.log('  BOB_LOGIN_FIRST_NAME / BOB_LOGIN_LAST_NAME')
    process.exit(0)
  }

  const supabaseUrl = firstNonEmpty(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL).replace(/\/+$/, '')
  const serviceRoleKey = firstNonEmpty(process.env.SUPABASE_SERVICE_ROLE_KEY)

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const email = firstNonEmpty(arg('email'), process.env.BOB_LOGIN_EMAIL).toLowerCase()
  const password = firstNonEmpty(arg('password'), process.env.BOB_LOGIN_PASSWORD)
  const organizationId = firstNonEmpty(arg('org-id'), process.env.BOB_ORG_ID, process.env.ORG_ID, process.env.DEFAULT_ORG_ID)
  const role = firstNonEmpty(arg('role'), process.env.BOB_LOGIN_ROLE, 'admin_officer').toLowerCase()
  const firstName = firstNonEmpty(arg('first-name'), process.env.BOB_LOGIN_FIRST_NAME, 'Bob')
  const lastName = firstNonEmpty(arg('last-name'), process.env.BOB_LOGIN_LAST_NAME, 'OnSpace')
  const dryRun = hasFlag('dry-run')

  if (!email || !password || !organizationId) {
    throw new Error('email, password, and org-id are required (via args or env)')
  }
  if (password.length < 12) {
    throw new Error('Password must be at least 12 characters for Bob login security')
  }
  if (!ALLOWED_ROLES.has(role)) {
    throw new Error(`Invalid role: ${role}`)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .select('id,name')
    .eq('id', organizationId)
    .maybeSingle()

  if (orgError) throw new Error(`Failed to read organization: ${orgError.message}`)
  if (!org?.id) throw new Error(`Organization not found: ${organizationId}`)

  if (dryRun) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      email: maskEmail(email),
        first_name: firstName,
        last_name: lastName,
      role,
      organization_id: organizationId,
      organization_name: org.name || null,
    }, null, 2))
    return
  }

  let userId = null
  const nowIso = new Date().toISOString()

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
        first_name: firstName,
        last_name: lastName,
      source: 'create-bob-login-script',
    },
  })

  if (createError) {
    const msg = String(createError.message || '').toLowerCase()
    const alreadyExists = msg.includes('already') || String(createError.code || '').toLowerCase() === 'email_exists'
    if (!alreadyExists) {
      throw new Error(`Failed to create auth user: ${createError.message}`)
    }
    userId = await resolveUserIdByEmail(admin, email)
    if (!userId) {
      throw new Error('Email exists but could not resolve existing auth user id')
    }

    const { error: updateAuthError } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        source: 'create-bob-login-script',
      },
    })

    if (updateAuthError) {
      throw new Error(`Failed to update existing auth user password: ${updateAuthError.message}`)
    }
  } else {
    userId = created?.user?.id || null
  }

  if (!userId) throw new Error('Could not resolve Bob auth user id')

  const { error: profileError } = await admin
    .from('user_profiles')
    .upsert({
      id: userId,
      email,
      first_name: firstName,
      last_name: lastName,
      role,
      job_title: 'AI Operations Assistant',
      organization_id: organizationId,
      permissions: [],
      is_active: true,
      updated_at: nowIso,
    }, { onConflict: 'id' })

  if (profileError) {
    throw new Error(`Failed to upsert Bob user profile: ${profileError.message}`)
  }

  // Best-effort optional fields: live environments may not have all columns yet.
  const optionalProfilePatch = {
    portal_access: ['bob-assistant', 'admin'],
    enabled_portals: ['bob-assistant', 'admin'],
    authorized_work_locations: [organizationId],
    extra_organization_ids: [],
  }

  await admin
    .from('user_profiles')
    .update(optionalProfilePatch)
    .eq('id', userId)
    .then(() => undefined)
    .catch(() => undefined)

  // Keep Bob persona defaults aligned if the table exists.
  const { error: bobProfileError } = await admin
    .from('bob_user_profiles')
    .upsert({
      user_id: userId,
      organization_id: organizationId,
      bob_tier: role === 'master' || role === 'grand_master' ? 'captain' : 'officer',
      tone: 'professional',
      language: 'en-NZ',
      computer_use_enabled: true,
      is_active: true,
      memory_namespace: `org:${organizationId}/user:${userId}`,
      system_prompt_suffix: 'Operate with strict grounding. Escalate uncertainty instead of guessing.',
      updated_at: nowIso,
    }, { onConflict: 'user_id' })

  if (bobProfileError && !String(bobProfileError.message || '').toLowerCase().includes('does not exist')) {
    throw new Error(`Failed to upsert bob_user_profiles: ${bobProfileError.message}`)
  }

  const nonce = crypto.randomUUID().slice(0, 8)
  console.log(JSON.stringify({
    status: 'ok',
    login: {
      email: maskEmail(email),
      user_id: userId,
      role,
      organization_id: organizationId,
      organization_name: org.name || null,
      marker: `bob-login-${nonce}`,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(`[create-bob-login] ${error.message || String(error)}`)
  process.exit(1)
})
