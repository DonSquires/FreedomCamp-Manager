#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const HELP_TEXT = `
Bootstrap Nelson/Tasman provider model:
- First Security - Nelson is service provider
- Nelson + Tasman jurisdictions are covered

Usage:
  node scripts/bootstrap-nelson-tasman-provider.mjs [--apply]

Options:
  --apply   Perform inserts/updates. Omit for dry-run.
`

const CLIENT_DEFS = [
  {
    name: 'Nelson City Council',
    organizationPayload: {
      organization_type: 'client',
      organization_level: 3,
      is_active: true,
      enforcement_workflow: 'admin_first',
      overnight_verification_mode: 'two_photo_verification',
    },
    workspaceName: 'Nelson City Council Operational Workspace',
    contractName: 'Nelson City Council Security Services Agreement',
  },
  {
    name: 'Tasman District Council',
    organizationPayload: {
      organization_type: 'client',
      organization_level: 3,
      is_active: true,
      enforcement_workflow: 'admin_first',
      overnight_verification_mode: 'two_photo_verification',
    },
    workspaceName: 'Tasman District Council Operational Workspace',
    contractName: 'Tasman District Council Security Services Agreement',
  },
]

const JURISDICTION_ZONE_DEFS = [
  {
    name: 'First Security Nelson Jurisdiction - Nelson Region',
    description: 'Service-provider jurisdiction coverage for Nelson region.',
    center: { lat: -41.2706, lng: 173.2840 },
    polygon: { dLat: 0.11, dLng: 0.16 },
  },
  {
    name: 'First Security Nelson Jurisdiction - Tasman Region',
    description: 'Service-provider jurisdiction coverage for Tasman region.',
    center: { lat: -41.121, lng: 173.0132 },
    polygon: { dLat: 0.25, dLng: 0.33 },
  },
]

const PROVIDER_SERVICE_TYPES = [
  'site_guarding',
  'parking_enforcement',
  'freedom_camping',
  'noise_control',
]

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
}

function buildPolygonGeometry(locationLat, locationLng, dLat, dLng) {
  return {
    type: 'Polygon',
    coordinates: [[
      [locationLng - dLng, locationLat - dLat],
      [locationLng + dLng, locationLat - dLat],
      [locationLng + dLng, locationLat + dLat],
      [locationLng - dLng, locationLat + dLat],
      [locationLng - dLng, locationLat - dLat],
    ]],
  }
}

async function findOrganizationByName(supabase, name) {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('name', name)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed loading organization ${name}: ${error.message}`)
  }
  return data || null
}

async function findOrCreateOrganization(supabase, name, payload, dryRun) {
  const existing = await findOrganizationByName(supabase, name)
  if (existing?.id) return existing
  if (dryRun) return { id: '', name }

  const { data: created, error: insertError } = await supabase
    .from('organizations')
    .insert({ name, ...payload })
    .select('id, name')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed creating organization ${name}: ${insertError?.message || 'Unknown error'}`)
  }

  return created
}

async function findOrCreateWorkspace(supabase, ownerOrgId, workspaceName, dryRun) {
  const { data: existing, error: lookupError } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_org_id', ownerOrgId)
    .eq('workspace_name', workspaceName)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up workspace ${workspaceName}: ${lookupError.message}`)
  }

  if (existing?.id) {
    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('workspaces')
        .update({ is_active: true, is_client_owned: true })
        .eq('id', existing.id)
      if (updateError) {
        throw new Error(`Failed updating workspace ${workspaceName}: ${updateError.message}`)
      }
    }
    return existing.id
  }

  if (dryRun) return ''

  const { data: created, error: insertError } = await supabase
    .from('workspaces')
    .insert({
      owner_org_id: ownerOrgId,
      workspace_name: workspaceName,
      is_client_owned: true,
      is_active: true,
      bylaw_config: {},
    })
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed creating workspace ${workspaceName}: ${insertError?.message || 'Unknown error'}`)
  }

  return created.id
}

async function findOrCreateContract(supabase, providerOrgId, clientOrgId, contractName, dryRun) {
  const { data: existingRows, error: lookupError } = await supabase
    .from('crm_contracts')
    .select('id')
    .eq('provider_organization_id', providerOrgId)
    .eq('client_organization_id', clientOrgId)
    .eq('name', contractName)
    .order('created_at', { ascending: false })
    .limit(1)

  if (lookupError) {
    throw new Error(`Failed looking up contract ${contractName}: ${lookupError.message}`)
  }

  const existing = Array.isArray(existingRows) ? existingRows[0] : null
  const payload = {
    provider_organization_id: providerOrgId,
    client_organization_id: clientOrgId,
    name: contractName,
    contract_type: 'service',
    start_date: '2026-01-01',
    end_date: null,
    status: 'active',
    billing_frequency: 'monthly',
    payment_terms_days: 20,
    currency: 'NZD',
    internal_notes: 'Bootstrap: First Security - Nelson service-provider jurisdiction coverage for Nelson/Tasman.',
  }

  if (existing?.id) {
    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('crm_contracts')
        .update(payload)
        .eq('id', existing.id)
      if (updateError) {
        throw new Error(`Failed updating contract ${contractName}: ${updateError.message}`)
      }
    }
    return existing.id
  }

  if (dryRun) return ''

  const { data: created, error: insertError } = await supabase
    .from('crm_contracts')
    .insert(payload)
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed creating contract ${contractName}: ${insertError?.message || 'Unknown error'}`)
  }

  return created.id
}

