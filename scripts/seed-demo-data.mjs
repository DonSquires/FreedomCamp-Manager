#!/usr/bin/env node
/**
 * Demo Data Seeder
 * Seeds a realistic 3-level org hierarchy, demo users across roles,
 * sample zones, and module subscriptions for client demos.
 *
 * Usage:
 *   node scripts/seed-demo-data.mjs [--reset] [--org-only] [--dry-run]
 *
 * Requires:
 *   VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment
 *   (or .env file at project root)
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env from project root
try {
  const envPath = resolve(__dirname, '../.env')
  const envText = readFileSync(envPath, 'utf8')
  for (const line of envText.split('\n')) {
    const [key, ...rest] = line.split('=')
    if (key && rest.length && !process.env[key]) {
      process.env[key] = rest.join('=').trim().replace(/^["']|["']$/g, '')
    }
  }
} catch {}

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const RESET = args.includes('--reset')
const ORG_ONLY = args.includes('--org-only')

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  console.error('   Add them to .env or export them before running this script.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── Seed Data ────────────────────────────────────────────────────────────────

const ORGS = [
  {
    _seed_id: 'org-l1-iron-eagle',
    name: 'Iron Eagle Security (Demo)',
    organization_type: 'security_company',
    organization_level: 1,
    parent_organization_id: null,
    is_active: true,
    contact_email: 'admin@ironeagle.demo',
    contact_phone: '+64 9 000 0001',
    address: '123 Platform Street, Auckland 1010',
    overnight_verification_mode: 'photo',
  },
  {
    _seed_id: 'org-l2-nelson-cc',
    name: 'Nelson City Council (Demo)',
    organization_type: 'local_government',
    organization_level: 2,
    is_active: true,
    contact_email: 'admin@nelson.demo',
    contact_phone: '+64 3 546 0200',
    address: '110 Trafalgar Street, Nelson 7010',
    overnight_verification_mode: 'none',
  },
  {
    _seed_id: 'org-l2-qldc',
    name: 'Queenstown Lakes DC (Demo)',
    organization_type: 'local_government',
    organization_level: 2,
    is_active: true,
    contact_email: 'admin@qldc.demo',
    contact_phone: '+64 3 441 0499',
    address: '10 Gorge Road, Queenstown 9300',
    overnight_verification_mode: 'photo',
  },
  {
    _seed_id: 'org-l3-nelson-noise',
    name: 'Nelson Noise Control Unit (Demo)',
    organization_type: 'enforcement_unit',
    organization_level: 3,
    is_active: true,
    contact_email: 'noise@nelson.demo',
    overnight_verification_mode: 'none',
  },
]

/** module subscriptions per org seed_id */
const MODULE_SUBS = {
  'org-l1-iron-eagle': [
    'noise_control','parking','dispatch','roster','patrol','compliance','crm',
    'ptt','bob','enforcement','biosecurity','smoke_control','asset_management',
    'reporting','alpr','identity_verification',
  ],
  'org-l2-nelson-cc': ['noise_control', 'reporting', 'bob'],
  'org-l2-qldc': ['patrol', 'dispatch', 'roster', 'enforcement', 'compliance', 'ptt', 'reporting', 'bob'],
  'org-l3-nelson-noise': ['noise_control', 'reporting'],
}

/** Demo users — passwords set to Demo@2026! for all */
const DEMO_PASSWORD = 'Demo@2026!'

