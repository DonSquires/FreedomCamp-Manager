#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const HELP_TEXT = `
Bootstrap Downer LINZ provider model:
- First Security - Queenstown is service provider
- Downer LINZ is linked as active client with workspace, contract, grants, and contractor access
- Freedom-camping coverage zone is ensured for Downer LINZ

Usage:
  node scripts/bootstrap-downer-linz-zones.mjs [--apply]

Options:
  --apply   Perform inserts/updates. Omit for dry-run.
`

const QUEENSTOWN_CENTER = { lat: -45.0312, lng: 168.6626 }

const CLIENT_DEF = {
  name: 'Downer LINZ',
  organizationPayload: {
    organization_type: 'client',
    organization_level: 3,
    is_active: true,
    enforcement_workflow: 'admin_first',
    overnight_verification_mode: 'two_photo_verification',
  },
  workspaceName: 'Downer LINZ Operational Workspace',
  contractName: 'Downer LINZ Security Services Agreement',
}

const PROVIDER_SERVICE_TYPES = [
  'site_guarding',
  'parking_enforcement',
  'freedom_camping',
  'noise_control',
]

const ZONE_DEFS = [
  {
    name: 'Downer LINZ - Queenstown Coverage Zone',
    description: 'Default operational coverage zone for Downer LINZ patrols managed by First Security - Queenstown.',
    center: QUEENSTOWN_CENTER,
    polygon: { dLat: 0.18, dLng: 0.22 },
  },
]

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
}

function buildPolygonGeometry(center, dLat, dLng) {
  return {
    type: 'Polygon',
    coordinates: [[
      [center.lng - dLng, center.lat - dLat],
      [center.lng + dLng, center.lat - dLat],
      [center.lng + dLng, center.lat + dLat],
      [center.lng - dLng, center.lat + dLat],
      [center.lng - dLng, center.lat - dLat],
    ]],
  }
}

async function getOrgByName(supabase, name) {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, parent_organization_id')
    .eq('name', name)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed loading organization ${name}: ${error.message}`)
  }

  return data || null
}

async function findOrCreateOrganization(supabase, name, payload, dryRun) {
  const existing = await getOrgByName(supabase, name)
  if (existing?.id) return { id: existing.id, name }

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
    internal_notes: 'Bootstrap: First Security - Queenstown service-provider coverage for Downer LINZ.',
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
    notes: 'First Security - Queenstown covers Downer LINZ operations.',
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
    .select('id, name')
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
    boundary_source: 'bootstrap-downer-linz-zones',
    location_lat: zoneDef.center.lat,
    location_lng: zoneDef.center.lng,
    geometry: buildPolygonGeometry(zoneDef.center, zoneDef.polygon.dLat, zoneDef.polygon.dLng),
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

    return { id: existing.id, action: 'updated' }
  }

  if (dryRun) {
    return { id: '', action: 'would_create' }
  }

  const { data: created, error: insertError } = await supabase
    .from('zones')
    .insert({ organization_id: organizationId, ...payload })
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed creating zone ${zoneDef.name}: ${insertError?.message || 'Unknown error'}`)
  }

  return { id: created.id, action: 'created' }
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

  const queenstown = await getOrgByName(supabase, 'First Security - Queenstown')
  if (!queenstown?.id) {
    throw new Error('Organization not found: First Security - Queenstown')
  }

  const downerLinz = await findOrCreateOrganization(
    supabase,
    CLIENT_DEF.name,
    {
      ...CLIENT_DEF.organizationPayload,
      parent_organization_id: queenstown.id,
    },
    dryRun,
  )

  const workspaceId = await findOrCreateWorkspace(supabase, downerLinz.id, CLIENT_DEF.workspaceName, dryRun)
  const contractId = await findOrCreateContract(supabase, queenstown.id, downerLinz.id, CLIENT_DEF.contractName, dryRun)
  for (const serviceType of PROVIDER_SERVICE_TYPES) {
    await findOrCreateProviderGrant(supabase, queenstown.id, downerLinz.id, serviceType, dryRun)
  }
  if (workspaceId) {
    await findOrCreateContractorAccess(supabase, queenstown.id, workspaceId, contractId, dryRun)
  }

  const results = []
  for (const zoneDef of ZONE_DEFS) {
    const result = await findOrCreateZone(supabase, downerLinz.id, zoneDef, dryRun)
    results.push({ name: zoneDef.name, ...result })
  }

  const { data: finalZones, error: finalZonesError } = await supabase
    .from('zones')
    .select('id, name, is_active, boundary_source, location_lat, location_lng')
    .eq('organization_id', downerLinz.id)
    .order('name', { ascending: true })

  if (finalZonesError) {
    throw new Error(`Failed loading final zones: ${finalZonesError.message}`)
  }

  console.log(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'apply',
    provider: { id: queenstown.id, name: queenstown.name },
    client: { id: downerLinz.id, name: downerLinz.name, workspace_id: workspaceId, contract_id: contractId },
    provider_service_types: PROVIDER_SERVICE_TYPES,
    actions: results,
    final_zone_count: (finalZones || []).length,
    final_zones: finalZones || [],
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
