#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

const HELP_TEXT = `
Validate onboarding readiness for newly introduced CRM organizations, sites, zones, and locations.

Usage:
  node scripts/validate-entity-onboarding-readiness.mjs [options]

Options:
  --scope <new|all>           Validate only recent records (new) or all active records (all). Default: new
  --sinceDays <n>             When scope=new, include rows created in last n days. Default: 30
  --organization <name>       Filter checks to one organization name
  --outDir <path>             Output folder for artifacts
  --help                      Show help
`

function parseArgs(argv) {
  const args = {
    scope: 'new',
    sinceDays: 30,
    organization: '',
    outDir: 'tmp/docs/storage-review/onboarding-readiness',
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--scope' && argv[i + 1]) {
      const value = String(argv[i + 1]).trim().toLowerCase()
      if (value === 'new' || value === 'all') args.scope = value
      i += 1
    } else if (arg === '--sinceDays' && argv[i + 1]) {
      const parsed = Number(argv[i + 1])
      if (Number.isFinite(parsed) && parsed > 0) args.sinceDays = parsed
      i += 1
    } else if (arg === '--organization' && argv[i + 1]) {
      args.organization = String(argv[i + 1]).trim()
      i += 1
    } else if (arg === '--outDir' && argv[i + 1]) {
      args.outDir = String(argv[i + 1]).trim()
      i += 1
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    }
  }

  return args
}

function isTruthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function hasLatLng(lat, lng) {
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
}

function hasText(value) {
  return String(value || '').trim().length > 0
}

function normalizeOrgType(value) {
  return String(value || '').trim().toLowerCase()
}

function isCrmAccountOrg(org) {
  const type = normalizeOrgType(org?.organization_type)
  return type === 'owner' || type === 'service_provider' || type === 'client' || type === 'contractor' || type === 'operator'
}

function isClientLikeOrg(org) {
  const type = normalizeOrgType(org?.organization_type)
  return type === 'client' || type === 'operator'
}

function createdWithin(createdAt, sinceIso) {
  if (!createdAt) return false
  const ts = Date.parse(createdAt)
  if (Number.isNaN(ts)) return false
  return ts >= Date.parse(sinceIso)
}

function severityOrder(severity) {
  if (severity === 'blocker') return 0
  if (severity === 'warning') return 1
  return 2
}

