#!/usr/bin/env node

/**
 * Manual Chain Bootstrap
 *
 * Creates data in requested sequence:
 * 1) user (auth)
 * 2) organization (service provider)
 * 3) clients (organizations with type=client)
 * 4) sites (client_sites)
 * 5) patrol (patrols)
 * 6) rostering (roster_shifts)
 * 7) dispatch (dispatch_jobs)
 *
 * Grounding:
 * - docs/INSTRUCTION_MANUAL.md
 *   - Managing Organisations
 *   - Human Workflow: Client Setup to Patrol Operations
 *
 * Usage:
 *   node scripts/bootstrap-manual-chain.mjs
 *   node scripts/bootstrap-manual-chain.mjs --dry-run
 *
 * Required env:
 *   VITE_SUPABASE_URL (or SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env:
 *   CHAIN_PARENT_ORG_ID       parent org for service provider
 *   CHAIN_USER_PASSWORD       password for created auth user
 *   CHAIN_CLIENT_COUNT        number of client orgs to create (default 1)
 */

import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DRY_RUN = process.argv.includes('--dry-run')

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return
  const raw = readFileSync(filePath, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^['\"]|['\"]$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvFile(resolve(process.cwd(), '.env'))
loadEnvFile(resolve(process.cwd(), '.env.local'))
loadEnvFile(resolve(process.cwd(), '.env.playwright.local'))

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CHAIN_PARENT_ORG_ID = (process.env.CHAIN_PARENT_ORG_ID || '').trim() || null
const CHAIN_USER_PASSWORD = process.env.CHAIN_USER_PASSWORD || 'Run2thesun??'
const CHAIN_CLIENT_COUNT = Number.parseInt(process.env.CHAIN_CLIENT_COUNT || '1', 10)

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: {
    transport: WebSocket,
  },
})

function nowStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function logStep(step, detail) {
  console.log(`[${step}] ${detail}`)
}

const runId = `manual-chain-${nowStamp()}`
const created = {
  runId,
  user: null,
  serviceProviderOrg: null,
  clients: [],
  sites: [],
  zone: null,
  patrol: null,
  rosterShift: null,
  dispatchJob: null,
}

async function createAuthUser(email, password) {
  if (DRY_RUN) return { id: `dry-${runId}-user`, email }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { source: runId },
  })
  if (error) throw new Error(`create auth user failed: ${error.message}`)
  return data.user
}

async function insertOrganization(payload) {
  if (DRY_RUN) return { id: `dry-${Math.random().toString(36).slice(2, 10)}`, ...payload }
  const { data, error } = await supabase.from('organizations').insert(payload).select('*').single()
  if (error) throw new Error(`insert organization failed: ${error.message}`)
  return data
}

async function upsertUserProfile(profile) {
  if (DRY_RUN) return
  const { error } = await supabase.from('user_profiles').upsert(profile, { onConflict: 'id' })
  if (error) throw new Error(`upsert user profile failed: ${error.message}`)
}

async function insertClientSite(payload) {
  if (DRY_RUN) return { id: `dry-site-${Math.random().toString(36).slice(2, 10)}`, ...payload }
  const { data, error } = await supabase.from('client_sites').insert(payload).select('*').single()
  if (error) throw new Error(`insert client site failed: ${error.message}`)
  return data
}

async function insertZone(payload) {
  if (DRY_RUN) return { id: `dry-zone-${Math.random().toString(36).slice(2, 10)}`, ...payload }
  const { data, error } = await supabase.from('zones').insert(payload).select('*').single()
  if (error) throw new Error(`insert zone failed: ${error.message}`)
  return data
}

async function patchClientSiteZone(siteId, zoneId) {
  if (DRY_RUN) return
  const { error } = await supabase.from('client_sites').update({ zone_id: zoneId }).eq('id', siteId)
  if (error) throw new Error(`update client site zone failed: ${error.message}`)
}

async function insertPatrol(payload) {
  if (DRY_RUN) return { id: `dry-patrol-${Math.random().toString(36).slice(2, 10)}`, ...payload }
  const { data, error } = await supabase.from('patrols').insert(payload).select('*').single()
  if (error) throw new Error(`insert patrol failed: ${error.message}`)
  return data
}

async function insertRosterShift(payload) {
  if (DRY_RUN) return { id: `dry-roster-${Math.random().toString(36).slice(2, 10)}`, ...payload }
  const { data, error } = await supabase.from('roster_shifts').insert(payload).select('*').single()
  if (error) throw new Error(`insert roster shift failed: ${error.message}`)
  return data
}

async function insertDispatchJob(payload) {
  if (DRY_RUN) return { id: `dry-dispatch-${Math.random().toString(36).slice(2, 10)}`, ...payload }
  const { data, error } = await supabase.from('dispatch_jobs').insert(payload).select('*').single()
  if (error) throw new Error(`insert dispatch job failed: ${error.message}`)
  return data
}

