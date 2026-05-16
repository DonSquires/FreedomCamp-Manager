#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const HELP_TEXT = `
Enrich site costing and historical staffing from roster shifts.

Usage:
  node scripts/enrich-site-roster-costing.mjs [options]

Options:
  --apply                  Perform writes. Default is dry-run.
  --create-missing-entities Create missing geofence zones and client sites when possible.
  --global-training        Force global scope (all organizations, all sites).
  --organization-id <id>   Limit to one organization_id.
  --since-date <YYYY-MM-DD>Limit roster history to this shift_date or later.
  --allow-uncertain-writes Allow apply writes even when dossier completion gate reports critical uncertainties.
  --artifact-out <file>    Output artifact JSON (default: logs/site-roster-enrichment-artifact.json).
  --briefings-out <file>   Output admin/officer briefings JSON (default: logs/site-roster-briefings-artifact.json).
  --help, -h               Show help.
`

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseArgs(argv) {
  const args = {
    apply: false,
    createMissingEntities: false,
    globalTraining: false,
    organizationId: '',
    sinceDate: '',
    allowUncertainWrites: false,
    artifactOut: 'logs/site-roster-enrichment-artifact.json',
    briefingsOut: 'logs/site-roster-briefings-artifact.json',
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--apply') {
      args.apply = true
      continue
    }
    if (token === '--create-missing-entities') {
      args.createMissingEntities = true
      continue
    }
    if (token === '--global-training') {
      args.globalTraining = true
      continue
    }
    if (token === '--organization-id' && argv[i + 1]) {
      args.organizationId = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--since-date' && argv[i + 1]) {
      args.sinceDate = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--allow-uncertain-writes') {
      args.allowUncertainWrites = true
      continue
    }
    if (token === '--artifact-out' && argv[i + 1]) {
      args.artifactOut = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--briefings-out' && argv[i + 1]) {
      args.briefingsOut = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--help' || token === '-h') {
      args.help = true
      continue
    }
    throw new Error(`Unknown argument: ${token}`)
  }

  return args
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2))
  }
  return Number(sorted[mid].toFixed(2))
}

function toPositiveNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim())
}

function chunk(array, size) {
  const out = []
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size))
  }
  return out
}

function buildPolygonGeometry(locationLat, locationLng, dLat = 0.001, dLng = 0.001) {
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

function writeArtifact(filePath, payload) {
  const resolved = path.resolve(process.cwd(), filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`Artifact written: ${resolved}`)
}

async function fetchClientSites(supabase, organizationId) {
  const rows = []
  let from = 0
  const pageSize = 1000

  while (true) {
    let query = supabase
      .from('client_sites')
      .select('id, organization_id, name, site_type, zone_id, gps_lat, gps_lng, default_pay_rate, default_charge_rate, is_active')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)

    if (organizationId) {
      query = query.eq('organization_id', organizationId)
    }

    const { data, error } = await query
    if (error) throw new Error(`Failed reading client_sites: ${error.message}`)
    const page = data || []
    rows.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }

  return rows
}

async function fetchRosterShifts(supabase, organizationId, sinceDate) {
  const rows = []
  let from = 0
  const pageSize = 1000

  while (true) {
    let query = supabase
      .from('roster_shifts')
      .select('id, organization_id, client_site_id, officer_id, zone_id, position_title, service_type, shift_date, status, guard_cost_rate, client_charge_rate')
      .order('shift_date', { ascending: false })
      .range(from, from + pageSize - 1)

    if (organizationId) {
      query = query.eq('organization_id', organizationId)
    }
    if (sinceDate) {
      query = query.gte('shift_date', sinceDate)
    }

    const { data, error } = await query
    if (error) throw new Error(`Failed reading roster_shifts: ${error.message}`)
    const page = data || []
    rows.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }

  return rows
}

async function fetchOrganizationsMap(supabase, organizationIds) {
  const ids = Array.from(new Set(organizationIds.filter(Boolean)))
  const map = new Map()
  if (!ids.length) return map

  for (const idsChunk of chunk(ids, 100)) {
    const { data, error } = await supabase
      .from('organizations')
      .select('id, name')
      .in('id', idsChunk)

    if (error) {
      throw new Error(`Failed loading organizations: ${error.message}`)
    }

    for (const row of data || []) {
      map.set(row.id, row.name || row.id)
    }
  }

  return map
}

async function fetchZonesMap(supabase, zoneIds) {
  const ids = Array.from(new Set(zoneIds.filter(Boolean)))
  const map = new Map()
  if (!ids.length) return map

  for (const idsChunk of chunk(ids, 100)) {
    const { data, error } = await supabase
      .from('zones')
      .select('id, organization_id, name, is_active, location_lat, location_lng')
      .in('id', idsChunk)

    if (error) {
      throw new Error(`Failed loading zones: ${error.message}`)
    }

    for (const row of data || []) {
      map.set(row.id, row)
    }
  }

  return map
}

async function fetchIncidentContextBySite(supabase, siteSummaries) {
  const siteIds = Array.from(new Set(siteSummaries.map((site) => site.siteId).filter(Boolean)))
  const siteZonePairs = siteSummaries
    .filter((site) => site.siteId && site.zoneId)
    .map((site) => ({ siteId: site.siteId, zoneId: site.zoneId }))
  const counts = new Map()

  if (!siteIds.length) {
    return { counts, source: 'none', warning: null }
  }

  // Preferred source: direct site linkage table.
  for (const idsChunk of chunk(siteIds, 100)) {
    const { data, error } = await supabase
      .from('site_incidents')
      .select('id, client_site_id')
      .in('client_site_id', idsChunk)

    if (error) {
      break
    }

    for (const row of data || []) {
      const key = row.client_site_id
      if (!key) continue
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }

  if (counts.size > 0) {
    return { counts, source: 'site_incidents', warning: null }
  }

  // Fallback source: incidents linked to zones, then mapped back to sites by zone.
  const zoneIds = Array.from(new Set(siteZonePairs.map((entry) => entry.zoneId).filter(Boolean)))
  const zoneCounts = new Map()

  if (zoneIds.length > 0) {
    for (const idsChunk of chunk(zoneIds, 100)) {
      const { data, error } = await supabase
        .from('incidents')
        .select('id, zone_id')
        .in('zone_id', idsChunk)

      if (error) {
        return {
          counts,
          source: 'unavailable',
          warning: `unable to load incident context from site_incidents or incidents fallback: ${error.message}`,
        }
      }

      for (const row of data || []) {
        const key = row.zone_id
        if (!key) continue
        zoneCounts.set(key, (zoneCounts.get(key) || 0) + 1)
      }
    }
  }

  for (const pair of siteZonePairs) {
    const count = zoneCounts.get(pair.zoneId) || 0
    counts.set(pair.siteId, count)
  }

  return { counts, source: 'incidents_by_zone', warning: null }
}

function hasCoordinates(site) {
  return Number.isFinite(Number(site.gpsLat)) && Number.isFinite(Number(site.gpsLng))
}

function buildSiteResearchDossiers(siteSummaries, organizationMap, zonesMap, incidentContext) {
  return siteSummaries.map((site) => {
    const organizationName = organizationMap.get(site.organizationId) || site.organizationId
    const zone = site.zoneId ? zonesMap.get(site.zoneId) : null
    const issueCount = incidentContext.counts.get(site.siteId) || 0
    const coordsPresent = hasCoordinates(site)

    const criticalUncertainties = []
    if (!site.zoneId) criticalUncertainties.push('missing_zone_mapping')
    if (!coordsPresent) criticalUncertainties.push('missing_site_coordinates')

    const nonCriticalUncertainties = []
    if (!site.totalRosterShifts) nonCriticalUncertainties.push('no_roster_history_for_staffing_context')
    if (!site.defaultPayRate && !site.inferredPayRate) nonCriticalUncertainties.push('missing_pay_rate_context')
    if (!site.defaultChargeRate && !site.inferredChargeRate) nonCriticalUncertainties.push('missing_charge_rate_context')

    const confidence = criticalUncertainties.length > 0 ? 'low' : (nonCriticalUncertainties.length > 0 ? 'medium' : 'high')

    const adminWatchouts = [
      !site.zoneId ? 'Zone ownership/boundary mapping is missing for this site.' : null,
      !coordsPresent ? 'Site coordinates are missing; patrol geofence confidence is reduced.' : null,
      issueCount > 0 ? `Site has ${issueCount} prior incident record(s); monitor repeat patterns.` : null,
    ].filter(Boolean)

    const officerVisitNotes = [
      zone?.name ? `Operate within ${zone.name}; verify handover at boundary edges.` : 'Zone not mapped; confirm jurisdiction before enforcement action.',
      coordsPresent ? 'Use site coordinates as arrival reference and verify exact boundary on approach.' : 'No reliable site coordinates; confirm location with supervisor before attendance.',
      issueCount > 0 ? 'Check recent incident pattern before patrol and collect evidence for repeat issue classes.' : 'No prior incident history available from this enrichment pass.',
    ]

    return {
      entity: {
        organizationId: site.organizationId,
        organizationName,
        siteId: site.siteId,
        siteName: site.siteName,
        zoneId: site.zoneId || null,
        zoneName: zone?.name || null,
      },
      context: {
        clientPurpose: `Operational service location for ${organizationName}.`,
        accessProfile: {
          status: 'needs_verification',
          notes: 'Explicit access instructions were not found in roster-rate enrichment inputs.',
        },
        healthAndSafety: {
          status: 'needs_verification',
          notes: 'No dedicated H&S controls were detected in this data slice; require operator confirmation.',
        },
        previousIssues: {
          incidentCount: issueCount,
          summary: issueCount > 0
            ? `Prior incidents found (${issueCount}). Review recent incident detail in app before actioning.`
            : 'No prior incidents found in reachable dataset for this run.',
        },
      },
      appBriefings: {
        adminWatchouts,
        officerVisitNotes,
      },
      evidence: {
        sources: [
          'client_sites',
          'roster_shifts',
          zone ? 'zones' : null,
          issueCount > 0 ? incidentContext.source : null,
        ].filter(Boolean),
        confidence,
        criticalUncertainties,
        nonCriticalUncertainties,
      },
    }
  })
}

function buildDossierCompletionGate(dossiers) {
  const blockers = []

  for (const dossier of dossiers) {
    if (dossier.evidence.criticalUncertainties.length > 0) {
      blockers.push({
        siteId: dossier.entity.siteId,
        siteName: dossier.entity.siteName,
        issues: dossier.evidence.criticalUncertainties,
      })
    }
  }

  return {
    totalDossiers: dossiers.length,
    dossiersWithCriticalUncertainty: blockers.length,
    blockers,
    pass: blockers.length === 0,
  }
}

function buildBriefingsArtifact(dossiers, args, incidentContext) {
  const summaryBadge = {
    confidence: 'mixed',
    provenance: incidentContext.source,
    warning: incidentContext.warning || null,
    label: `mixed:${incidentContext.source}`,
  }

  const briefings = dossiers.map((dossier) => {
    const hasCritical = dossier.evidence.criticalUncertainties.length > 0
    const adminQueueAction = hasCritical
      ? 'review_required'
      : (dossier.evidence.confidence === 'low' ? 'review_required' : 'ready_for_publish')
    const officerUsageMode = hasCritical
      ? 'hold_for_supervisor_review'
      : (dossier.evidence.confidence === 'high' ? 'operational_primary' : 'advisory_with_confirmation')

    return {
    organizationId: dossier.entity.organizationId,
    organizationName: dossier.entity.organizationName,
    siteId: dossier.entity.siteId,
    siteName: dossier.entity.siteName,
    zoneId: dossier.entity.zoneId,
    zoneName: dossier.entity.zoneName,
    confidence: dossier.evidence.confidence,
    previousIssuesSource: incidentContext.source,
    uiBadge: {
      confidence: dossier.evidence.confidence,
      provenance: incidentContext.source,
      hasWarning: Boolean(incidentContext.warning),
      label: `${dossier.evidence.confidence}:${incidentContext.source}`,
    },
    dataManagementActions: {
      adminQueueAction,
      officerUsageMode,
      requiresHumanReview: hasCritical || dossier.evidence.confidence === 'low',
      staleAfterHours: 168,
    },
    adminBriefing: {
      watchouts: dossier.appBriefings.adminWatchouts,
      previousIssuesSummary: dossier.context.previousIssues.summary,
      previousIssuesSource: incidentContext.source,
      accessStatus: dossier.context.accessProfile.status,
      healthAndSafetyStatus: dossier.context.healthAndSafety.status,
      criticalUncertainties: dossier.evidence.criticalUncertainties,
    },
    officerBriefing: {
      visitNotes: dossier.appBriefings.officerVisitNotes,
      accessNotes: dossier.context.accessProfile.notes,
      healthAndSafetyNotes: dossier.context.healthAndSafety.notes,
      boundaryNotes: dossier.entity.zoneName
        ? [`Operate within ${dossier.entity.zoneName} and verify boundary handover points.`]
        : ['No zone mapping present. Confirm jurisdiction before enforcement action.'],
    },
  }
  })

  const reviewRequiredCount = briefings.filter((entry) => entry.dataManagementActions.requiresHumanReview).length
  const readyForPublishCount = briefings.filter((entry) => entry.dataManagementActions.adminQueueAction === 'ready_for_publish').length

  return {
    runAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    scope: {
      trainingScope: args.globalTraining ? 'global' : 'organization_or_all',
      organizationId: args.organizationId || null,
      sinceDate: args.sinceDate || null,
    },
    summary: {
      totalBriefings: briefings.length,
      lowConfidenceBriefings: briefings.filter((entry) => entry.confidence === 'low').length,
      mediumConfidenceBriefings: briefings.filter((entry) => entry.confidence === 'medium').length,
      highConfidenceBriefings: briefings.filter((entry) => entry.confidence === 'high').length,
      previousIssuesSource: incidentContext.source,
      previousIssuesWarning: incidentContext.warning,
      uiBadge: summaryBadge,
      managementActions: {
        reviewRequiredCount,
        readyForPublishCount,
      },
    },
    briefings,
  }
}

function buildOrgCentroids(clientSites) {
  const accum = new Map()

  for (const site of clientSites) {
    const lat = Number(site.gps_lat)
    const lng = Number(site.gps_lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    if (!accum.has(site.organization_id)) {
      accum.set(site.organization_id, { latTotal: 0, lngTotal: 0, count: 0 })
    }

    const bucket = accum.get(site.organization_id)
    bucket.latTotal += lat
    bucket.lngTotal += lng
    bucket.count += 1
  }

  const centroids = new Map()
  for (const [orgId, bucket] of accum.entries()) {
    if (!bucket.count) continue
    centroids.set(orgId, {
      lat: Number((bucket.latTotal / bucket.count).toFixed(6)),
      lng: Number((bucket.lngTotal / bucket.count).toFixed(6)),
    })
  }

  return centroids
}

function resolveCoordinates(orgCentroids, orgId, siteLat, siteLng) {
  const lat = Number(siteLat)
  const lng = Number(siteLng)
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng, source: 'site' }
  }

  const centroid = orgCentroids.get(orgId)
  if (centroid) {
    return { lat: centroid.lat, lng: centroid.lng, source: 'organization_centroid' }
  }

  // Fallback to central NZ coordinate when no better location data exists.
  return { lat: -41.2865, lng: 174.7762, source: 'nz_fallback' }
}

async function findOrCreateZone(supabase, organizationId, name, payload, dryRun) {
  const { data: existing, error: lookupError } = await supabase
    .from('zones')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('name', name)
    .maybeSingle()

  if (lookupError) throw new Error(`Failed looking up zone ${name}: ${lookupError.message}`)
  if (existing?.id) return existing.id
  if (dryRun) return ''

  const { data: created, error: insertError } = await supabase
    .from('zones')
    .insert({ organization_id: organizationId, name, ...payload })
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed creating zone ${name}: ${insertError?.message || 'Unknown error'}`)
  }

  return created.id
}

