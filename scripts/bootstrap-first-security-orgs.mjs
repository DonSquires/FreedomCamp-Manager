#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const BRANCH_NAMES = [
  'First Security - Nelson',
  'First Security - Blenheim',
  'First Security - Greymouth',
  'First Security - Christchurch',
  'First Security - Ashburton',
  'First Security - Timaru',
  'First Security - Oamaru',
  'First Security - Dunedin',
  'First Security - Invercargill',
  'First Security - Queenstown',
]

const HELP_TEXT = `
Bootstrap the canonical First Security organization tree.

Usage:
  node scripts/bootstrap-first-security-orgs.mjs [--apply]

Options:
  --apply   Perform inserts/updates. Omit for dry-run mode.
`

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log(HELP_TEXT.trim())
    return
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: ironEagle, error: ironEagleError } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('name', 'Iron Eagle Security')
    .maybeSingle()

  if (ironEagleError) {
    throw new Error(`Failed to load Iron Eagle Security: ${ironEagleError.message}`)
  }

  if (!ironEagle?.id) {
    throw new Error('Iron Eagle Security organization not found. Create the root organization first.')
  }

  const branchPayload = {
    organization_type: 'service_provider',
    organization_level: 3,
    parent_organization_id: ironEagle.id,
    is_active: true,
    enforcement_workflow: 'officer_first',
    overnight_verification_mode: 'two_photo_verification',
  }

  const parentPayload = {
    name: 'First Security',
    organization_type: 'service_provider',
    organization_level: 2,
    parent_organization_id: ironEagle.id,
    is_active: true,
    enforcement_workflow: 'officer_first',
    overnight_verification_mode: 'two_photo_verification',
  }

  if (!args.apply) {
    console.log('[Dry run] First Security parent payload:')
    console.log(JSON.stringify(parentPayload, null, 2))
    console.log('[Dry run] First Security branches:')
    console.log(JSON.stringify(BRANCH_NAMES.map((name) => ({ name, ...branchPayload })), null, 2))
    return
  }

  let firstSecurityId = ''
  const { data: existingParent, error: parentLookupError } = await supabase
    .from('organizations')
    .select('id')
    .eq('name', parentPayload.name)
    .maybeSingle()

  if (parentLookupError) {
    throw new Error(`Failed to look up First Security parent: ${parentLookupError.message}`)
  }

  if (existingParent?.id) {
    firstSecurityId = existingParent.id
    console.log('First Security parent already exists; preserving existing hierarchy links.')
  } else {
    const { data: insertedParent, error: parentInsertError } = await supabase
      .from('organizations')
      .insert(parentPayload)
      .select('id')
      .single()

    if (parentInsertError || !insertedParent?.id) {
      throw new Error(`Failed to create First Security parent: ${parentInsertError?.message || 'Unknown error'}`)
    }

    firstSecurityId = insertedParent.id
  }

  for (const branchName of BRANCH_NAMES) {
    const payload = {
      name: branchName,
      ...branchPayload,
      parent_organization_id: firstSecurityId,
    }

    const { data: existingBranch, error: branchLookupError } = await supabase
      .from('organizations')
      .select('id')
      .eq('name', branchName)
      .maybeSingle()

    if (branchLookupError) {
      throw new Error(`Failed to look up ${branchName}: ${branchLookupError.message}`)
    }

    if (existingBranch?.id) {
      console.log(`${branchName} already exists; preserving existing hierarchy links.`)
      continue
    }

    const { error: branchInsertError } = await supabase
      .from('organizations')
      .insert(payload)

    if (branchInsertError) {
      throw new Error(`Failed to create ${branchName}: ${branchInsertError.message}`)
    }
  }

  console.log(`Created/confirmed First Security parent and ${BRANCH_NAMES.length} canonical branches.`)
}

main().catch((error) => {
  console.error(error?.message || String(error))
  process.exit(1)
})