const USERS = [
  {
    email: 'master@ironeagle.demo',
    first_name: 'Alex', last_name: 'Masters',
    role: 'master', job_title: 'Platform Administrator',
    org_seed_id: 'org-l1-iron-eagle',
  },
  {
    email: 'admin@ironeagle.demo',
    first_name: 'Sam', last_name: 'Admin',
    role: 'admin', job_title: 'Operations Manager',
    org_seed_id: 'org-l1-iron-eagle',
  },
  {
    email: 'admin@nelson.demo',
    first_name: 'Jamie', last_name: 'Nelson',
    role: 'admin', job_title: 'Council Administrator',
    org_seed_id: 'org-l2-nelson-cc',
  },
  {
    email: 'noise.officer@nelson.demo',
    first_name: 'Riley', last_name: 'Noise',
    role: 'officer', job_title: 'Noise Control Officer',
    org_seed_id: 'org-l3-nelson-noise',
    portal_access: ['noise-control', 'noise-officer'],
  },
  {
    email: 'noise.officer2@nelson.demo',
    first_name: 'Jordan', last_name: 'Decibel',
    role: 'officer', job_title: 'Senior Noise Control Officer',
    org_seed_id: 'org-l3-nelson-noise',
    portal_access: ['noise-control', 'noise-officer'],
  },
  {
    email: 'admin@qldc.demo',
    first_name: 'Morgan', last_name: 'Queenstown',
    role: 'admin', job_title: 'District Administrator',
    org_seed_id: 'org-l2-qldc',
  },
  {
    email: 'patrol.officer@qldc.demo',
    first_name: 'Casey', last_name: 'Patrol',
    role: 'officer', job_title: 'Freedom Camping Patrol Officer',
    org_seed_id: 'org-l2-qldc',
  },
  {
    email: 'roster.admin@qldc.demo',
    first_name: 'Drew', last_name: 'Roster',
    role: 'admin_officer', job_title: 'Roster Administrator',
    org_seed_id: 'org-l2-qldc',
    portal_access: ['roster', 'open-shifts', 'officer-availability'],
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) { console.log(msg) }
function ok(msg)  { console.log(`  ✅ ${msg}`) }
function warn(msg){ console.warn(`  ⚠️  ${msg}`) }
function skip(msg){ console.log(`  ⏭  ${msg}`) }

async function upsertOrg(orgData, parentId) {
  const { _seed_id, ...data } = orgData
  if (parentId) data.parent_organization_id = parentId

  if (DRY_RUN) { skip(`[DRY] Org: ${data.name}`); return { id: `dry-run-${_seed_id}`, ...data } }

  const { data: existing } = await supabase
    .from('organizations')
    .select('id')
    .eq('name', data.name)
    .maybeSingle()

  if (existing) {
    await supabase.from('organizations').update(data).eq('id', existing.id)
    ok(`Updated org: ${data.name} [${existing.id}]`)
    return existing
  }

  const { data: created, error } = await supabase.from('organizations').insert(data).select().single()
  if (error) { warn(`Org insert failed: ${data.name} — ${error.message}`); return null }
  ok(`Created org: ${data.name} [${created.id}]`)
  return created
}

async function seedModules(orgId, moduleKeys) {
  if (DRY_RUN) { skip(`[DRY] Modules for org ${orgId}: ${moduleKeys.join(', ')}`); return }
  for (const module_key of moduleKeys) {
    const { error } = await supabase
      .from('org_module_subscriptions')
      .upsert({ organization_id: orgId, module_key, is_active: true }, { onConflict: 'organization_id,module_key' })
    if (error) warn(`Module ${module_key} for ${orgId}: ${error.message}`)
  }
  ok(`Modules set for org ${orgId}`)
}

async function seedUser(userData, orgId) {
  const { org_seed_id, ...profile } = userData
  if (DRY_RUN) { skip(`[DRY] User: ${userData.email}`); return }

  // Create auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: userData.email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { first_name: userData.first_name, last_name: userData.last_name },
  })

  let userId
  if (authError) {
    if (authError.message?.includes('already been registered') || authError.code === 'email_exists') {
      const { data: existing } = await supabase.auth.admin.listUsers()
      const found = existing?.users?.find(u => u.email === userData.email)
      if (found) { userId = found.id; skip(`User exists: ${userData.email}`) }
      else { warn(`User auth failed: ${userData.email} — ${authError.message}`); return }
    } else {
      warn(`User auth error: ${userData.email} — ${authError.message}`)
      return
    }
  } else {
    userId = authData.user.id
    ok(`Auth user created: ${userData.email}`)
  }

  // Upsert profile
  const profileData = {
    id: userId,
    email: userData.email,
    first_name: userData.first_name,
    last_name: userData.last_name,
    role: userData.role,
    job_title: userData.job_title || null,
    organization_id: orgId,
    portal_access: userData.portal_access ?? [],
    enabled_portals: userData.portal_access ?? [],
    extra_organization_ids: [],
    is_active: true,
  }

  const { error: profileError } = await supabase
    .from('user_profiles')
    .upsert(profileData, { onConflict: 'id' })

  if (profileError) warn(`Profile upsert: ${userData.email} — ${profileError.message}`)
  else ok(`Profile ready: ${userData.email} [${userData.role}] — "${userData.job_title}"`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('\n🌱 FieldOps Manager — Demo Data Seeder')
  log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Reset: ${RESET} | Org-only: ${ORG_ONLY}`)
  log(`   Target: ${SUPABASE_URL}\n`)

  // 1. Seed organisations in order (L1 → L2 → L3)
  log('── Organisations ─────────────────────────────')
  const orgMap = {} // seed_id → { id }

  // L1
  const l1 = ORGS.find(o => o._seed_id === 'org-l1-iron-eagle')
  const l1Org = await upsertOrg(l1, null)
  if (l1Org) orgMap['org-l1-iron-eagle'] = l1Org

  // L2
  for (const org of ORGS.filter(o => o.organization_level === 2)) {
    const created = await upsertOrg(org, l1Org?.id ?? null)
    if (created) orgMap[org._seed_id] = created
  }

  // L3 (Nelson noise unit → parent is Nelson CC)
  const nelsonL3 = ORGS.find(o => o._seed_id === 'org-l3-nelson-noise')
  const l3 = await upsertOrg(nelsonL3, orgMap['org-l2-nelson-cc']?.id ?? null)
  if (l3) orgMap['org-l3-nelson-noise'] = l3

  // 2. Seed module subscriptions
  log('\n── Module Subscriptions ──────────────────────')
  for (const [seedId, modules] of Object.entries(MODULE_SUBS)) {
    const org = orgMap[seedId]
    if (org?.id) await seedModules(org.id, modules)
    else warn(`Org not found for module seeding: ${seedId}`)
  }

  if (ORG_ONLY) {
    log('\n✅ Org-only mode — skipping users.\n')
    return
  }

  // 3. Seed users
  log('\n── Users ─────────────────────────────────────')
  log(`   Default password for all demo users: ${DEMO_PASSWORD}`)
  for (const u of USERS) {
    const org = orgMap[u.org_seed_id]
    if (!org?.id) { warn(`Org not found for user: ${u.email}`); continue }
    await seedUser(u, org.id)
  }

  log('\n── Summary ───────────────────────────────────')
  log('  Organisations seeded:')
  for (const [seedId, org] of Object.entries(orgMap)) {
    log(`    ${org.name} [${org.id?.slice(0,8)}...]`)
  }
  log(`\n  Demo users (all password: ${DEMO_PASSWORD}):`)
  for (const u of USERS) {
    log(`    ${u.email}  [${u.role}]  "${u.job_title}"`)
  }
  log('\n✅ Demo seed complete. Ready for client demo.\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
