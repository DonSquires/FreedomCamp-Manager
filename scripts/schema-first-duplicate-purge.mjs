#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const isApply = process.argv.includes('--apply')

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

const normalize = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
const normCode = (s) => String(s || '').trim().toLowerCase()

async function fetchAll(table, select = '*', pageSize = 1000) {
  let from = 0
  const out = []
  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await supabase.from(table).select(select).range(from, to)
    if (error) throw new Error(`${table}: ${error.message}`)
    const rows = data || []
    out.push(...rows)
    if (rows.length < pageSize) break
    from += pageSize
  }
  return out
}

function parseTablesWithColumnsFromTypes() {
  const typesPath = path.join(process.cwd(), 'src', 'types', 'database.ts')
  const text = readFileSync(typesPath, 'utf8')

  const tablesStart = text.indexOf('Tables: {')
  const viewsStart = text.indexOf('Views: {', tablesStart)
  if (tablesStart < 0 || viewsStart < 0) {
    throw new Error('Unable to locate Tables/Views blocks in src/types/database.ts')
  }

  const tablesBlock = text.slice(tablesStart, viewsStart)
  const tableNames = [...tablesBlock.matchAll(/^\s{6}([a-zA-Z0-9_]+): \{$/gm)].map((m) => m[1])
  const tableMap = new Map()

  for (const tableName of tableNames) {
    const tableIdx = tablesBlock.indexOf(`      ${tableName}: {`)
    if (tableIdx < 0) continue
    const afterTable = tablesBlock.slice(tableIdx)
    const rowIdx = afterTable.indexOf('        Row: {')
    if (rowIdx < 0) continue
    const rowStart = rowIdx + '        Row: {'.length
    const rowTail = afterTable.slice(rowStart)
    const rowEnd = rowTail.indexOf('\n        }')
    if (rowEnd < 0) continue
    const rowBlock = rowTail.slice(0, rowEnd)

    const cols = [...rowBlock.matchAll(/^\s{10}([a-zA-Z0-9_]+):/gm)].map((m) => m[1])
    tableMap.set(tableName, new Set(cols))
  }

  return tableMap
}

async function countReferences(table, column, ids) {
  if (!ids.length) return 0
  const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).in(column, ids)
  if (error) throw new Error(`count ${table}.${column}: ${error.message}`)
  return count || 0
}

async function remapReferences(table, column, fromId, toId) {
  const { error } = await supabase.from(table).update({ [column]: toId }).eq(column, fromId)
  if (error) throw new Error(`remap ${table}.${column} ${fromId}->${toId}: ${error.message}`)
}

function chooseCanonicalSiteTarget(duplicateSite, sites, zonesById) {
  const keyName = normalize(duplicateSite.name)
  const keyCode = normCode(duplicateSite.site_code)
  const keyBranch = normCode(duplicateSite.branch_code)

  // Strongest candidate: active site with same normalized name+site_code+branch_code.
  const exact = sites.filter((s) =>
    s.id !== duplicateSite.id &&
    s.is_active &&
    normalize(s.name) === keyName &&
    normCode(s.site_code) === keyCode &&
    normCode(s.branch_code) === keyBranch
  )
  if (exact.length === 1) return exact[0]

  // Next best: active site with same name+site_code, and org aligned to source zone org.
  const zoneOrg = duplicateSite.zone_id ? zonesById.get(duplicateSite.zone_id)?.organization_id : null
  const codeMatches = sites.filter((s) =>
    s.id !== duplicateSite.id &&
    s.is_active &&
    normalize(s.name) === keyName &&
    normCode(s.site_code) === keyCode
  )

  if (zoneOrg) {
    const aligned = codeMatches.filter((s) => s.organization_id === zoneOrg)
    if (aligned.length === 1) return aligned[0]
  }

  if (codeMatches.length === 1) return codeMatches[0]
  return null
}