async function findOrCreateClientSite(supabase, organizationId, name, payload, dryRun) {
  const { data: existing, error: lookupError } = await supabase
    .from('client_sites')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('name', name)
    .maybeSingle()

  if (lookupError) throw new Error(`Failed looking up site ${name}: ${lookupError.message}`)
  if (existing?.id) return existing.id
  if (dryRun) return ''

  const { data: created, error: insertError } = await supabase
    .from('client_sites')
    .insert({ organization_id: organizationId, name, ...payload })
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed creating site ${name}: ${insertError?.message || 'Unknown error'}`)
  }

  return created.id
}

async function ensureMissingEntities(supabase, args, clientSites, rosterShifts) {
  const orgIds = new Set()
  for (const site of clientSites) orgIds.add(site.organization_id)
  for (const shift of rosterShifts) orgIds.add(shift.organization_id)

  const orgNames = await fetchOrganizationsMap(supabase, Array.from(orgIds))
  const orgCentroids = buildOrgCentroids(clientSites)

  const summary = {
    createMissingEntitiesEnabled: args.createMissingEntities,
    sitesMissingZone: 0,
    zonesCreatedForSites: 0,
    sitesUpdatedWithZone: 0,
    orphanRosterShifts: 0,
    autoSitesCreated: 0,
    autoZonesCreatedForOrphans: 0,
    orphanShiftsLinkedToSites: 0,
  }

  const zoneIdBySiteId = new Map()

  for (const site of clientSites) {
    if (site.zone_id) continue
    summary.sitesMissingZone += 1

    const coords = resolveCoordinates(orgCentroids, site.organization_id, site.gps_lat, site.gps_lng)
    const zoneName = `${site.name} Auto Geofence`

    const zoneId = await findOrCreateZone(
      supabase,
      site.organization_id,
      zoneName,
      {
        description: `Auto-generated geofence for ${site.name} (${coords.source}).`,
        is_active: true,
        location_lat: coords.lat,
        location_lng: coords.lng,
        zone_type: 'service',
        geometry: buildPolygonGeometry(coords.lat, coords.lng),
      },
      !args.apply,
    )

    if (!args.apply) {
      continue
    }

    if (zoneId) {
      zoneIdBySiteId.set(site.id, zoneId)
      const { error: siteUpdateError } = await supabase
        .from('client_sites')
        .update({ zone_id: zoneId })
        .eq('id', site.id)

      if (siteUpdateError) {
        throw new Error(`Failed linking site ${site.id} to new zone: ${siteUpdateError.message}`)
      }
      summary.sitesUpdatedWithZone += 1
      summary.zonesCreatedForSites += 1
    }
  }

  const orphanShifts = rosterShifts.filter((shift) => !shift.client_site_id)
  summary.orphanRosterShifts = orphanShifts.length

  const orphanByOrg = new Map()
  for (const shift of orphanShifts) {
    if (!orphanByOrg.has(shift.organization_id)) orphanByOrg.set(shift.organization_id, [])
    orphanByOrg.get(shift.organization_id).push(shift)
  }

  for (const [orgId, shifts] of orphanByOrg.entries()) {
    const orgName = orgNames.get(orgId) || orgId
    const coords = resolveCoordinates(orgCentroids, orgId, null, null)

    const zoneName = `Auto Zone - ${orgName} Roster Backfill`
    const zoneId = await findOrCreateZone(
      supabase,
      orgId,
      zoneName,
      {
        description: `Auto-generated zone for roster backfill (${coords.source}).`,
        is_active: true,
        location_lat: coords.lat,
        location_lng: coords.lng,
        zone_type: 'service',
        geometry: buildPolygonGeometry(coords.lat, coords.lng),
      },
      !args.apply,
    )

    const siteName = `Auto Site - ${orgName} Roster Backfill`
    const siteId = await findOrCreateClientSite(
      supabase,
      orgId,
      siteName,
      {
        site_type: 'other',
        zone_id: zoneId || null,
        gps_lat: coords.lat,
        gps_lng: coords.lng,
        geofence_radius_metres: 100,
        notes: `Auto-created from orphan roster shifts (${coords.source}).`,
        is_active: true,
      },
      !args.apply,
    )

    if (!args.apply) {
      continue
    }

    if (zoneId) summary.autoZonesCreatedForOrphans += 1
    if (siteId) summary.autoSitesCreated += 1

    const orphanIds = shifts.map((s) => s.id)
    if (siteId && orphanIds.length > 0) {
      const { error: shiftUpdateError } = await supabase
        .from('roster_shifts')
        .update({ client_site_id: siteId })
        .in('id', orphanIds)

      if (shiftUpdateError) {
        throw new Error(`Failed linking orphan roster shifts for org ${orgId}: ${shiftUpdateError.message}`)
      }
      summary.orphanShiftsLinkedToSites += orphanIds.length
    }
  }

  return summary
}

function summarizeSites(clientSites, rosterShifts) {
  const siteMap = new Map()

  for (const site of clientSites) {
    siteMap.set(site.id, {
      siteId: site.id,
      organizationId: site.organization_id,
      siteName: site.name,
      siteType: site.site_type,
      zoneId: site.zone_id,
      gpsLat: site.gps_lat,
      gpsLng: site.gps_lng,
      isActive: Boolean(site.is_active),
      defaultPayRate: toPositiveNumber(site.default_pay_rate),
      defaultChargeRate: toPositiveNumber(site.default_charge_rate),
      totalRosterShifts: 0,
      firstShiftDate: null,
      lastShiftDate: null,
      officerIds: new Set(),
      officerShiftCounts: new Map(),
      historicalPayRates: [],
      historicalChargeRates: [],
      missingPayRateShiftIds: [],
      missingChargeRateShiftIds: [],
    })
  }

  for (const shift of rosterShifts) {
    const siteId = shift.client_site_id
    if (!siteMap.has(siteId)) continue

    const bucket = siteMap.get(siteId)
    bucket.totalRosterShifts += 1

    const shiftDate = String(shift.shift_date || '').trim()
    if (shiftDate && (!bucket.firstShiftDate || shiftDate < bucket.firstShiftDate)) {
      bucket.firstShiftDate = shiftDate
    }
    if (shiftDate && (!bucket.lastShiftDate || shiftDate > bucket.lastShiftDate)) {
      bucket.lastShiftDate = shiftDate
    }

    if (shift.officer_id) {
      bucket.officerIds.add(shift.officer_id)
      const current = bucket.officerShiftCounts.get(shift.officer_id) || 0
      bucket.officerShiftCounts.set(shift.officer_id, current + 1)
    }

    const pay = toPositiveNumber(shift.guard_cost_rate)
    if (pay !== null) {
      bucket.historicalPayRates.push(pay)
    } else {
      bucket.missingPayRateShiftIds.push(shift.id)
    }

    const charge = toPositiveNumber(shift.client_charge_rate)
    if (charge !== null) {
      bucket.historicalChargeRates.push(charge)
    } else {
      bucket.missingChargeRateShiftIds.push(shift.id)
    }
  }

  const summaries = []

  for (const summary of siteMap.values()) {
    const inferredPayRate = median(summary.historicalPayRates)
    const inferredChargeRate = median(summary.historicalChargeRates)

    const effectivePayRate = summary.defaultPayRate || inferredPayRate
    const effectiveChargeRate = summary.defaultChargeRate || inferredChargeRate

    summaries.push({
      ...summary,
      inferredPayRate,
      inferredChargeRate,
      effectivePayRate,
      effectiveChargeRate,
      officerIds: Array.from(summary.officerIds),
      officerShiftCounts: Object.fromEntries(summary.officerShiftCounts),
    })
  }

  return summaries
}

async function applySiteDefaultUpdates(supabase, siteSummaries) {
  let updatedSites = 0

  for (const site of siteSummaries) {
    const payload = {}

    if (!site.defaultPayRate && site.inferredPayRate) {
      payload.default_pay_rate = site.inferredPayRate
    }
    if (!site.defaultChargeRate && site.inferredChargeRate) {
      payload.default_charge_rate = site.inferredChargeRate
    }

    if (Object.keys(payload).length === 0) continue

    const { error } = await supabase
      .from('client_sites')
      .update(payload)
      .eq('id', site.siteId)

    if (error) {
      throw new Error(`Failed updating client_sites ${site.siteId}: ${error.message}`)
    }
    updatedSites += 1
  }

  return updatedSites
}

async function applyRosterShiftRateBackfill(supabase, siteSummaries) {
  let payUpdated = 0
  let chargeUpdated = 0

  for (const site of siteSummaries) {
    if (site.effectivePayRate && site.missingPayRateShiftIds.length > 0) {
      const { error } = await supabase
        .from('roster_shifts')
        .update({ guard_cost_rate: site.effectivePayRate })
        .in('id', site.missingPayRateShiftIds)

      if (error) {
        throw new Error(`Failed backfilling guard_cost_rate for site ${site.siteId}: ${error.message}`)
      }
      payUpdated += site.missingPayRateShiftIds.length
    }

    if (site.effectiveChargeRate && site.missingChargeRateShiftIds.length > 0) {
      const { error } = await supabase
        .from('roster_shifts')
        .update({ client_charge_rate: site.effectiveChargeRate })
        .in('id', site.missingChargeRateShiftIds)

      if (error) {
        throw new Error(`Failed backfilling client_charge_rate for site ${site.siteId}: ${error.message}`)
      }
      chargeUpdated += site.missingChargeRateShiftIds.length
    }
  }

  return { payUpdated, chargeUpdated }
}

function buildTopline(siteSummaries) {
  let sitesWithRosterHistory = 0
  let sitesWithInferredPay = 0
  let sitesWithInferredCharge = 0
  let totalShiftRows = 0
  let shiftsMissingPayRate = 0
  let shiftsMissingChargeRate = 0
  const officerIdSet = new Set()

  for (const site of siteSummaries) {
    totalShiftRows += site.totalRosterShifts
    shiftsMissingPayRate += site.missingPayRateShiftIds.length
    shiftsMissingChargeRate += site.missingChargeRateShiftIds.length
    if (site.totalRosterShifts > 0) sitesWithRosterHistory += 1
    if (!site.defaultPayRate && site.inferredPayRate) sitesWithInferredPay += 1
    if (!site.defaultChargeRate && site.inferredChargeRate) sitesWithInferredCharge += 1
    for (const officerId of site.officerIds) officerIdSet.add(officerId)
  }

  return {
    sitesReviewed: siteSummaries.length,
    sitesWithRosterHistory,
    totalShiftRows,
    distinctOfficersWorked: officerIdSet.size,
    sitesWithInferredPay,
    sitesWithInferredCharge,
    shiftsMissingPayRate,
    shiftsMissingChargeRate,
  }
}

async function fetchOfficerProfiles(supabase, officerIds) {
  const ids = Array.from(new Set(officerIds.filter(Boolean)))
  const map = new Map()
  if (!ids.length) return map

  for (const idsChunk of chunk(ids, 100)) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, first_name, last_name, full_name')
      .in('id', idsChunk)

    if (error) {
      throw new Error(`Failed loading officer profiles: ${error.message}`)
    }

    for (const row of data || []) {
      const name = String(row.full_name || `${row.first_name || ''} ${row.last_name || ''}` || row.id).trim()
      map.set(row.id, name || row.id)
    }
  }

  return map
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP_TEXT.trim())
    process.exit(0)
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  }
  if (args.organizationId && !UUID_RE.test(args.organizationId)) {
    throw new Error('--organization-id must be a valid UUID.')
  }
  if (args.globalTraining && args.organizationId) {
    throw new Error('Use either --global-training or --organization-id, not both.')
  }
  if (args.sinceDate && !isIsoDate(args.sinceDate)) {
    throw new Error('--since-date must be YYYY-MM-DD.')
  }

  if (args.globalTraining) {
    args.organizationId = ''
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(`[Start] mode=${args.apply ? 'apply' : 'dry-run'} scope=${args.globalTraining ? 'global' : (args.organizationId || 'all')} since=${args.sinceDate || 'none'} create_missing_entities=${args.createMissingEntities} allow_uncertain_writes=${args.allowUncertainWrites}`)

  let clientSites = await fetchClientSites(supabase, args.organizationId)
  let rosterShifts = await fetchRosterShifts(supabase, args.organizationId, args.sinceDate)

  const entityProvisioning = args.createMissingEntities
    ? await ensureMissingEntities(supabase, args, clientSites, rosterShifts)
    : {
        createMissingEntitiesEnabled: false,
        sitesMissingZone: 0,
        zonesCreatedForSites: 0,
        sitesUpdatedWithZone: 0,
        orphanRosterShifts: rosterShifts.filter((shift) => !shift.client_site_id).length,
        autoSitesCreated: 0,
        autoZonesCreatedForOrphans: 0,
        orphanShiftsLinkedToSites: 0,
      }

  if (args.apply && args.createMissingEntities) {
    clientSites = await fetchClientSites(supabase, args.organizationId)
    rosterShifts = await fetchRosterShifts(supabase, args.organizationId, args.sinceDate)
  }

  const siteSummaries = summarizeSites(clientSites, rosterShifts)
  const topline = buildTopline(siteSummaries)

  const zoneMap = await fetchZonesMap(supabase, siteSummaries.map((site) => site.zoneId))
  const orgMap = await fetchOrganizationsMap(supabase, siteSummaries.map((site) => site.organizationId))
  const incidentContext = await fetchIncidentContextBySite(supabase, siteSummaries)
  if (incidentContext.warning) {
    console.warn(`Warning: ${incidentContext.warning}`)
  }
  const researchDossiers = buildSiteResearchDossiers(siteSummaries, orgMap, zoneMap, incidentContext)
  const dossierCompletionGate = buildDossierCompletionGate(researchDossiers)

  if (args.apply && !args.allowUncertainWrites && !dossierCompletionGate.pass) {
    throw new Error(`Dossier completion gate failed: ${dossierCompletionGate.dossiersWithCriticalUncertainty} site(s) have critical uncertainties. Re-run with --allow-uncertain-writes only after review.`)
  }

  const allOfficerIds = siteSummaries.flatMap((site) => site.officerIds)
  const officerProfiles = await fetchOfficerProfiles(supabase, allOfficerIds)

  let writeSummary = {
    updatedClientSites: 0,
    updatedRosterShiftPayRates: 0,
    updatedRosterShiftChargeRates: 0,
  }

  if (args.apply) {
    const updatedClientSites = await applySiteDefaultUpdates(supabase, siteSummaries)
    const shiftBackfill = await applyRosterShiftRateBackfill(supabase, siteSummaries)

    writeSummary = {
      updatedClientSites,
      updatedRosterShiftPayRates: shiftBackfill.payUpdated,
      updatedRosterShiftChargeRates: shiftBackfill.chargeUpdated,
    }
  }

  const artifact = {
    runAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    scope: {
      trainingScope: args.globalTraining ? 'global' : 'organization_or_all',
      organizationId: args.organizationId || null,
      sinceDate: args.sinceDate || null,
      allowUncertainWrites: args.allowUncertainWrites,
    },
    entityProvisioning,
    topline,
    incidentContext: {
      source: incidentContext.source,
      warning: incidentContext.warning,
    },
    dossierCompletionGate,
    writes: writeSummary,
    researchDossiers,
    sites: siteSummaries.map((site) => ({
      siteId: site.siteId,
      organizationId: site.organizationId,
      siteName: site.siteName,
      siteType: site.siteType,
      zoneId: site.zoneId,
      gpsLat: site.gpsLat,
      gpsLng: site.gpsLng,
      isActive: site.isActive,
      totalRosterShifts: site.totalRosterShifts,
      firstShiftDate: site.firstShiftDate,
      lastShiftDate: site.lastShiftDate,
      officerIds: site.officerIds,
      staffMembers: site.officerIds
        .map((officerId) => ({
          officerId,
          name: officerProfiles.get(officerId) || officerId,
          shiftCount: site.officerShiftCounts[officerId] || 0,
        }))
        .sort((a, b) => b.shiftCount - a.shiftCount),
      officerShiftCounts: site.officerShiftCounts,
      defaultPayRate: site.defaultPayRate,
      defaultChargeRate: site.defaultChargeRate,
      inferredPayRate: site.inferredPayRate,
      inferredChargeRate: site.inferredChargeRate,
      effectivePayRate: site.effectivePayRate,
      effectiveChargeRate: site.effectiveChargeRate,
      missingPayRateShifts: site.missingPayRateShiftIds.length,
      missingChargeRateShifts: site.missingChargeRateShiftIds.length,
    })),
  }

  const briefingsArtifact = buildBriefingsArtifact(researchDossiers, args, incidentContext)

  writeArtifact(args.artifactOut, artifact)
  writeArtifact(args.briefingsOut, briefingsArtifact)

  console.log('[Summary]')
  console.log(`  sites_reviewed: ${artifact.topline.sitesReviewed}`)
  console.log(`  sites_with_roster_history: ${artifact.topline.sitesWithRosterHistory}`)
  console.log(`  total_shift_rows: ${artifact.topline.totalShiftRows}`)
  console.log(`  distinct_officers_worked: ${artifact.topline.distinctOfficersWorked}`)
  console.log(`  shifts_missing_pay_rate: ${artifact.topline.shiftsMissingPayRate}`)
  console.log(`  shifts_missing_charge_rate: ${artifact.topline.shiftsMissingChargeRate}`)
  console.log(`  orphan_roster_shifts: ${artifact.entityProvisioning.orphanRosterShifts}`)
  console.log(`  orphan_shifts_linked_to_sites: ${artifact.entityProvisioning.orphanShiftsLinkedToSites}`)
  console.log(`  sites_updated_with_zone: ${artifact.entityProvisioning.sitesUpdatedWithZone}`)
  console.log(`  updated_client_sites: ${artifact.writes.updatedClientSites}`)
  console.log(`  updated_roster_shift_pay_rates: ${artifact.writes.updatedRosterShiftPayRates}`)
  console.log(`  updated_roster_shift_charge_rates: ${artifact.writes.updatedRosterShiftChargeRates}`)
  console.log(`  dossiers_total: ${artifact.dossierCompletionGate.totalDossiers}`)
  console.log(`  dossiers_with_critical_uncertainty: ${artifact.dossierCompletionGate.dossiersWithCriticalUncertainty}`)
  console.log(`  briefings_total: ${briefingsArtifact.summary.totalBriefings}`)
}

main().catch((error) => {
  console.error(error?.message || String(error))
  process.exit(1)
})