async function findOrCreateProviderGrant(supabase, providerOrgId, clientOrgId, serviceType, dryRun) {
  const { data: existing, error: lookupError } = await supabase
    .from('provider_client_access_grants')
    .select('id')
    .eq('provider_org_id', providerOrgId)
    .eq('client_org_id', clientOrgId)
    .eq('service_type', serviceType)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up provider grant for client ${clientOrgId}: ${lookupError.message}`)
  }

  const payload = {
    provider_org_id: providerOrgId,
    client_org_id: clientOrgId,
    service_type: serviceType,
    allow_without_roster: true,
  }

  if (existing?.id) {
    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('provider_client_access_grants')
        .update(payload)
        .eq('id', existing.id)
      if (updateError) {
        throw new Error(`Failed updating provider grant for client ${clientOrgId}: ${updateError.message}`)
      }
    }
    return existing.id
  }

  if (dryRun) return ''

  const { data: created, error: insertError } = await supabase
    .from('provider_client_access_grants')
    .insert(payload)
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed creating provider grant for client ${clientOrgId}: ${insertError?.message || 'Unknown error'}`)
  }

  return created.id
}

async function findOrCreateContractorAccess(supabase, providerOrgId, workspaceId, contractId, dryRun) {
  const { data: existing, error: lookupError } = await supabase
    .from('contractor_access')
    .select('id')
    .eq('provider_org_id', providerOrgId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up contractor_access for workspace ${workspaceId}: ${lookupError.message}`)
  }

  const payload = {
    provider_org_id: providerOrgId,
    workspace_id: workspaceId,
    contract_id: contractId || null,
    status: 'active',
    can_use_ptt_bridge: true,
    valid_from: new Date().toISOString().slice(0, 10),
    valid_to: null,
    notes: 'First Security - Nelson covers Nelson/Tasman jurisdiction operations.',
  }

  if (existing?.id) {
    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('contractor_access')
        .update(payload)
        .eq('id', existing.id)
      if (updateError) {
        throw new Error(`Failed updating contractor_access for workspace ${workspaceId}: ${updateError.message}`)
      }
    }
    return existing.id
  }

  if (dryRun) return ''

  const { data: created, error: insertError } = await supabase
    .from('contractor_access')
    .insert(payload)
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed creating contractor_access for workspace ${workspaceId}: ${insertError?.message || 'Unknown error'}`)
  }

  return created.id
}

async function findOrCreateZone(supabase, organizationId, zoneDef, dryRun) {
  const { data: existing, error: lookupError } = await supabase
    .from('zones')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('name', zoneDef.name)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed looking up zone ${zoneDef.name}: ${lookupError.message}`)
  }

  const payload = {
    name: zoneDef.name,
    description: zoneDef.description,
    is_active: true,
    boundary_source: 'bootstrap-nelson-tasman-provider',
    location_lat: zoneDef.center.lat,
    location_lng: zoneDef.center.lng,
    geometry: buildPolygonGeometry(zoneDef.center.lat, zoneDef.center.lng, zoneDef.polygon.dLat, zoneDef.polygon.dLng),
  }

  if (existing?.id) {
    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('zones')
        .update(payload)
        .eq('id', existing.id)
      if (updateError) {
        throw new Error(`Failed updating zone ${zoneDef.name}: ${updateError.message}`)
      }
    }
    return existing.id
  }

  if (dryRun) return ''

  const { data: created, error: insertError } = await supabase
    .from('zones')
    .insert({ organization_id: organizationId, ...payload })
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed creating zone ${zoneDef.name}: ${insertError?.message || 'Unknown error'}`)
  }

  return created.id
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

  const dryRun = !args.apply

  const provider = await findOrganizationByName(supabase, 'First Security - Nelson')
  if (!provider?.id) {
    throw new Error('First Security - Nelson organization not found. Run bootstrap-first-security-orgs first.')
  }

  console.log(`[${dryRun ? 'Dry run' : 'Apply'}] provider = First Security - Nelson (${provider.id})`)

  for (const clientDef of CLIENT_DEFS) {
    const client = await findOrCreateOrganization(
      supabase,
      clientDef.name,
      {
        ...clientDef.organizationPayload,
        parent_organization_id: provider.id,
      },
      dryRun,
    )

    const workspaceId = await findOrCreateWorkspace(supabase, client.id, clientDef.workspaceName, dryRun)
    const contractId = await findOrCreateContract(supabase, provider.id, client.id, clientDef.contractName, dryRun)
    for (const serviceType of PROVIDER_SERVICE_TYPES) {
      await findOrCreateProviderGrant(supabase, provider.id, client.id, serviceType, dryRun)
    }
    await findOrCreateContractorAccess(supabase, provider.id, workspaceId, contractId, dryRun)

    console.log(`${dryRun ? '[Dry run]' : '[Ready]'} client linkage: ${clientDef.name}${workspaceId ? ` workspace=${workspaceId}` : ''}${contractId ? ` contract=${contractId}` : ''}`)
  }

  for (const zoneDef of JURISDICTION_ZONE_DEFS) {
    const zoneId = await findOrCreateZone(supabase, provider.id, zoneDef, dryRun)
    console.log(`${dryRun ? '[Dry run]' : '[Ready]'} jurisdiction zone: ${zoneDef.name}${zoneId ? ` (${zoneId})` : ''}`)
  }

  console.log('Nelson/Tasman provider-jurisdiction bootstrap completed.')
}

main().catch((error) => {
  console.error(error?.message || String(error))
  process.exit(1)
})