async function main() {
  const today = new Date().toISOString().slice(0, 10)
  const email = `ops.${runId}@example.test`

  logStep('1/7 user', `creating auth user ${email}`)
  const authUser = await createAuthUser(email, CHAIN_USER_PASSWORD)
  created.user = { id: authUser.id, email: authUser.email }

  logStep('2/7 organization', 'creating service_provider organization')
  const serviceProvider = await insertOrganization({
    name: `Service Provider ${runId}`,
    organization_type: 'service_provider',
    organization_level: 2,
    parent_organization_id: CHAIN_PARENT_ORG_ID,
    enforcement_workflow: 'admin_first',
    overnight_verification_mode: 'two_photo_verification',
    contact_email: `ops+${runId}@provider.test`,
    contact_phone: '+64-3-000-0000',
    is_active: true,
  })
  created.serviceProviderOrg = { id: serviceProvider.id, name: serviceProvider.name }

  await upsertUserProfile({
    id: authUser.id,
    email,
    first_name: 'Manual',
    last_name: 'Operator',
    role: 'admin_officer',
    organization_id: serviceProvider.id,
    employer_organization_id: serviceProvider.id,
    enabled_portals: ['dispatch', 'roster', 'patrol'],
    portal_access: ['dispatch', 'roster', 'patrol-schedule', 'client-sites'],
    extra_organization_ids: [],
    is_active: true,
  })

  logStep('3/7 clients', `creating ${CHAIN_CLIENT_COUNT} client organization(s)`)
  for (let i = 1; i <= CHAIN_CLIENT_COUNT; i += 1) {
    const client = await insertOrganization({
      name: `Client ${i} ${runId}`,
      organization_type: 'client',
      organization_level: 3,
      parent_organization_id: serviceProvider.id,
      enforcement_workflow: 'admin_first',
      overnight_verification_mode: 'two_photo_verification',
      contact_email: `ops+${runId}+c${i}@client.test`,
      contact_phone: '+64-3-111-1111',
      is_active: true,
    })
    created.clients.push({ id: client.id, name: client.name })
  }

  const primaryClient = created.clients[0]
  if (!primaryClient) throw new Error('no client created')

  logStep('4/7 sites', 'creating geofence zone then client site')
  const zone = await insertZone({
    organization_id: primaryClient.id,
    name: `Primary Zone ${runId}`,
    zone_type: 'general',
    location_lat: -41.2706,
    location_lng: 173.284,
    is_active: true,
  })
  created.zone = { id: zone.id, name: zone.name }

  const site = await insertClientSite({
    organization_id: primaryClient.id,
    created_by: authUser.id,
    name: `Primary Site ${runId}`,
    zone_id: zone.id,
    address: '110 Trafalgar Street',
    city: 'Nelson',
    gps_lat: -41.2706,
    gps_lng: 173.284,
    contact_name: 'Site Contact',
    contact_phone: '+64-3-222-2222',
    contact_email: `site+${runId}@client.test`,
    is_active: true,
  })
  created.sites.push({ id: site.id, name: site.name, organization_id: site.organization_id })

  await patchClientSiteZone(site.id, zone.id)

  logStep('5/7 patrol', 'creating patrol schedule record')
  const patrol = await insertPatrol({
    organization_id: primaryClient.id,
    zone_id: zone.id,
    assigned_to: authUser.id,
    patrol_date: today,
    shift: 'day',
    status: 'scheduled',
    priority: 'normal',
    recurrence: 'none',
    notes: `Bootstrap patrol ${runId}`,
  })
  created.patrol = { id: patrol.id, status: patrol.status }

  logStep('6/7 rostering', 'creating roster shift')
  const startTime = `${today}T08:00:00`
  const endTime = `${today}T16:00:00`
  const shift = await insertRosterShift({
    organization_id: primaryClient.id,
    officer_id: authUser.id,
    shift_date: today,
    shift_type: 'day',
    start_time: startTime,
    end_time: endTime,
    client_site_id: site.id,
    zone_id: zone.id,
    service_type: 'patrol',
    status: 'draft',
    officer_response: 'pending',
    break_minutes: 30,
    has_conflict: false,
    notes: `Bootstrap roster ${runId}`,
    created_by: authUser.id,
  })
  created.rosterShift = { id: shift.id, status: shift.status }

  logStep('7/7 dispatch', 'creating dispatch job')
  const dispatch = await insertDispatchJob({
    organization_id: primaryClient.id,
    created_by: authUser.id,
    assigned_to: authUser.id,
    job_type: 'freedom_camping',
    priority: 'normal',
    title: `Dispatch ${runId}`,
    description: 'Manual bootstrap dispatch job',
    address: '110 Trafalgar Street, Nelson',
    client_site_id: site.id,
    zone_id: zone.id,
    response_sla_minutes: 30,
    status: 'pending',
  })
  created.dispatchJob = { id: dispatch.id, status: dispatch.status }

  console.log('\nBootstrap complete')
  console.log(JSON.stringify(created, null, 2))
  if (!DRY_RUN) {
    console.log(`\nAuth user password: ${CHAIN_USER_PASSWORD}`)
  }
}

main().catch((error) => {
  console.error('Bootstrap failed:', error.message)
  process.exit(1)
})