async function main() {
  const startedAt = new Date().toISOString()
  const tableColumns = parseTablesWithColumnsFromTypes()

  const [sites, zones, organizations, users] = await Promise.all([
    fetchAll('client_sites', 'id,name,site_code,branch_code,organization_id,zone_id,is_active,notes,created_at'),
    fetchAll('zones', 'id,name,organization_id,is_active'),
    fetchAll('organizations', 'id,name,is_active,organization_type,parent_organization_id'),
    fetchAll('user_profiles', 'id,email,organization_id,employer_organization_id,extra_organization_ids,is_active'),
  ])

  const zonesById = new Map(zones.map((z) => [z.id, z]))
  const orgById = new Map(organizations.map((o) => [o.id, o]))
  const validOrgIds = new Set(organizations.map((o) => o.id))

  // Discover reference columns by schema map.
  const clientSiteRefTables = [...tableColumns.entries()]
    .filter(([, cols]) => cols.has('client_site_id'))
    .map(([table]) => table)

  const organizationRefTables = [...tableColumns.entries()]
    .filter(([, cols]) => cols.has('organization_id'))
    .map(([table]) => table)

  const candidateDuplicateSites = sites.filter((s) => !s.is_active)
  const siteMoves = []
  const ambiguousSites = []

  for (const oldSite of candidateDuplicateSites) {
    const target = chooseCanonicalSiteTarget(oldSite, sites, zonesById)
    if (target) {
      siteMoves.push({
        fromSiteId: oldSite.id,
        toSiteId: target.id,
        name: oldSite.name,
        siteCode: oldSite.site_code,
        branchCode: oldSite.branch_code,
        fromOrgId: oldSite.organization_id,
        toOrgId: target.organization_id,
        fromZoneId: oldSite.zone_id,
        toZoneId: target.zone_id,
      })
    } else {
      ambiguousSites.push({
        siteId: oldSite.id,
        name: oldSite.name,
        siteCode: oldSite.site_code,
        branchCode: oldSite.branch_code,
        organizationId: oldSite.organization_id,
      })
    }
  }

  const sourceSiteIds = siteMoves.map((m) => m.fromSiteId)

  const siteReferenceCounts = {}
  for (const table of clientSiteRefTables) {
    siteReferenceCounts[table] = await countReferences(table, 'client_site_id', sourceSiteIds)
  }

  // Cleanup users with invalid extra org IDs (schema correctness).
  const invalidExtraOrgFixes = users
    .map((u) => {
      const extras = Array.isArray(u.extra_organization_ids) ? u.extra_organization_ids : []
      const cleaned = extras.filter((id) => validOrgIds.has(id))
      if (cleaned.length === extras.length) return null
      return {
        userId: u.id,
        email: u.email,
        before: extras,
        after: cleaned,
      }
    })
    .filter(Boolean)

  const applyLog = {
    remappedByTable: {},
    deletedSites: [],
    deletedOrganizations: [],
    deletedUsers: [],
  }

  if (isApply) {
    for (const move of siteMoves) {
      for (const table of clientSiteRefTables) {
        await remapReferences(table, 'client_site_id', move.fromSiteId, move.toSiteId)
        applyLog.remappedByTable[table] = (applyLog.remappedByTable[table] || 0) + 1
      }

      // Keep organization/zone aligned where columns exist and a site FK exists.
      for (const table of organizationRefTables) {
        if (!clientSiteRefTables.includes(table)) continue
        if (!tableColumns.get(table)?.has('zone_id')) {
          await supabase
            .from(table)
            .update({ organization_id: move.toOrgId })
            .eq('client_site_id', move.toSiteId)
            .eq('organization_id', move.fromOrgId)
        } else {
          await supabase
            .from(table)
            .update({ organization_id: move.toOrgId, zone_id: move.toZoneId ?? null })
            .eq('client_site_id', move.toSiteId)
            .eq('organization_id', move.fromOrgId)
        }
      }
    }

    for (const fix of invalidExtraOrgFixes) {
      const { error } = await supabase.from('user_profiles').update({ extra_organization_ids: fix.after }).eq('id', fix.userId)
      if (error) throw new Error(`user_profiles extra_organization_ids for ${fix.email}: ${error.message}`)
    }

    // Re-check references before delete.
    const blockedForDelete = []
    for (const move of siteMoves) {
      let totalRefs = 0
      for (const table of clientSiteRefTables) {
        totalRefs += await countReferences(table, 'client_site_id', [move.fromSiteId])
      }
      if (totalRefs > 0) {
        blockedForDelete.push({ siteId: move.fromSiteId, totalRefs })
        continue
      }

      const { error } = await supabase.from('client_sites').delete().eq('id', move.fromSiteId)
      if (error) throw new Error(`delete client_sites ${move.fromSiteId}: ${error.message}`)
      applyLog.deletedSites.push(move.fromSiteId)
    }

    applyLog.blockedSiteDeletes = blockedForDelete

    // Delete unreferenced inactive org duplicates only (none expected, but enforce schema cleanliness).
    const orgByNormName = new Map()
    for (const o of organizations) {
      const k = normalize(o.name)
      if (!k) continue
      if (!orgByNormName.has(k)) orgByNormName.set(k, [])
      orgByNormName.get(k).push(o)
    }

    const duplicateOrgGroups = [...orgByNormName.values()].filter((rows) => rows.length > 1)

    for (const group of duplicateOrgGroups) {
      const activeSorted = [...group].sort((a, b) => Number(b.is_active) - Number(a.is_active))
      const keep = activeSorted[0]
      for (const candidate of group.slice(1)) {
        let orgRefs = 0
        for (const table of organizationRefTables) {
          orgRefs += await countReferences(table, 'organization_id', [candidate.id])
        }
        if (orgRefs > 0) continue
        const { error } = await supabase.from('organizations').delete().eq('id', candidate.id)
        if (error) throw new Error(`delete organizations ${candidate.id}: ${error.message}`)
        applyLog.deletedOrganizations.push({ orgId: candidate.id, keptOrgId: keep.id })
      }
    }

    // Delete user duplicates only when exact duplicate email exists and losing rows have no references (none expected).
    const byEmail = new Map()
    for (const u of users) {
      const e = String(u.email || '').trim().toLowerCase()
      if (!e) continue
      if (!byEmail.has(e)) byEmail.set(e, [])
      byEmail.get(e).push(u)
    }

    const duplicateUsers = [...byEmail.entries()].filter(([, rows]) => rows.length > 1)
    if (duplicateUsers.length > 0) {
      // We intentionally do not auto-delete user rows without explicit full FK/user-id remap map.
      applyLog.deletedUsers = []
      applyLog.userDuplicateWarning = 'Duplicate emails found; skipped hard deletes for safety.'
    }
  }

  const report = {
    mode: isApply ? 'apply' : 'dry-run',
    startedAt,
    completedAt: new Date().toISOString(),
    discoveredSchema: {
      tablesWithOrganizationId: organizationRefTables.length,
      tablesWithClientSiteId: clientSiteRefTables.length,
      clientSiteRefTables,
    },
    candidates: {
      inactiveSites: candidateDuplicateSites.length,
      siteMoveCandidates: siteMoves.length,
      ambiguousSites: ambiguousSites.length,
      invalidExtraOrgUsers: invalidExtraOrgFixes.length,
    },
    siteReferenceCounts,
    moves: siteMoves.map((m) => ({
      ...m,
      fromOrgName: orgById.get(m.fromOrgId)?.name || null,
      toOrgName: orgById.get(m.toOrgId)?.name || null,
      fromZoneName: zonesById.get(m.fromZoneId)?.name || null,
      toZoneName: zonesById.get(m.toZoneId)?.name || null,
    })),
    ambiguousSites: ambiguousSites.slice(0, 200),
    invalidExtraOrgFixes,
    applyLog,
  }

  const outDir = path.join(process.cwd(), 'artifacts', 'cleanup')
  mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `schema-first-duplicate-purge-${isApply ? 'apply' : 'dry-run'}-${Date.now()}.json`)
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')

  console.log(JSON.stringify({
    reportPath: outPath,
    summary: {
      mode: report.mode,
      tablesWithClientSiteId: report.discoveredSchema.tablesWithClientSiteId,
      siteMoveCandidates: report.candidates.siteMoveCandidates,
      invalidExtraOrgUsers: report.candidates.invalidExtraOrgUsers,
      deletedSites: report.applyLog.deletedSites.length,
      deletedOrganizations: report.applyLog.deletedOrganizations.length,
      deletedUsers: report.applyLog.deletedUsers.length,
    },
  }, null, 2))
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
