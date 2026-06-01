#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const isApply = process.argv.includes('--apply')
const deactivateOrphanOrgs = process.argv.includes('--deactivate-orphan-orgs')

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function normalizeCode(value) {
  return String(value || '').trim().toLowerCase()
}

async function fetchAll(table, select = '*', pageSize = 1000) {
  let from = 0
  const rows = []
  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await supabase.from(table).select(select).range(from, to)
    if (error) throw new Error(`${table}: ${error.message}`)
    const page = data || []
    rows.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }
  return rows
}

function buildCandidateMoves(sites, zonesById) {
  const signatureMap = new Map()
  for (const site of sites) {
    const signature = `${normalizeName(site.name)}|${normalizeCode(site.site_code)}|${normalizeCode(site.branch_code)}`
    if (!signatureMap.has(signature)) signatureMap.set(signature, [])
    signatureMap.get(signature).push(site)
  }

  const moves = []
  for (const site of sites) {
    if (!site.is_active || !site.zone_id) continue
    const zone = zonesById.get(site.zone_id)
    if (!zone?.organization_id) continue
    const targetOrgId = zone.organization_id
    if (site.organization_id === targetOrgId) continue

    const signature = `${normalizeName(site.name)}|${normalizeCode(site.site_code)}|${normalizeCode(site.branch_code)}`
    const siblings = signatureMap.get(signature) || []
    const target = siblings.find((other) => other.id !== site.id && other.is_active && other.organization_id === targetOrgId)
    if (!target) continue

    moves.push({
      fromSiteId: site.id,
      toSiteId: target.id,
      fromOrgId: site.organization_id,
      toOrgId: target.organization_id,
      fromZoneId: site.zone_id,
      toZoneId: target.zone_id,
      name: site.name,
      siteCode: site.site_code,
      branchCode: site.branch_code,
      reason: 'duplicate-signature + zone-org canonical target',
    })
  }

  const deduped = new Map()
  for (const move of moves) {
    if (!deduped.has(move.fromSiteId)) deduped.set(move.fromSiteId, move)
  }
  return [...deduped.values()]
}

async function countByClientSite(table, siteIds) {
  if (!siteIds.length) return 0
  const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).in('client_site_id', siteIds)
  if (error) throw new Error(`${table} count: ${error.message}`)
  return count || 0
}

async function updateSiteReferences(table, move) {
  let query = supabase.from(table).update({ client_site_id: move.toSiteId }).eq('client_site_id', move.fromSiteId)

  // Keep org/zone aligned when those columns exist in the table.
  if (table === 'dispatch_jobs' || table === 'roster_shifts') {
    query = supabase
      .from(table)
      .update({
        client_site_id: move.toSiteId,
        organization_id: move.toOrgId,
        zone_id: move.toZoneId ?? null,
      })
      .eq('client_site_id', move.fromSiteId)
  } else if (table === 'site_incidents') {
    query = supabase
      .from(table)
      .update({
        client_site_id: move.toSiteId,
        organization_id: move.toOrgId,
      })
      .eq('client_site_id', move.fromSiteId)
  } else if (table === 'persons_of_interest') {
    query = supabase
      .from(table)
      .update({
        client_site_id: move.toSiteId,
        organization_id: move.toOrgId,
      })
      .eq('client_site_id', move.fromSiteId)
  }

  const { error } = await query
  if (error) throw new Error(`${table} update failed for ${move.fromSiteId}: ${error.message}`)
}

async function removeInvalidExtraOrganizations(users, validOrgIds, apply) {
  const targets = users
    .map((u) => {
      const extras = Array.isArray(u.extra_organization_ids) ? u.extra_organization_ids : []
      const filtered = extras.filter((id) => validOrgIds.has(id))
      if (filtered.length === extras.length) return null
      return {
        userId: u.id,
        email: u.email,
        before: extras,
        after: filtered,
      }
    })
    .filter(Boolean)

  if (apply) {
    for (const target of targets) {
      const { error } = await supabase
        .from('user_profiles')
        .update({ extra_organization_ids: target.after })
        .eq('id', target.userId)
      if (error) throw new Error(`user_profiles extra_organization_ids update failed for ${target.email}: ${error.message}`)
    }
  }

  return targets
}

async function maybeDeactivateOrphanOrgs(sourceOrgIds, allUsers, allSites, apply) {
  const userOrgRefs = new Set()
  for (const u of allUsers) {
    if (u.organization_id) userOrgRefs.add(u.organization_id)
    if (u.employer_organization_id) userOrgRefs.add(u.employer_organization_id)
    const extras = Array.isArray(u.extra_organization_ids) ? u.extra_organization_ids : []
    for (const id of extras) userOrgRefs.add(id)
  }

  const activeSiteCounts = new Map()
  for (const s of allSites) {
    if (!s.organization_id || !s.is_active) continue
    activeSiteCounts.set(s.organization_id, (activeSiteCounts.get(s.organization_id) || 0) + 1)
  }

  const orphanOrgs = [...new Set(sourceOrgIds)].filter((orgId) => {
    const hasUsers = userOrgRefs.has(orgId)
    const hasActiveSites = (activeSiteCounts.get(orgId) || 0) > 0
    return !hasUsers && !hasActiveSites
  })

  if (apply && orphanOrgs.length) {
    const { error } = await supabase.from('organizations').update({ is_active: false }).in('id', orphanOrgs)
    if (error) throw new Error(`organizations deactivation failed: ${error.message}`)
  }

  return orphanOrgs
}

