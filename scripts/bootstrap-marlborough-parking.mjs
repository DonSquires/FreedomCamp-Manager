#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const HELP_TEXT = `
Bootstrap the Marlborough parking setup from the raw training manual.

Usage:
  node scripts/bootstrap-marlborough-parking.mjs [--apply]

Options:
  --apply   Perform inserts/updates. Omit for dry-run mode.
`

const SITE_DEFINITIONS = [
  {
    organizationName: 'Marlborough District Council',
    name: 'Blenheim Central Business Area',
    siteType: 'parking',
    city: 'Blenheim',
    address: 'Blenheim CBD, Marlborough 7201, New Zealand',
    gpsLat: -41.5119,
    gpsLng: 173.9568,
    zoneName: 'Blenheim CBD Time Restricted Parking',
    notes: 'Kerbside meters and time-restricted CBD parking in the Blenheim enforcement area.',
  },
  {
    organizationName: 'Marlborough District Council',
    name: 'Clubs of Marlborough',
    siteType: 'parking',
    city: 'Blenheim',
    address: 'Clubs of Marlborough, Hutcheson Street, Blenheim 7201, New Zealand',
    gpsLat: -41.5102038,
    gpsLng: 173.9568207,
    zoneName: 'Blenheim CBD Time Restricted Parking',
    notes: 'CBD parking hotspot referenced in the training manual.',
  },
  {
    organizationName: 'Marlborough District Council',
    name: 'Kinross Street car park, Blenheim',
    siteType: 'parking',
    city: 'Blenheim',
    address: 'Kinross Street, Blenheim 7301, New Zealand',
    gpsLat: -41.5147104,
    gpsLng: 173.959406,
    zoneName: 'Blenheim CBD Time Restricted Parking',
    notes: 'Located at the back of the Police Station, adjacent to The Warehouse.',
  },
  {
    organizationName: 'Marlborough District Council',
    name: 'Seymour Street car park, Blenheim',
    siteType: 'parking',
    city: 'Blenheim',
    address: 'Seymour Street, Blenheim 7201, New Zealand',
    gpsLat: -41.5111278,
    gpsLng: 173.9546098,
    zoneName: 'Blenheim CBD Time Restricted Parking',
    notes: 'Located at the back of Mitsubishi Motors.',
  },
  {
    organizationName: 'Marlborough District Council',
    name: 'Wynen Street car park, Blenheim',
    siteType: 'parking',
    city: 'Blenheim',
    address: 'Wynen Street, Blenheim 7301, New Zealand',
    gpsLat: -41.5124981,
    gpsLng: 173.9576697,
    zoneName: 'Blenheim CBD Time Restricted Parking',
    notes: 'Located behind Rebel Sports.',
  },
  {
    organizationName: 'Marlborough District Council',
    name: 'Alfred Street car park building, Blenheim',
    siteType: 'parking',
    city: 'Blenheim',
    address: 'Alfred Street, Blenheim 7201, New Zealand',
    gpsLat: -41.510592,
    gpsLng: 173.9466654,
    zoneName: 'Blenheim CBD Time Restricted Parking',
    notes: 'Second level undercover parking in the Blenheim CBD.',
  },
  {
    organizationName: 'Marlborough District Council',
    name: 'Picton CBD parking locations - MDC',
    siteType: 'parking',
    city: 'Picton',
    address: 'Picton CBD, Picton 7220, New Zealand',
    gpsLat: -41.290916,
    gpsLng: 174.006908,
    zoneName: 'Picton CBD Parking',
    notes: 'On-street and off-street council parking in Picton; first hour free is available in MDC car parks.',
  },
  {
    organizationName: 'Marlborough District Council',
    name: 'Picton long term parking - MDC',
    siteType: 'parking',
    city: 'Picton',
    address: 'Picton, Marlborough 7220, New Zealand',
    gpsLat: -41.290916,
    gpsLng: 174.006908,
    zoneName: 'Picton CBD Parking',
    notes: 'Long term parking under council control in Picton.',
  },
  {
    organizationName: 'Port Marlborough',
    name: 'Port Marlborough Car Parks',
    siteType: 'parking',
    city: 'Picton',
    address: 'Port Marlborough, Picton, Marlborough 7220, New Zealand',
    gpsLat: -41.2849278,
    gpsLng: 174.0033421,
    zoneName: 'Port Marlborough Parking',
    notes: 'Port Marlborough parking areas patrolled on behalf of the port operator.',
  },
  {
    organizationName: 'Port Marlborough',
    name: 'Picton long term parking - Port Marlborough',
    siteType: 'parking',
    city: 'Picton',
    address: 'Port Marlborough, Picton, Marlborough 7220, New Zealand',
    gpsLat: -41.2849278,
    gpsLng: 174.0033421,
    zoneName: 'Port Marlborough Parking',
    notes: 'Port Marlborough long-term parking areas referred to in the manual.',
  },
  {
    organizationName: 'Port Marlborough',
    name: 'Noel Leeming car park',
    siteType: 'parking',
    city: 'Blenheim',
    address: 'Noel Leeming, Charles Street, Blenheim 7201, New Zealand',
    gpsLat: -41.5130027,
    gpsLng: 173.9549438,
    zoneName: 'Port Marlborough Parking',
    notes: 'Manual notes the park has leased and council-managed portions.',
  },
]

const ZONE_DEFINITIONS = [
  {
    organizationName: 'Marlborough District Council',
    name: 'Blenheim CBD Time Restricted Parking',
    description: 'Marlborough CBD parking enforcement coverage around Kinross, Seymour, Wynen, Alfred and nearby streets.',
    locationLat: -41.512,
    locationLng: 173.9568,
    polygon: {
      dLat: 0.0035,
      dLng: 0.0055,
    },
  },
  {
    organizationName: 'Marlborough District Council',
    name: 'Picton CBD Parking',
    description: 'Council-managed Picton CBD parking coverage and long-term parking locations.',
    locationLat: -41.290916,
    locationLng: 174.006908,
    polygon: {
      dLat: 0.0028,
      dLng: 0.0045,
    },
  },
  {
    organizationName: 'Port Marlborough',
    name: 'Port Marlborough Parking',
    description: 'Port Marlborough parking areas in Picton, including long-term parking controls.',
    locationLat: -41.2849278,
    locationLng: 174.0033421,
    polygon: {
      dLat: 0.0022,
      dLng: 0.0035,
    },
  },
]

const ACCESS_GRANTS = [
  {
    clientName: 'Marlborough District Council',
    serviceType: 'parking_enforcement',
    allowWithoutRoster: true,
  },
  {
    clientName: 'Port Marlborough',
    serviceType: 'parking_enforcement',
    allowWithoutRoster: true,
  },
]

const CONTRACT_DEFINITIONS = [
  {
    clientName: 'Marlborough District Council',
    contractName: 'Marlborough District Council Parking Enforcement Agreement',
  },
  {
    clientName: 'Port Marlborough',
    contractName: 'Port Marlborough Parking Enforcement Agreement',
  },
]

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
}

async function findOrCreateOrganization(supabase, name, payload, dryRun) {
  const { data: existing, error: lookupError } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('name', name)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up organization ${name}: ${lookupError.message}`)
  }

  if (existing?.id) {
    return existing.id
  }

  if (dryRun) return ''

  const { data: created, error: insertError } = await supabase
    .from('organizations')
    .insert({ name, ...payload })
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed to create organization ${name}: ${insertError?.message || 'Unknown error'}`)
  }

  return created.id
}

async function findOrCreateZone(supabase, organizationId, name, payload, dryRun) {
  const { data: existing, error: lookupError } = await supabase
    .from('zones')
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('name', name)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up zone ${name}: ${lookupError.message}`)
  }

  if (existing?.id) {
    if (dryRun) return existing.id
    const { error: updateError } = await supabase
      .from('zones')
      .update(payload)
      .eq('id', existing.id)
    if (updateError) {
      throw new Error(`Failed to update zone ${name}: ${updateError.message}`)
    }
    return existing.id
  }

  if (dryRun) return ''

  const { data: created, error: insertError } = await supabase
    .from('zones')
    .insert({ organization_id: organizationId, name, ...payload })
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed to create zone ${name}: ${insertError?.message || 'Unknown error'}`)
  }

  return created.id
}

async function findOrCreateWorkspace(supabase, ownerOrgId, workspaceName, dryRun) {
  const { data: existing, error: lookupError } = await supabase
    .from('workspaces')
    .select('id, workspace_name')
    .eq('owner_org_id', ownerOrgId)
    .eq('workspace_name', workspaceName)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up workspace ${workspaceName}: ${lookupError.message}`)
  }

  if (existing?.id) {
    if (dryRun) return existing.id
    const { error: updateError } = await supabase
      .from('workspaces')
      .update({ is_active: true, is_client_owned: true })
      .eq('id', existing.id)

    if (updateError) {
      throw new Error(`Failed to update workspace ${workspaceName}: ${updateError.message}`)
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
    throw new Error(`Failed to create workspace ${workspaceName}: ${insertError?.message || 'Unknown error'}`)
  }

  return created.id
}

