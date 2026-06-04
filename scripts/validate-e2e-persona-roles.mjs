#!/usr/bin/env node

import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const roleExpectations = {
  master: {
    emailVar: 'PLAYWRIGHT_MASTER_EMAIL',
    allowedRoles: ['master', 'grand_master'],
  },
  admin_org1: {
    emailVar: 'PLAYWRIGHT_ADMIN_ORG1_EMAIL',
    allowedRoles: ['admin', 'admin_officer'],
  },
  admin_org2: {
    emailVar: 'PLAYWRIGHT_ADMIN_ORG2_EMAIL',
    allowedRoles: ['admin', 'admin_officer'],
  },
  officer_org1: {
    emailVar: 'PLAYWRIGHT_OFFICER_ORG1_EMAIL',
    allowedRoles: ['officer'],
  },
  client_viewer: {
    emailVar: 'PLAYWRIGHT_CLIENT_VIEWER_EMAIL',
    allowedRoles: ['client_viewer'],
  },
  client_staff: {
    emailVar: 'PLAYWRIGHT_CLIENT_STAFF_EMAIL',
    allowedRoles: ['client_officer', 'client_admin', 'admin_officer'],
  },
  bob_admin_officer: {
    emailVar: 'PLAYWRIGHT_BOB_ADMIN_OFFICER_EMAIL',
    allowedRoles: ['admin_officer'],
    fallbackEmailVars: ['PLAYWRIGHT_BOB_EMAIL'],
  },
  bob_grand_master: {
    emailVar: 'PLAYWRIGHT_BOB_GRAND_MASTER_EMAIL',
    allowedRoles: ['grand_master'],
    fallbackEmailVars: ['PLAYWRIGHT_BOB_EMAIL'],
  },
}

function readEnv(...keys) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim()
    if (value) return value
  }
  return ''
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

function parseArgs(argv) {
  const args = {
    allowMissing: false,
    allowDuplicateEmails: false,
    slot: '',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--allow-missing') args.allowMissing = true
    if (token === '--allow-duplicate-emails') args.allowDuplicateEmails = true

    if (token.startsWith('--slot=')) {
      args.slot = token.split('=')[1] || ''
      continue
    }

    if (token === '--slot') {
      const value = argv[i + 1]
      if (value && !value.startsWith('--')) {
        args.slot = value
        i += 1
      }
    }
  }

  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const supabaseUrl = readEnv('VITE_SUPABASE_URL', 'PLAYWRIGHT_SUPABASE_URL')
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY', 'PLAYWRIGHT_SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[persona-role-preflight] Missing VITE_SUPABASE_URL/PLAYWRIGHT_SUPABASE_URL or service-role key.')
    process.exit(2)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: {
      transport: WebSocket,
    },
  })

  const selectedSlots = args.slot ? [args.slot] : Object.keys(roleExpectations)
  const unknownSlots = selectedSlots.filter((slot) => !Object.prototype.hasOwnProperty.call(roleExpectations, slot))
  if (unknownSlots.length > 0) {
    console.error(`[persona-role-preflight] Unknown slot(s): ${unknownSlots.join(', ')}`)
    process.exit(2)
  }

  const checks = []
  const failures = []

  for (const slot of selectedSlots) {
    const config = roleExpectations[slot]
    const email = normalize(readEnv(config.emailVar, ...(config.fallbackEmailVars || [])))

    if (!email) {
      checks.push({
        slot,
        email: null,
        found: false,
        role: null,
        allowedRoles: config.allowedRoles,
        pass: !!args.allowMissing,
        reason: 'email-missing',
      })
      if (!args.allowMissing) {
        failures.push(`${slot}: missing email env (${config.emailVar}${config.fallbackEmailVars?.length ? ` or ${config.fallbackEmailVars.join(', ')}` : ''})`)
      }
      continue
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .select('id,email,role,organization_id')
      .ilike('email', email)
      .limit(1)
      .maybeSingle()

    if (error) {
      checks.push({
        slot,
        email,
        found: false,
        role: null,
        allowedRoles: config.allowedRoles,
        pass: false,
        reason: `query-error:${error.message}`,
      })
      failures.push(`${slot}: query failed for ${email}: ${error.message}`)
      continue
    }

    const role = normalize(data?.role)
    const pass = !!data && config.allowedRoles.map(normalize).includes(role)

    checks.push({
      slot,
      email,
      found: !!data,
      role: data?.role || null,
      organization_id: data?.organization_id || null,
      allowedRoles: config.allowedRoles,
      pass,
      reason: !data ? 'profile-not-found' : pass ? 'ok' : 'role-mismatch',
    })

    if (!data) {
      failures.push(`${slot}: no user_profiles record found for ${email}`)
      continue
    }

    if (!pass) {
      failures.push(`${slot}: expected role in [${config.allowedRoles.join(', ')}], got ${data.role || 'null'} for ${email}`)
    }
  }

  if (!args.allowDuplicateEmails) {
    const byEmail = new Map()
    for (const check of checks) {
      if (!check.email) continue
      const slots = byEmail.get(check.email) || []
      slots.push(check.slot)
      byEmail.set(check.email, slots)
    }

    for (const [email, slots] of byEmail.entries()) {
      if (slots.length > 1) {
        failures.push(`duplicate persona email detected: ${email} used by slots [${slots.join(', ')}]`)
      }
    }
  }

  const payload = {
    checkedAt: new Date().toISOString(),
    strict: {
      allowMissing: args.allowMissing,
      allowDuplicateEmails: args.allowDuplicateEmails,
    },
    checks,
    passed: failures.length === 0,
    failures,
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)

  if (failures.length > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`[persona-role-preflight] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