function toMarkdown(report) {
  const lines = []
  lines.push('# Entity Onboarding Readiness Report')
  lines.push('')
  lines.push(`- generated_at: ${report.generated_at}`)
  lines.push(`- scope: ${report.scope}`)
  lines.push(`- since_days: ${report.since_days}`)
  lines.push(`- organization_filter: ${report.organization_filter || '(none)'}`)
  lines.push(`- pass: ${report.pass ? 'true' : 'false'}`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- organizations_checked: ${report.summary.organizations_checked}`)
  lines.push(`- sites_checked: ${report.summary.sites_checked}`)
  lines.push(`- zones_checked: ${report.summary.zones_checked}`)
  lines.push(`- lois_checked: ${report.summary.lois_checked}`)
  lines.push(`- blockers: ${report.summary.blockers}`)
  lines.push(`- warnings: ${report.summary.warnings}`)
  lines.push('')
  lines.push('## Findings')
  lines.push('')

  if (report.findings.length === 0) {
    lines.push('- No findings. Readiness checks passed.')
    lines.push('')
    return `${lines.join('\n')}\n`
  }

  for (const finding of report.findings) {
    const target = [finding.entity_type, finding.entity_id].filter(Boolean).join(':')
    lines.push(`- [${finding.severity}] ${target} - ${finding.code}`)
    lines.push(`  - ${finding.message}`)
  }

  lines.push('')
  return `${lines.join('\n')}\n`
}

async function fetchTable(supabase, table, selectClause, organizationFilter) {
  let query = supabase.from(table).select(selectClause)
  if (organizationFilter && table === 'organizations') {
    query = query.eq('name', organizationFilter)
  }
  const { data, error } = await query
  if (error) {
    throw new Error(`Failed loading ${table}: ${error.message}`)
  }
  return Array.isArray(data) ? data : []
}

async function fetchServiceAgreementsWithSchemaFallback(supabase) {
  const signedSelect = 'id,organization_id,client_org_id,name,status,is_active,start_date,end_date,active_to,created_at,is_signed,signed_at'
  const legacySelect = 'id,organization_id,client_org_id,name,status,is_active,start_date,end_date,active_to,created_at'

  const trySigned = await supabase.from('service_agreements').select(signedSelect)
  if (!trySigned.error) {
    return { rows: Array.isArray(trySigned.data) ? trySigned.data : [], supportsSignedAgreement: true }
  }

  const tryLegacy = await supabase.from('service_agreements').select(legacySelect)
  if (tryLegacy.error) {
    throw new Error(`Failed loading service_agreements: ${tryLegacy.error.message}`)
  }

  return { rows: Array.isArray(tryLegacy.data) ? tryLegacy.data : [], supportsSignedAgreement: false }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP_TEXT.trim())
    return
  }

  loadLocalEnv()
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const sinceIso = new Date(Date.now() - args.sinceDays * 24 * 60 * 60 * 1000).toISOString()

  const organizations = await fetchTable(
    supabase,
    'organizations',
    'id,name,is_active,organization_type,organization_level,parent_organization_id,created_at,updated_at',
    args.organization,
  )

  const orgIds = new Set(organizations.map((o) => o.id))

  const modules = await fetchTable(
    supabase,
    'org_module_subscriptions',
    'organization_id,module_key,is_active,updated_at',
    '',
  )
  const agreementLoad = await fetchServiceAgreementsWithSchemaFallback(supabase)
  const agreements = agreementLoad.rows
  const supportsSignedAgreement = agreementLoad.supportsSignedAgreement
  const sites = await fetchTable(
    supabase,
    'client_sites',
    'id,name,organization_id,zone_id,loi_id,is_active,site_type,gps_lat,gps_lng,address,city,created_at',
    '',
  )
  const zones = await fetchTable(
    supabase,
    'zones',
    'id,name,organization_id,is_active,zone_type,geometry,location_lat,location_lng,loi_id,created_at',
    '',
  )
  const lois = await fetchTable(
    supabase,
    'locations_of_interest',
    'id,name,organization_id,is_active,loi_kind,gps_lat,gps_lng,address_full,city,geofence_geometry,geo_zone_ids,created_at',
    '',
  )

  const zoneMap = new Map(zones.map((z) => [z.id, z]))
  const loiMap = new Map(lois.map((l) => [l.id, l]))
  const orgMap = new Map(organizations.map((o) => [o.id, o]))

  const relevantOrgIds = new Set()
  for (const org of organizations) {
    const inScope = args.scope === 'all' || createdWithin(org.created_at, sinceIso)
    if (inScope) relevantOrgIds.add(org.id)
  }

  const findings = []
  const pushFinding = (severity, code, entityType, entityId, message) => {
    findings.push({ severity, code, entity_type: entityType, entity_id: entityId, message })
  }

  const modulesByOrg = new Map()
  for (const m of modules) {
    if (!modulesByOrg.has(m.organization_id)) modulesByOrg.set(m.organization_id, [])
    modulesByOrg.get(m.organization_id).push(m)
  }

  const agreementsByOrg = new Map()
  for (const a of agreements) {
    if (!agreementsByOrg.has(a.organization_id)) agreementsByOrg.set(a.organization_id, [])
    agreementsByOrg.get(a.organization_id).push(a)
  }

  const filteredOrgs = organizations.filter((org) => {
    if (!orgIds.has(org.id)) return false
    if (!isCrmAccountOrg(org)) return false
    if (args.scope === 'all') return true
    return createdWithin(org.created_at, sinceIso)
  })

  for (const org of filteredOrgs) {
    if (!isTruthy(org.is_active)) {
      pushFinding('blocker', 'ORG_INACTIVE', 'organization', org.id, `Organization ${org.name} is inactive.`)
    }

    if (org.parent_organization_id) {
      const parent = orgMap.get(org.parent_organization_id)
      if (!parent) {
        pushFinding('blocker', 'ORG_PARENT_NOT_FOUND', 'organization', org.id, `Organization ${org.name} references missing parent organization ${org.parent_organization_id}.`)
      } else if (!isTruthy(parent.is_active)) {
        pushFinding('warning', 'ORG_PARENT_INACTIVE', 'organization', org.id, `Organization ${org.name} is linked to inactive parent organization ${parent.name}.`)
      }
    }

    if (isClientLikeOrg(org) && Number(org.organization_level || 0) > 1 && !org.parent_organization_id) {
      pushFinding('warning', 'ORG_PARENT_RECOMMENDED', 'organization', org.id, `Organization ${org.name} has no parent organization configured.`)
    }

    if (normalizeOrgType(org.organization_type) === 'service_provider' && !org.parent_organization_id) {
      pushFinding('blocker', 'ORG_SERVICE_PROVIDER_PARENT_REQUIRED', 'organization', org.id, `Service provider ${org.name} must be linked to its app owner or platform owner via parent_organization_id.`)
    }

    const orgModules = (modulesByOrg.get(org.id) || []).filter((m) => isTruthy(m.is_active))
    const activeKeys = new Set(orgModules.map((m) => String(m.module_key || '').trim()))

    if (!activeKeys.has('crm')) {
      pushFinding('blocker', 'ORG_MODULE_CRM_MISSING', 'organization', org.id, `Organization ${org.name} is missing active crm module subscription.`)
    }

    if (isClientLikeOrg(org) && !activeKeys.has('reporting')) {
      pushFinding('blocker', 'ORG_MODULE_REPORTING_MISSING', 'organization', org.id, `Organization ${org.name} is missing active reporting module subscription.`)
    }

    if (!isClientLikeOrg(org)) continue

    const orgAgreements = (agreementsByOrg.get(org.id) || []).filter((a) => {
      const activeStatus = String(a.status || '').toLowerCase() === 'active'
      return activeStatus || isTruthy(a.is_active)
    })

    if (supportsSignedAgreement) {
      const hasSignedActive = orgAgreements.some((a) => isTruthy(a.is_signed))
      if (!hasSignedActive) {
        const isHistoricalOrg = !createdWithin(org.created_at, sinceIso)
        if (isHistoricalOrg) {
          pushFinding(
            'warning',
            'ORG_SIGNED_ACTIVE_AGREEMENT_LEGACY_GAP',
            'organization',
            org.id,
            `Organization ${org.name} has no signed active service agreement in historical data. Admin should locate an existing signed agreement or obtain and record a new one.`,
          )
        } else {
          pushFinding(
            'blocker',
            'ORG_SIGNED_ACTIVE_AGREEMENT_REQUIRED',
            'organization',
            org.id,
            `Organization ${org.name} has no signed active service agreement.`,
          )
        }
      }
    } else if (orgAgreements.length === 0) {
      pushFinding(
        'warning',
        'ORG_SERVICE_AGREEMENT_LEGACY_GAP',
        'organization',
        org.id,
        `Organization ${org.name} has no active service agreement in historical data. Admin should find an existing agreement artifact or obtain and register a new signed agreement.`,
      )
    }
  }

  const filteredSites = sites.filter((site) => {
    if (!orgIds.has(site.organization_id)) return false
    const org = orgMap.get(site.organization_id)
    if (!isClientLikeOrg(org)) return false
    if (args.organization && !relevantOrgIds.has(site.organization_id)) return false
    if (args.scope === 'all') return isTruthy(site.is_active)
    return isTruthy(site.is_active) && createdWithin(site.created_at, sinceIso)
  })

  for (const site of filteredSites) {
    if (!hasText(site.site_type)) {
      pushFinding('blocker', 'SITE_TYPE_MISSING', 'client_site', site.id, `Site ${site.name || site.id} is missing site_type.`)
    }

    if (!site.zone_id) {
      pushFinding('blocker', 'SITE_ZONE_MISSING', 'client_site', site.id, `Site ${site.name || site.id} is missing zone_id.`)
    } else {
      const zone = zoneMap.get(site.zone_id)
      if (!zone) {
        pushFinding('blocker', 'SITE_ZONE_NOT_FOUND', 'client_site', site.id, `Site ${site.name || site.id} references missing zone ${site.zone_id}.`)
      } else {
        if (!isTruthy(zone.is_active)) {
          pushFinding('warning', 'SITE_ZONE_INACTIVE', 'client_site', site.id, `Site ${site.name || site.id} references inactive zone ${zone.name || zone.id}.`)
        }
        if (zone.organization_id !== site.organization_id) {
          pushFinding('blocker', 'SITE_ZONE_ORG_MISMATCH', 'client_site', site.id, `Site ${site.name || site.id} organization does not match zone organization.`)
        }
      }
    }

    if (!site.loi_id) {
      pushFinding('blocker', 'SITE_LOI_MISSING', 'client_site', site.id, `Site ${site.name || site.id} is missing loi_id.`)
    } else {
      const loi = loiMap.get(site.loi_id)
      if (!loi) {
        pushFinding('blocker', 'SITE_LOI_NOT_FOUND', 'client_site', site.id, `Site ${site.name || site.id} references missing LOI ${site.loi_id}.`)
      } else if (loi.organization_id !== site.organization_id) {
        pushFinding('blocker', 'SITE_LOI_ORG_MISMATCH', 'client_site', site.id, `Site ${site.name || site.id} LOI organization does not match site organization.`)
      }
    }

    if (!hasLatLng(site.gps_lat, site.gps_lng) && !hasText(site.address) && !hasText(site.city)) {
      pushFinding('warning', 'SITE_LOCATION_MISSING', 'client_site', site.id, `Site ${site.name || site.id} is missing GPS and address context.`)
    }
  }

  const filteredZones = zones.filter((zone) => {
    if (!orgIds.has(zone.organization_id)) return false
    const org = orgMap.get(zone.organization_id)
    if (!isClientLikeOrg(org)) return false
    if (args.organization && !relevantOrgIds.has(zone.organization_id)) return false
    if (args.scope === 'all') return isTruthy(zone.is_active)
    return isTruthy(zone.is_active) && createdWithin(zone.created_at, sinceIso)
  })

  for (const zone of filteredZones) {
    if (!hasText(zone.name)) {
      pushFinding('blocker', 'ZONE_NAME_MISSING', 'zone', zone.id, `Zone ${zone.id} has no name.`)
    }

    const hasGeometry = zone.geometry != null
    const hasPoint = hasLatLng(zone.location_lat, zone.location_lng)
    if (!hasGeometry && !hasPoint) {
      pushFinding('warning', 'ZONE_SPATIAL_DATA_MISSING', 'zone', zone.id, `Zone ${zone.name || zone.id} is missing geometry and location coordinates.`)
    }

    if (!zone.loi_id) {
      pushFinding('blocker', 'ZONE_LOI_MISSING', 'zone', zone.id, `Zone ${zone.name || zone.id} is missing loi_id.`)
    } else {
      const loi = loiMap.get(zone.loi_id)
      if (!loi) {
        pushFinding('blocker', 'ZONE_LOI_NOT_FOUND', 'zone', zone.id, `Zone ${zone.name || zone.id} references missing LOI ${zone.loi_id}.`)
      } else if (loi.organization_id !== zone.organization_id) {
        pushFinding('blocker', 'ZONE_LOI_ORG_MISMATCH', 'zone', zone.id, `Zone ${zone.name || zone.id} LOI organization does not match zone organization.`)
      }
    }
  }

  const filteredLois = lois.filter((loi) => {
    if (!orgIds.has(loi.organization_id)) return false
    const org = orgMap.get(loi.organization_id)
    if (!isClientLikeOrg(org)) return false
    if (args.organization && !relevantOrgIds.has(loi.organization_id)) return false
    if (args.scope === 'all') return isTruthy(loi.is_active)
    return isTruthy(loi.is_active) && createdWithin(loi.created_at, sinceIso)
  })

  for (const loi of filteredLois) {
    const hasSpatial = hasLatLng(loi.gps_lat, loi.gps_lng) || hasText(loi.geofence_geometry)
    const hasAddress = hasText(loi.address_full) || hasText(loi.city)

    if (!hasSpatial && !hasAddress) {
      pushFinding('warning', 'LOI_SPATIAL_AND_ADDRESS_MISSING', 'location_of_interest', loi.id, `LOI ${loi.name || loi.id} is missing both spatial and address context.`)
    }

    const zoneIds = Array.isArray(loi.geo_zone_ids) ? loi.geo_zone_ids : []
    for (const zoneId of zoneIds) {
      const zone = zoneMap.get(zoneId)
      if (!zone) {
        pushFinding('blocker', 'LOI_GEO_ZONE_NOT_FOUND', 'location_of_interest', loi.id, `LOI ${loi.name || loi.id} references missing geo zone ${zoneId}.`)
      } else if (zone.organization_id !== loi.organization_id) {
        pushFinding('blocker', 'LOI_GEO_ZONE_ORG_MISMATCH', 'location_of_interest', loi.id, `LOI ${loi.name || loi.id} geo zone organization does not match LOI organization.`)
      }
    }
  }

  findings.sort((a, b) => {
    const sev = severityOrder(a.severity) - severityOrder(b.severity)
    if (sev !== 0) return sev
    const typeCmp = String(a.entity_type).localeCompare(String(b.entity_type))
    if (typeCmp !== 0) return typeCmp
    return String(a.entity_id).localeCompare(String(b.entity_id))
  })

  const blockers = findings.filter((f) => f.severity === 'blocker').length
  const warnings = findings.filter((f) => f.severity === 'warning').length

  const report = {
    generated_at: new Date().toISOString(),
    scope: args.scope,
    since_days: args.sinceDays,
    organization_filter: args.organization || null,
    pass: blockers === 0,
    summary: {
      organizations_checked: filteredOrgs.length,
      sites_checked: filteredSites.length,
      zones_checked: filteredZones.length,
      lois_checked: filteredLois.length,
      blockers,
      warnings,
    },
    findings,
  }

  await fs.mkdir(args.outDir, { recursive: true })
  const jsonPath = path.join(args.outDir, 'entity-onboarding-readiness.json')
  const mdPath = path.join(args.outDir, 'entity-onboarding-readiness.md')

  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2))
  await fs.writeFile(mdPath, toMarkdown(report))

  console.log(`Readiness report written: ${jsonPath}`)
  console.log(`Readiness report written: ${mdPath}`)
  console.log(`Readiness pass: ${report.pass}`)
  console.log(`Blockers: ${blockers}, Warnings: ${warnings}`)

  if (blockers > 0) process.exitCode = 2
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