async function main() {
  const startedAt = new Date().toISOString()

  const [organizations, users, sites, zones] = await Promise.all([
    fetchAll('organizations', 'id,name,is_active,organization_type,parent_organization_id'),
    fetchAll('user_profiles', 'id,email,role,organization_id,employer_organization_id,extra_organization_ids,is_active'),
    fetchAll('client_sites', 'id,name,site_code,branch_code,organization_id,zone_id,is_active,notes'),
    fetchAll('zones', 'id,name,organization_id,is_active'),
  ])

  const zonesById = new Map(zones.map((z) => [z.id, z]))
  const orgsById = new Map(organizations.map((o) => [o.id, o]))

  const candidateMoves = buildCandidateMoves(sites, zonesById)
  const sourceSiteIds = candidateMoves.map((m) => m.fromSiteId)

  const refCounts = {
    dispatch_jobs: await countByClientSite('dispatch_jobs', sourceSiteIds),
    persons_of_interest: await countByClientSite('persons_of_interest', sourceSiteIds),
    roster_shifts: await countByClientSite('roster_shifts', sourceSiteIds),
    site_incidents: await countByClientSite('site_incidents', sourceSiteIds),
  }

  let appliedMoves = []
  let softDeletedSites = []

  if (isApply) {
    for (const move of candidateMoves) {
      await updateSiteReferences('dispatch_jobs', move)
      await updateSiteReferences('persons_of_interest', move)
      await updateSiteReferences('roster_shifts', move)
      await updateSiteReferences('site_incidents', move)

      const note = `[LEGACY_MERGE ${new Date().toISOString()}] merged into ${move.toSiteId}`
      const prev = sites.find((s) => s.id === move.fromSiteId)?.notes
      const mergedNotes = prev ? `${prev}\n${note}` : note

      const { error } = await supabase
        .from('client_sites')
        .update({ is_active: false, notes: mergedNotes })
        .eq('id', move.fromSiteId)
      if (error) throw new Error(`client_sites deactivate failed for ${move.fromSiteId}: ${error.message}`)

      appliedMoves.push(move)
      softDeletedSites.push(move.fromSiteId)
    }
  }

  const validOrgIds = new Set(organizations.map((o) => o.id))
  const extraOrgFixes = await removeInvalidExtraOrganizations(users, validOrgIds, isApply)

  const sourceOrgIds = candidateMoves.map((m) => m.fromOrgId)
  const orphanOrgs = deactivateOrphanOrgs
    ? await maybeDeactivateOrphanOrgs(sourceOrgIds, users, sites, isApply)
    : []

  const report = {
    mode: isApply ? 'apply' : 'dry-run',
    startedAt,
    completedAt: new Date().toISOString(),
    totals: {
      organizations: organizations.length,
      users: users.length,
      sites: sites.length,
      zones: zones.length,
    },
    candidateMovesCount: candidateMoves.length,
    referenceCountsForSourceSites: refCounts,
    candidateMoves: candidateMoves.map((m) => ({
      ...m,
      fromOrgName: orgsById.get(m.fromOrgId)?.name || null,
      toOrgName: orgsById.get(m.toOrgId)?.name || null,
      fromZoneName: zonesById.get(m.fromZoneId)?.name || null,
      toZoneName: zonesById.get(m.toZoneId)?.name || null,
    })),
    appliedMovesCount: appliedMoves.length,
    softDeletedSitesCount: softDeletedSites.length,
    extraOrganizationCleanupCount: extraOrgFixes.length,
    extraOrganizationCleanupUsers: extraOrgFixes,
    orphanOrganizationsDeactivatedCount: orphanOrgs.length,
    orphanOrganizationsDeactivated: orphanOrgs.map((id) => ({ id, name: orgsById.get(id)?.name || null })),
    flags: {
      deactivateOrphanOrgs,
    },
  }

  const outDir = path.join(process.cwd(), 'artifacts', 'cleanup')
  mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `legacy-site-org-cleanup-${isApply ? 'apply' : 'dry-run'}-${Date.now()}.json`)
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')

  console.log(JSON.stringify({ reportPath: outPath, summary: {
    mode: report.mode,
    candidateMovesCount: report.candidateMovesCount,
    appliedMovesCount: report.appliedMovesCount,
    softDeletedSitesCount: report.softDeletedSitesCount,
    extraOrganizationCleanupCount: report.extraOrganizationCleanupCount,
    orphanOrganizationsDeactivatedCount: report.orphanOrganizationsDeactivatedCount,
  } }, null, 2))
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
