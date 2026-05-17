#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const BRANCH_JURISDICTIONS = {
  'First Security - Nelson': ['Nelson', 'Tasman'],
  'First Security - Blenheim': ['Marlborough'],
  'First Security - Greymouth': ['Buller', 'Grey', 'Westland'],
  'First Security - Christchurch': ['North Canterbury', 'Central Canterbury'],
  'First Security - Ashburton': ['Ashburton District'],
  'First Security - Timaru': ['South Canterbury'],
  'First Security - Oamaru': ['North Otago'],
  'First Security - Dunedin': ['Otago'],
  'First Security - Invercargill': ['Southland'],
  'First Security - Queenstown': ['Central Otago'],
}

const BRANCH_NAMES = Object.keys(BRANCH_JURISDICTIONS)

const HELP_TEXT = `
Bootstrap the canonical First Security organization tree.

Canonical branch coverage:
${Object.entries(BRANCH_JURISDICTIONS)
  .map(([name, regions]) => `  - ${name}: ${regions.join(', ')}`)
  .join('\n')}

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

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase()
}

function isSameValue(left, right) {
  return normalizeValue(left) === normalizeValue(right)
}

function summarizeOrgRow(row) {
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    parent_organization_id: row.parent_organization_id,
    organization_level: row.organization_level,
    organization_type: row.organization_type,
    is_active: row.is_active,
    address: row.address,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
  }
}

function scoreCandidate(candidate, expected) {
  let score = 0
  if (candidate.parent_organization_id === expected.parent_organization_id) score += 4
  if (candidate.organization_level === expected.organization_level) score += 3
  if (isSameValue(candidate.organization_type, expected.organization_type)) score += 2
  if (candidate.is_active === expected.is_active) score += 1

  if (expected.address && isSameValue(candidate.address, expected.address)) score += 1
  if (expected.contact_email && isSameValue(candidate.contact_email, expected.contact_email)) score += 1
  if (expected.contact_phone && isSameValue(candidate.contact_phone, expected.contact_phone)) score += 1

  return score
}

function resolveOrganizationCandidateOrThrow(name, rows, expected) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { mode: 'missing', organizationId: '' }
  }

  if (rows.length === 1) {
    return { mode: 'single', organizationId: rows[0].id }
  }

  const ranked = rows
    .map((row) => ({ row, score: scoreCandidate(row, expected) }))
    .sort((a, b) => b.score - a.score)

  const topScore = ranked[0]?.score ?? -1
  const topRows = ranked.filter((entry) => entry.score === topScore)

  if (topRows.length === 1 && topScore >= 8) {
    return { mode: 'resolved_from_duplicates', organizationId: topRows[0].row.id }
  }

  const preferred = [...topRows]
    .sort((a, b) => {
      const leftCreated = String(a.row.created_at || '')
      const rightCreated = String(b.row.created_at || '')
      if (leftCreated !== rightCreated) return leftCreated.localeCompare(rightCreated)
      return String(a.row.id).localeCompare(String(b.row.id))
    })[0]

  return {
    mode: 'resolved_from_ambiguous_duplicates',
    organizationId: preferred?.row?.id || rows[0].id,
    candidates: rows.map((row) => summarizeOrgRow(row)),
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
  const { data: existingParents, error: parentLookupError } = await supabase
    .from('organizations')
    .select('id, name, created_at, parent_organization_id, organization_level, organization_type, is_active, address, contact_email, contact_phone')
    .eq('name', parentPayload.name)
    .order('created_at', { ascending: true })

  if (parentLookupError) {
    throw new Error(`Failed to look up First Security parent: ${parentLookupError.message}`)
  }

  const parentResolution = resolveOrganizationCandidateOrThrow(parentPayload.name, existingParents || [], {
    parent_organization_id: ironEagle.id,
    organization_level: parentPayload.organization_level,
    organization_type: parentPayload.organization_type,
    is_active: parentPayload.is_active,
    address: null,
    contact_email: null,
    contact_phone: null,
  })

  if (parentResolution.mode === 'missing') {
    const { data: insertedParent, error: parentInsertError } = await supabase
      .from('organizations')
      .insert(parentPayload)
      .select('id')
      .single()

    if (parentInsertError || !insertedParent?.id) {
      throw new Error(`Failed to create First Security parent: ${parentInsertError?.message || 'Unknown error'}`)
    }

    firstSecurityId = insertedParent.id
  } else {
    firstSecurityId = parentResolution.organizationId
    if (parentResolution.mode === 'resolved_from_duplicates') {
      console.log('First Security parent resolved from duplicates using hierarchy/type match rules.')
    } else if (parentResolution.mode === 'resolved_from_ambiguous_duplicates') {
      console.log('First Security parent resolved from ambiguous duplicates by deterministic oldest-record preference (no create/merge).')
    } else {
      console.log('First Security parent already exists; preserving existing hierarchy links.')
    }
  }

  for (const branchName of BRANCH_NAMES) {
    const payload = {
      name: branchName,
      ...branchPayload,
      parent_organization_id: firstSecurityId,
    }

    const { data: existingBranches, error: branchLookupError } = await supabase
      .from('organizations')
      .select('id, name, created_at, parent_organization_id, organization_level, organization_type, is_active, address, contact_email, contact_phone')
      .eq('name', branchName)
      .order('created_at', { ascending: true })

    if (branchLookupError) {
      throw new Error(`Failed to look up ${branchName}: ${branchLookupError.message}`)
    }

    const branchResolution = resolveOrganizationCandidateOrThrow(branchName, existingBranches || [], {
      parent_organization_id: firstSecurityId,
      organization_level: payload.organization_level,
      organization_type: payload.organization_type,
      is_active: payload.is_active,
      address: null,
      contact_email: null,
      contact_phone: null,
    })

    if (branchResolution.mode !== 'missing') {
      if (branchResolution.mode === 'resolved_from_duplicates') {
        console.log(`${branchName} resolved from duplicates using hierarchy/type match rules.`)
      } else if (branchResolution.mode === 'resolved_from_ambiguous_duplicates') {
        console.log(`${branchName} resolved from ambiguous duplicates by deterministic oldest-record preference (no create/merge).`)
      } else {
        console.log(`${branchName} already exists; preserving existing hierarchy links.`)
      }
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
