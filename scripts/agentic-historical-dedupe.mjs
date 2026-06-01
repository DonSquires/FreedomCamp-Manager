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

function stripTranPrefix(code) {
  const c = normCode(code)
  return c.startsWith('tran-') ? c.slice(5) : c
}

let fallbackRecordedByCache = null

async function getFallbackRecordedBy() {
  if (fallbackRecordedByCache) return fallbackRecordedByCache

  const { data, error } = await supabase
    .from('user_profiles')
    .select('id')
    .limit(1)

  if (error) throw new Error(`resolve fallback recorded_by: ${error.message}`)

  const fallbackId = data?.[0]?.id
  if (!fallbackId) throw new Error('resolve fallback recorded_by: no user_profiles rows found')

  fallbackRecordedByCache = fallbackId
  return fallbackId
}

async function backfillRecordedByForDeletes(observationIds) {
  if (!observationIds.length) return

  const fallbackRecordedBy = await getFallbackRecordedBy()
  const { error } = await supabase
    .from('observations')
    .update({ recorded_by: fallbackRecordedBy })
    .in('observation_id', observationIds)
    .is('recorded_by', null)

  if (error) throw new Error(`backfill observations.recorded_by for delete audit: ${error.message}`)
}

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
  if (tablesStart < 0 || viewsStart < 0) throw new Error('Unable to parse src/types/database.ts')
  const tablesBlock = text.slice(tablesStart, viewsStart)

  const tableNames = [...tablesBlock.matchAll(/^\s{6}([a-zA-Z0-9_]+): \{$/gm)].map((m) => m[1])
  const map = new Map()

  for (const tableName of tableNames) {
    const tableIdx = tablesBlock.indexOf(`      ${tableName}: {`)
    if (tableIdx < 0) continue
    const tail = tablesBlock.slice(tableIdx)
    const rowIdx = tail.indexOf('        Row: {')
    if (rowIdx < 0) continue
    const rowTail = tail.slice(rowIdx + '        Row: {'.length)
    const rowEnd = rowTail.indexOf('\n        }')
    if (rowEnd < 0) continue
    const rowBlock = rowTail.slice(0, rowEnd)
    const cols = new Set([...rowBlock.matchAll(/^\s{10}([a-zA-Z0-9_]+):/gm)].map((m) => m[1]))
    map.set(tableName, cols)
  }

  return map
}

async function countRefs(table, column, ids) {
  if (!ids.length) return 0
  let total = 0
  const chunkSize = 250
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).in(column, chunk)
    if (error) {
      const detail = JSON.stringify({
        message: error.message || null,
        details: error.details || null,
        hint: error.hint || null,
        code: error.code || null,
      })
      throw new Error(`count ${table}.${column}: ${detail}`)
    }
    total += count || 0
  }
  return total
}

async function countRefsSafe(table, column, ids) {
  try {
    const count = await countRefs(table, column, ids)
    return { count, error: null }
  } catch (err) {
    return { count: 0, error: String(err?.message || err) }
  }
}

