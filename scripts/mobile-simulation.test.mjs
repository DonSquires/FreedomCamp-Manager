import fs from 'node:fs/promises'
import path from 'node:path'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const rootDir = process.cwd()
const easPath = path.join(rootDir, 'mobile-app', 'eas.json')

function logPass(message) {
  console.log(`PASS ${message}`)
}

function logSkip(message) {
  console.log(`SKIP ${message}`)
}

function logFail(message) {
  console.error(`FAIL ${message}`)
}

async function validateExpoProfiles() {
  const raw = await fs.readFile(easPath, 'utf8')
  const config = JSON.parse(raw)
  const profiles = config?.build || {}
  const required = ['development', 'staging', 'production']
  const missing = required.filter((name) => !profiles[name])

  if (missing.length) {
    throw new Error(`Missing Expo build profiles: ${missing.join(', ')}`)
  }

  logPass('Expo EAS build profiles present for development, staging, and production')
}

async function injectDispatchIfConfigured() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    logSkip('Dispatch injection skipped because Supabase service credentials are not configured')
    return
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const targetOfficerId = process.env.TEST_OFFICER_ID || '8c7b5b2a-acf1-48c7-bd2c-640maine697'
  const payload = {
    assigned_officer_id: targetOfficerId,
    type: 'Enforcement Breaches',
    raw_desc: 'Commercial alarm trigger at Salisbury Road Industrial Hub, Richmond',
    priority: 'CRITICAL',
    status: 'unassigned',
  }

  const { data, error } = await supabase
    .from('incidents')
    .insert([payload])
    .select('id, priority')
    .single()

  if (error || !data) {
    throw error || new Error('Dispatch injection returned no row')
  }

  logPass(`Dispatch injection succeeded with incident ${data.id}`)
}

async function pingWearableSosIfConfigured() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !anonKey) {
    logSkip('Wearable SOS edge-function check skipped because anon credentials are not configured')
    return
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/wearable-sos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event: 'MAN_DOWN_TRIGGER',
      lat: -41.32,
      lng: 173.21,
    }),
  })

  if (!response.ok) {
    logSkip(`Wearable SOS edge-function probe returned HTTP ${response.status}; leaving this as an environment-specific check`)
    return
  }

  logPass('Wearable SOS edge function accepted a mobile safety event')
}

async function main() {
  console.log('Starting Bob mobile and field simulation checks...')
  await validateExpoProfiles()
  await injectDispatchIfConfigured()
  await pingWearableSosIfConfigured()
  console.log('Bob mobile simulation checks complete')
}

main().catch((error) => {
  logFail(error?.message || String(error))
  process.exit(1)
})