async function findOrCreateContractorAccess(supabase, providerOrgId, workspaceId, contractId, notes, dryRun) {
  const { data: existing, error: lookupError } = await supabase
    .from('contractor_access')
    .select('id')
    .eq('provider_org_id', providerOrgId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed to look up contractor access: ${lookupError.message}`)
  }

  const payload = {
    provider_org_id: providerOrgId,
    workspace_id: workspaceId,
    contract_id: contractId || null,
    status: 'active',
    can_use_ptt_bridge: true,
    valid_from: new Date().toISOString().slice(0, 10),
    valid_to: null,
    notes,
  }

  if (!existing?.id) {
    if (dryRun) return ''
    const { data: created, error: insertError } = await supabase
      .from('contractor_access')
      .insert(payload)
      .select('id')
      .single()

    if (insertError || !created?.id) {
      throw new Error(`Failed to create contractor access row: ${insertError?.message || 'Unknown error'}`)
    }

    return created.id
  }

  if (dryRun) return existing.id

  const { error: updateError } = await supabase
    .from('contractor_access')
    .update(payload)
    .eq('id', existing.id)

  if (updateError) {
    throw new Error(`Failed to update contractor access row: ${updateError.message}`)
  }

  return existing.id
}

async function findOrCreateContract(supabase, providerOrgId, clientOrgId, contractName, dryRun) {
  const { data: existingContracts, error: lookupError } = await supabase
    .from('crm_contracts')
    .select('id, status, start_date, end_date')
    .eq('provider_organization_id', providerOrgId)
    .eq('client_organization_id', clientOrgId)
    .eq('name', contractName)
    .order('created_at', { ascending: false })
    .limit(1)

  if (lookupError) {
    throw new Error(`Failed to look up contract ${contractName}: ${lookupError.message}`)
  }

  const existing = Array.isArray(existingContracts) ? existingContracts[0] : null
  const today = new Date().toISOString().slice(0, 10)
  const startDate = '2026-01-01'

  const payload = {
    provider_organization_id: providerOrgId,
    client_organization_id: clientOrgId,
    name: contractName,
    contract_type: 'service',
    start_date: startDate,
    end_date: null,
    status: 'active',
    billing_frequency: 'monthly',
    payment_terms_days: 20,
    currency: 'NZD',
    internal_notes: `Auto-seeded on ${today} by bootstrap-marlborough-parking.`,
  }

  if (!existing?.id) {
    if (dryRun) return ''

    const { data: created, error: insertError } = await supabase
      .from('crm_contracts')
      .insert(payload)
      .select('id')
      .single()

    if (insertError || !created?.id) {
      throw new Error(`Failed to create contract ${contractName}: ${insertError?.message || 'Unknown error'}`)
    }

    return created.id
  }

  if (dryRun) return existing.id

  const { error: updateError } = await supabase
    .from('crm_contracts')
    .update(payload)
    .eq('id', existing.id)

  if (updateError) {
    throw new Error(`Failed to update contract ${contractName}: ${updateError.message}`)
  }

  return existing.id
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

function buildPolygonWkt(locationLat, locationLng, dLat, dLng) {
  const points = [
    [locationLng - dLng, locationLat - dLat],
    [locationLng + dLng, locationLat - dLat],
    [locationLng + dLng, locationLat + dLat],
    [locationLng - dLng, locationLat + dLat],
    [locationLng - dLng, locationLat - dLat],
  ]
  const wktPoints = points.map(([lng, lat]) => `${lng} ${lat}`).join(',')
  return `SRID=4326;POLYGON((${wktPoints}))`
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

  const { data: firstSecurityBranch, error: branchError } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('name', 'First Security - Blenheim')
    .maybeSingle()

  if (branchError) {
    throw new Error(`Failed to load First Security - Blenheim: ${branchError.message}`)
  }

  if (!firstSecurityBranch?.id) {
    throw new Error('First Security - Blenheim not found. Create the delivery branch first.')
  }

  const dryRun = !args.apply
  const organizationPayloads = [
    {
      name: 'Marlborough District Council',
      payload: {
        organization_type: 'client',
        organization_level: 3,
        parent_organization_id: firstSecurityBranch.id,
        is_active: true,
        enforcement_workflow: 'admin_first',
        overnight_verification_mode: 'two_photo_verification',
      },
    },
    {
      name: 'Port Marlborough',
      payload: {
        organization_type: 'client',
        organization_level: 3,
        parent_organization_id: firstSecurityBranch.id,
        is_active: true,
        enforcement_workflow: 'admin_first',
        overnight_verification_mode: 'two_photo_verification',
      },
    },
    {
      name: 'ORIKAN',
      payload: {
        organization_type: 'operator',
        organization_level: 3,
        parent_organization_id: firstSecurityBranch.id,
        is_active: true,
        enforcement_workflow: 'admin_first',
        overnight_verification_mode: 'two_photo_verification',
      },
    },
  ]

  console.log(`[${dryRun ? 'Dry run' : 'Apply'}] Using First Security - Blenheim = ${firstSecurityBranch.id}`)

  const organizationIds = new Map()
  for (const entry of organizationPayloads) {
    const orgId = await findOrCreateOrganization(supabase, entry.name, entry.payload, dryRun)
    organizationIds.set(entry.name, orgId)
    console.log(`${dryRun ? '[Dry run]' : '[Ready]'} organization: ${entry.name}${orgId ? ` (${orgId})` : ''}`)
  }

  const zoneIds = new Map()
  for (const zone of ZONE_DEFINITIONS) {
    const ownerOrgId = organizationIds.get(zone.organizationName)
    if (!ownerOrgId) {
      console.log(`[Skip] Missing zone owner organization for ${zone.name}: ${zone.organizationName}`)
      continue
    }

    const zoneId = await findOrCreateZone(supabase, ownerOrgId, zone.name, {
      description: zone.description,
      is_active: true,
      location_lat: zone.locationLat,
      location_lng: zone.locationLng,
      geometry: buildPolygonGeometry(zone.locationLat, zone.locationLng, zone.polygon.dLat, zone.polygon.dLng),
      geom: buildPolygonWkt(zone.locationLat, zone.locationLng, zone.polygon.dLat, zone.polygon.dLng),
    }, dryRun)

    zoneIds.set(zone.name, zoneId)
    console.log(`${dryRun ? '[Dry run]' : '[Ready]'} zone: ${zone.name}${zoneId ? ` (${zoneId})` : ''}`)
  }

  for (const site of SITE_DEFINITIONS) {
    const organizationId = organizationIds.get(site.organizationName)
    if (!organizationId) {
      console.log(`[Skip] Missing organization for site ${site.name}: ${site.organizationName}`)
      continue
    }

    const zoneId = site.zoneName ? zoneIds.get(site.zoneName) ?? null : null

    const { data: existingSite, error: lookupError } = await supabase
      .from('client_sites')
      .select('id')
      .eq('name', site.name)
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (lookupError) {
      throw new Error(`Failed to look up site ${site.name}: ${lookupError.message}`)
    }

    const payload = {
      organization_id: organizationId,
      zone_id: zoneId,
      name: site.name,
      site_type: site.siteType,
      address: site.address,
      city: site.city,
      gps_lat: site.gpsLat,
      gps_lng: site.gpsLng,
      notes: site.notes,
      is_active: true,
      geofence_radius_metres: 75,
    }

    if (!existingSite?.id) {
      if (!dryRun) {
        const { error: insertError } = await supabase.from('client_sites').insert(payload)
        if (insertError) {
          throw new Error(`Failed to create site ${site.name}: ${insertError.message}`)
        }
      }
      console.log(`${dryRun ? '[Dry run]' : '[Created]'} site: ${site.name} -> ${site.organizationName}`)
      continue
    }

    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('client_sites')
        .update(payload)
        .eq('id', existingSite.id)
      if (updateError) {
        throw new Error(`Failed to update site ${site.name}: ${updateError.message}`)
      }
    }
    console.log(`${dryRun ? '[Dry run]' : '[Updated]'} site: ${site.name} -> ${site.organizationName}`)
  }

  for (const grant of ACCESS_GRANTS) {
    const clientOrgId = organizationIds.get(grant.clientName)
    if (!clientOrgId) {
      console.log(`[Skip] Missing client organization for grant ${grant.clientName}`)
      continue
    }

    const { data: existingGrant, error: grantLookupError } = await supabase
      .from('provider_client_access_grants')
      .select('id')
      .eq('provider_org_id', firstSecurityBranch.id)
      .eq('client_org_id', clientOrgId)
      .eq('service_type', grant.serviceType)
      .maybeSingle()

    if (grantLookupError) {
      throw new Error(`Failed to look up provider grant for ${grant.clientName}: ${grantLookupError.message}`)
    }

    const payload = {
      provider_org_id: firstSecurityBranch.id,
      client_org_id: clientOrgId,
      service_type: grant.serviceType,
      allow_without_roster: grant.allowWithoutRoster,
    }

    if (!existingGrant?.id) {
      if (!dryRun) {
        const { error: insertError } = await supabase.from('provider_client_access_grants').insert(payload)
        if (insertError) {
          throw new Error(`Failed to create provider grant for ${grant.clientName}: ${insertError.message}`)
        }
      }
      console.log(`${dryRun ? '[Dry run]' : '[Created]'} grant: ${grant.clientName} / ${grant.serviceType}`)
      continue
    }

    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('provider_client_access_grants')
        .update(payload)
        .eq('id', existingGrant.id)
      if (updateError) {
        throw new Error(`Failed to update provider grant for ${grant.clientName}: ${updateError.message}`)
      }
    }
    console.log(`${dryRun ? '[Dry run]' : '[Updated]'} grant: ${grant.clientName} / ${grant.serviceType}`)
  }

  const contractIds = new Map()
  for (const contract of CONTRACT_DEFINITIONS) {
    const clientOrgId = organizationIds.get(contract.clientName)
    if (!clientOrgId) {
      console.log(`[Skip] Missing client organization for contract ${contract.contractName}`)
      continue
    }

    const contractId = await findOrCreateContract(
      supabase,
      firstSecurityBranch.id,
      clientOrgId,
      contract.contractName,
      dryRun,
    )

    contractIds.set(contract.clientName, contractId)
    console.log(`${dryRun ? '[Dry run]' : '[Ready]'} contract: ${contract.contractName}${contractId ? ` (${contractId})` : ''}`)
  }

  for (const grant of ACCESS_GRANTS) {
    const clientOrgId = organizationIds.get(grant.clientName)
    if (!clientOrgId) {
      console.log(`[Skip] Missing client organization for workspace handshake: ${grant.clientName}`)
      continue
    }

    const workspaceName = `${grant.clientName} Operational Workspace`
    const workspaceId = await findOrCreateWorkspace(supabase, clientOrgId, workspaceName, dryRun)
    console.log(`${dryRun ? '[Dry run]' : '[Ready]'} workspace: ${workspaceName}${workspaceId ? ` (${workspaceId})` : ''}`)

    const accessId = await findOrCreateContractorAccess(
      supabase,
      firstSecurityBranch.id,
      workspaceId,
      contractIds.get(grant.clientName) || null,
      `Auto-seeded by bootstrap-marlborough-parking for ${grant.clientName} parking enforcement.`,
      dryRun,
    )
    console.log(`${dryRun ? '[Dry run]' : '[Ready]'} contractor_access: ${grant.clientName}${accessId ? ` (${accessId})` : ''}`)
  }

  console.log(`Done. ${dryRun ? 'Dry-run only; no changes were written.' : 'Marlborough parking setup has been created/confirmed.'}`)
}

main().catch((error) => {
  console.error(error?.message || String(error))
  process.exit(1)
})