function deriveActiveTranSiteMoves(activeSites) {
  const grouped = new Map()
  for (const site of activeSites) {
    const key = `${site.organization_id}|${normalize(site.name)}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(site)
  }

  const moves = []
  const skipped = []

  for (const [key, rows] of grouped.entries()) {
    if (rows.length < 2) continue

    // Best-practice safety gate: only auto-merge 2-row TRAN/non-TRAN pairs.
    if (rows.length !== 2) {
      skipped.push({ reason: 'more-than-two-rows', key, rows: rows.map((r) => ({ id: r.id, site_code: r.site_code })) })
      continue
    }

    const [a, b] = rows
    const aTran = normCode(a.site_code).startsWith('tran-')
    const bTran = normCode(b.site_code).startsWith('tran-')

    if (aTran === bTran) {
      skipped.push({ reason: 'no-tran-nontran-pair', key, rows: rows.map((r) => ({ id: r.id, site_code: r.site_code })) })
      continue
    }

    const tran = aTran ? a : b
    const canonical = aTran ? b : a

    const stripped = stripTranPrefix(tran.site_code)
    const canonicalCode = normCode(canonical.site_code)
    const match = canonicalCode === stripped || canonicalCode.endsWith(stripped)
    if (!match) {
      skipped.push({ reason: 'tran-code-not-compatible', key, rows: rows.map((r) => ({ id: r.id, site_code: r.site_code })) })
      continue
    }

    moves.push({
      fromSiteId: tran.id,
      toSiteId: canonical.id,
      organizationId: canonical.organization_id,
      fromZoneId: tran.zone_id,
      toZoneId: canonical.zone_id,
      name: canonical.name,
      fromCode: tran.site_code,
      toCode: canonical.site_code,
    })
  }

  return { moves, skipped }
}

async function gatherDuplicateObservationGroupsByOrg(orgIds) {
  const groups = new Map()

  for (const orgId of orgIds) {
    const { data, error } = await supabase.rpc('get_duplicate_observations', {
      p_limit: 5000,
      p_organization_id: orgId,
    })
    if (error) throw new Error(`get_duplicate_observations(${orgId}): ${error.message}`)

    for (const row of data || []) {
      const ids = Array.isArray(row.observation_ids) ? [...row.observation_ids].sort() : []
      if (ids.length < 2) continue
      const key = `${orgId}|${row.plate_number}|${row.zone_id}|${ids.join(',')}`
      if (!groups.has(key)) groups.set(key, {
        organization_id: orgId,
        plate_number: row.plate_number,
        zone_id: row.zone_id,
        zone_name: row.zone_name,
        observation_ids: ids,
        count: row.count,
      })
    }
  }

  return [...groups.values()]
}

async function discoverLiveColumnTables(candidateTables, column) {
  const live = []
  const skipped = []
  for (const table of candidateTables) {
    const { error } = await supabase.from(table).select(column).limit(1)
    if (error) {
      skipped.push({ table, reason: error.message || 'column probe failed' })
      continue
    }
    live.push(table)
  }
  return { live, skipped }
}

async function chooseCanonicalObservationId(ids) {
  const { data, error } = await supabase
    .from('observations')
    .select('observation_id, recorded_at, created_at')
    .in('observation_id', ids)
  if (error) throw new Error(`fetch observation rows: ${error.message}`)

  const rows = data || []
  if (!rows.length) return null

  rows.sort((x, y) => {
    const ra = String(x.recorded_at || '')
    const rb = String(y.recorded_at || '')
    if (ra !== rb) return ra.localeCompare(rb)
    const ca = String(x.created_at || '')
    const cb = String(y.created_at || '')
    if (ca !== cb) return ca.localeCompare(cb)
    return String(x.observation_id).localeCompare(String(y.observation_id))
  })

  return rows[0].observation_id
}

async function main() {
  const startedAt = new Date().toISOString()
  const tableColumns = parseTablesWithColumnsFromTypes()

  const candidateClientSiteRefTables = [...tableColumns.entries()].filter(([, cols]) => cols.has('client_site_id')).map(([t]) => t)
  const candidateObservationRefTables = [...tableColumns.entries()].filter(([, cols]) => cols.has('observation_id')).map(([t]) => t)

  const discoveredClientSite = await discoverLiveColumnTables(candidateClientSiteRefTables, 'client_site_id')
  const discoveredObservation = await discoverLiveColumnTables(candidateObservationRefTables, 'observation_id')

  const clientSiteRefTables = discoveredClientSite.live
  const observationRefTables = discoveredObservation.live.filter((t) => t !== 'observations')

  const [sites, organizations] = await Promise.all([
    fetchAll('client_sites', 'id,name,site_code,branch_code,organization_id,zone_id,is_active,notes'),
    fetchAll('organizations', 'id,name,is_active'),
  ])

  const activeSites = sites.filter((s) => s.is_active)
  const { moves: activeSiteMoves, skipped: activeSiteSkipped } = deriveActiveTranSiteMoves(activeSites)

  const orgIds = organizations.map((o) => o.id)
  const duplicateObsGroups = await gatherDuplicateObservationGroupsByOrg(orgIds)

  const obsCanonicalPlan = []
  for (const group of duplicateObsGroups) {
    const keepId = await chooseCanonicalObservationId(group.observation_ids)
    if (!keepId) continue
    const removeIds = group.observation_ids.filter((id) => id !== keepId)
    if (!removeIds.length) continue
    obsCanonicalPlan.push({ ...group, keep_id: keepId, remove_ids: removeIds })
  }

  const allObservationRemoveIds = obsCanonicalPlan.flatMap((g) => g.remove_ids)
  const oldToKeep = new Map()
  for (const g of obsCanonicalPlan) {
    for (const oldId of g.remove_ids) oldToKeep.set(oldId, g.keep_id)
  }

  const siteRefCounts = {}
  const skippedSiteRefTables = []
  for (const table of clientSiteRefTables) {
    const result = await countRefsSafe(table, 'client_site_id', activeSiteMoves.map((m) => m.fromSiteId))
    siteRefCounts[table] = result.count
    if (result.error) skippedSiteRefTables.push({ table, error: result.error })
  }

  const obsRefCounts = {}
  const skippedObservationRefTables = []
  for (const table of observationRefTables) {
    const result = await countRefsSafe(table, 'observation_id', allObservationRemoveIds)
    obsRefCounts[table] = result.count
    if (result.error) skippedObservationRefTables.push({ table, error: result.error })
  }

  const applyLog = {
    siteRemaps: 0,
    siteDeletes: 0,
    observationRemaps: 0,
    observationDeletes: 0,
    observationDeleteBlocked: 0,
    tablesTouched: {
      site: [],
      observation: [],
    },
  }

  if (isApply) {
    // 1) Resolve remaining active TRAN duplicates in client_sites.
    for (const move of activeSiteMoves) {
      for (const table of clientSiteRefTables) {
        if (skippedSiteRefTables.some((x) => x.table === table)) continue
        const { error } = await supabase.from(table).update({ client_site_id: move.toSiteId }).eq('client_site_id', move.fromSiteId)
        if (error) throw new Error(`site remap ${table}: ${error.message}`)
        applyLog.siteRemaps += 1
        if (!applyLog.tablesTouched.site.includes(table)) applyLog.tablesTouched.site.push(table)
      }

      const source = sites.find((s) => s.id === move.fromSiteId)
      const note = `[DEDUPE ${new Date().toISOString()}] merged into ${move.toSiteId}`
      const mergedNotes = source?.notes ? `${source.notes}\n${note}` : note
      const { error: markErr } = await supabase.from('client_sites').update({ is_active: false, notes: mergedNotes }).eq('id', move.fromSiteId)
      if (markErr) throw new Error(`site mark inactive ${move.fromSiteId}: ${markErr.message}`)

      const deleteChecks = await Promise.all(clientSiteRefTables.map((t) => countRefs(t, 'client_site_id', [move.fromSiteId])))
      const safeDeleteChecks = await Promise.all(
        clientSiteRefTables
          .filter((t) => !skippedSiteRefTables.some((x) => x.table === t))
          .map((t) => countRefs(t, 'client_site_id', [move.fromSiteId]))
      )
      const stillRefs = safeDeleteChecks.reduce((a, b) => a + b, 0)
      if (stillRefs === 0) {
        const { error: delErr } = await supabase.from('client_sites').delete().eq('id', move.fromSiteId)
        if (delErr) throw new Error(`delete site ${move.fromSiteId}: ${delErr.message}`)
        applyLog.siteDeletes += 1
      }
    }

    // 2) Remap observation references using generated schema tables.
    for (const table of observationRefTables) {
      if (skippedObservationRefTables.some((x) => x.table === table)) continue
      if ((obsRefCounts[table] || 0) === 0) continue
      if (!applyLog.tablesTouched.observation.includes(table)) applyLog.tablesTouched.observation.push(table)

      // Update only referenced rows; per-old-id mapping ensures deterministic target.
      const oldIdsForTable = [...oldToKeep.keys()]
      for (const oldId of oldIdsForTable) {
        const keepId = oldToKeep.get(oldId)
        const { error } = await supabase.from(table).update({ observation_id: keepId }).eq('observation_id', oldId)
        if (error) throw new Error(`observation remap ${table} ${oldId}->${keepId}: ${error.message}`)
        applyLog.observationRemaps += 1
      }
    }

    // 3) Delete duplicate observations that are now unreferenced.
    const knownObservationRefs = Object.values(obsRefCounts).reduce((a, b) => a + Number(b || 0), 0)

    if (knownObservationRefs === 0) {
      // Fast path: no known observation_id references in live schema tables.
      const allRemoveIds = [...oldToKeep.keys()]
      const chunkSize = 250
      for (let i = 0; i < allRemoveIds.length; i += chunkSize) {
        const chunk = allRemoveIds.slice(i, i + chunkSize)
        await backfillRecordedByForDeletes(chunk)
        const { data, error } = await supabase.from('observations').delete().in('observation_id', chunk).select('observation_id')
        if (error) throw new Error(`bulk delete observations: ${error.message}`)
        applyLog.observationDeletes += (data || []).length
      }
    } else {
      for (const oldId of oldToKeep.keys()) {
        let refs = 0
        for (const table of observationRefTables) {
          if (skippedObservationRefTables.some((x) => x.table === table)) continue
          refs += await countRefs(table, 'observation_id', [oldId])
        }
        if (refs > 0) {
          applyLog.observationDeleteBlocked += 1
          continue
        }

        await backfillRecordedByForDeletes([oldId])
        const { error } = await supabase.from('observations').delete().eq('observation_id', oldId)
        if (error) throw new Error(`delete observation ${oldId}: ${error.message}`)
        applyLog.observationDeletes += 1
      }
    }
  }

  const report = {
    mode: isApply ? 'apply' : 'dry-run',
    startedAt,
    completedAt: new Date().toISOString(),
    schema: {
      clientSiteRefTables,
      observationRefTables,
      skippedClientSiteRefTableCandidates: discoveredClientSite.skipped,
      skippedObservationRefTableCandidates: discoveredObservation.skipped,
    },
    sitePhase: {
      activeSiteMoves: activeSiteMoves.length,
      skippedGroups: activeSiteSkipped.length,
      siteRefCounts,
      sampleMoves: activeSiteMoves.slice(0, 50),
      sampleSkipped: activeSiteSkipped.slice(0, 50),
      skippedSiteRefTables,
    },
    historicalObservationPhase: {
      duplicateGroups: duplicateObsGroups.length,
      plannedObservationDeletes: allObservationRemoveIds.length,
      observationRefCounts: obsRefCounts,
      sampleGroups: obsCanonicalPlan.slice(0, 40),
      skippedObservationRefTables,
    },
    applyLog,
  }

  const outDir = path.join(process.cwd(), 'artifacts', 'cleanup')
  mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `agentic-historical-dedupe-${isApply ? 'apply' : 'dry-run'}-${Date.now()}.json`)
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8')

  console.log(JSON.stringify({
    reportPath: outPath,
    summary: {
      mode: report.mode,
      activeSiteMoves: report.sitePhase.activeSiteMoves,
      duplicateObservationGroups: report.historicalObservationPhase.duplicateGroups,
      plannedObservationDeletes: report.historicalObservationPhase.plannedObservationDeletes,
      observationRefTables: report.schema.observationRefTables.length,
      siteDeletes: report.applyLog.siteDeletes,
      observationDeletes: report.applyLog.observationDeletes,
      observationDeleteBlocked: report.applyLog.observationDeleteBlocked,
    },
  }, null, 2))
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
