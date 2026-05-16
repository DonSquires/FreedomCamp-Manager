#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const HELP_TEXT = `
Build an all-bucket roster source inventory for Bob training.

Usage:
  node scripts/roster-source-inventory.mjs [options]

Options:
  --artifact-out <file>       Artifact path (default: logs/roster-source-inventory.json)
  --limit-per-bucket <n>      Max files scanned per bucket (default: 5000)
  --include-bucket <name>     Restrict scan to one bucket (repeatable)
  --help, -h                  Show help
`

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEPUTY_RE = /deputy/i
const ROSTER_RE = /(roster|timesheet|time[-_ ]?sheet|shift|schedule|payroll|duty)/i

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function inferDocumentStyle(file) {
  const name = String(file.name || '')
  const lower = name.toLowerCase()
  const pathLower = String(file.path || '').toLowerCase()
  const ext = lower.includes('.') ? lower.split('.').pop() : ''
  const hasDeputy = DEPUTY_RE.test(`${pathLower} ${lower}`)
  const hasRosterSignals = ROSTER_RE.test(`${pathLower} ${lower}`)

  if (lower === '.emptyfolderplaceholder') return 'placeholder'
  if (hasDeputy && ext === 'csv') return 'deputy_csv_export'
  if (hasDeputy && ['xlsx', 'xls'].includes(ext || '')) return 'deputy_spreadsheet_export'
  if (hasDeputy) return 'deputy_document'
  if (hasRosterSignals && ext === 'csv') return 'roster_csv_export'
  if (hasRosterSignals && ['xlsx', 'xls'].includes(ext || '')) return 'roster_spreadsheet'
  if (hasRosterSignals && ['doc', 'docx'].includes(ext || '')) return 'roster_word_document'
  return 'roster_misc'
}

function insightsForStyle(style) {
  if (style === 'deputy_csv_export' || style === 'deputy_spreadsheet_export' || style === 'deputy_document') {
    return [
      'shift rosters and assignments',
      'worked staff members per site',
      'site/location mapping from Deputy labels',
      'payroll or timesheet evidence if included',
    ]
  }
  if (style === 'roster_csv_export' || style === 'roster_spreadsheet') {
    return [
      'shift schedule dates and times',
      'officer staffing coverage',
      'site-level service cadence',
      'possible pay/charge rate references',
    ]
  }
  if (style === 'roster_word_document') {
    return [
      'service schedule narratives',
      'policy and roster operating constraints',
      'site-specific instructions and notes',
    ]
  }
  if (style === 'placeholder') {
    return ['no operational data (placeholder only)']
  }
  return [
    'possible roster-related metadata',
    'requires manual review for extractable fields',
  ]
}

function buildOrganizationNameIndex(organizations) {
  return organizations
    .map((org) => ({
      organizationId: org.id,
      organizationName: org.name || org.id,
      needle: normalizeText(org.name),
    }))
    .filter((entry) => entry.needle.length >= 4)
}

function buildSiteNameIndex(clientSites) {
  return clientSites
    .map((site) => ({
      siteId: site.id,
      siteName: site.name || site.id,
      organizationId: site.organization_id,
      needle: normalizeText(site.name),
    }))
    .filter((entry) => entry.needle.length >= 4)
}

function inferCandidatesFromNames(file, orgIndex, siteIndex) {
  const haystack = normalizeText(`${file.bucket} ${file.path} ${file.name}`)
  const organizationCandidates = []
  const siteCandidates = []
  const seenOrg = new Set()
  const seenSite = new Set()

  for (const org of orgIndex) {
    if (haystack.includes(org.needle) && !seenOrg.has(org.organizationId)) {
      seenOrg.add(org.organizationId)
      organizationCandidates.push({
        organizationId: org.organizationId,
        organizationName: org.organizationName,
        confidence: 'name_match',
      })
    }
  }

  for (const site of siteIndex) {
    if (haystack.includes(site.needle) && !seenSite.has(site.siteId)) {
      seenSite.add(site.siteId)
      siteCandidates.push({
        siteId: site.siteId,
        siteName: site.siteName,
        organizationId: site.organizationId,
        confidence: 'name_match',
      })
    }
  }

  return { organizationCandidates, siteCandidates }
}

function parseArgs(argv) {
  const args = {
    artifactOut: 'logs/roster-source-inventory.json',
    limitPerBucket: 5000,
    includeBuckets: [],
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--artifact-out' && argv[i + 1]) {
      args.artifactOut = String(argv[i + 1]).trim()
      i += 1
      continue
    }
    if (token === '--limit-per-bucket' && argv[i + 1]) {
      const parsed = Number.parseInt(String(argv[i + 1]), 10)
      if (Number.isFinite(parsed) && parsed > 0) args.limitPerBucket = parsed
      i += 1
      continue
    }
    if (token === '--include-bucket' && argv[i + 1]) {
      const bucket = String(argv[i + 1]).trim()
      if (bucket) args.includeBuckets.push(bucket)
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

function writeArtifact(filePath, payload) {
  const resolved = path.resolve(process.cwd(), filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`Artifact written: ${resolved}`)
}

function inferOrgIdsFromPath(storagePath) {
  const out = []
  const seen = new Set()
  const parts = String(storagePath || '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)

  for (const part of parts) {
    const value = String(part).trim()
    if (UUID_RE.test(value) && !seen.has(value)) {
      seen.add(value)
      out.push(value)
    }
  }

  return out
}

async function listBucketFiles(supabase, bucket, limitPerBucket) {
  const files = []
  const queue = ['']

  while (queue.length > 0 && files.length < limitPerBucket) {
    const prefix = queue.shift() || ''
    let offset = 0

    while (files.length < limitPerBucket) {
      const { data, error } = await supabase.storage.from(bucket).list(prefix, {
        limit: 100,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })

      if (error) {
        throw new Error(`Failed listing bucket "${bucket}" at prefix "${prefix}": ${error.message}`)
      }

      const page = data || []
      for (const item of page) {
        const itemPath = [prefix, item.name].filter(Boolean).join('/')
        const isFolder = !item.id && !item.metadata
        if (isFolder) {
          queue.push(itemPath)
        } else if (files.length < limitPerBucket) {
          files.push({
            bucket,
            path: itemPath,
            name: item.name,
            mimeType: item.metadata?.mimetype || null,
            size: item.metadata?.size || null,
          })
        }
      }

      if (page.length < 100) break
      offset += 100
    }
  }

  return files
}

async function fetchOrganizations(supabase) {
  const rows = []
  let from = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('organizations')
      .select('id, name')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(`Failed loading organizations: ${error.message}`)
    const page = data || []
    rows.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }

  return rows
}

async function fetchClientSites(supabase) {
  const rows = []
  let from = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('client_sites')
      .select('id, organization_id, name')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(`Failed loading client_sites: ${error.message}`)
    const page = data || []
    rows.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }

  return rows
}

async function fetchClientSiteOrgIds(supabase) {
  const ids = new Set()
  let from = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('client_sites')
      .select('organization_id')
      .order('organization_id', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) throw new Error(`Failed loading client_sites organization IDs: ${error.message}`)
    const page = data || []
    for (const row of page) {
      if (row.organization_id) ids.add(row.organization_id)
    }
    if (page.length < pageSize) break
    from += pageSize
  }

  return ids
}

function classifyRosterFiles(files, orgIndex, siteIndex) {
  const deputyFiles = []
  const rosterFiles = []
  const styleCounts = {}

  for (const file of files) {
    const combined = `${file.path} ${file.name}`
    const isDeputy = DEPUTY_RE.test(combined)
    const isRoster = ROSTER_RE.test(combined) || isDeputy
    if (!isRoster) continue

    const orgIds = inferOrgIdsFromPath(file.path)
    const style = inferDocumentStyle(file)
    const insights = insightsForStyle(style)
    const candidates = inferCandidatesFromNames(file, orgIndex, siteIndex)

    styleCounts[style] = (styleCounts[style] || 0) + 1

    const record = {
      bucket: file.bucket,
      path: file.path,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      documentStyle: style,
      extractableInsights: insights,
      inferredOrganizationIds: orgIds,
      organizationCandidates: candidates.organizationCandidates,
      siteCandidates: candidates.siteCandidates,
      sourceType: isDeputy ? 'deputy' : 'other_roster',
    }

    if (isDeputy) deputyFiles.push(record)
    else rosterFiles.push(record)
  }

  return { deputyFiles, rosterFiles, styleCounts }
}

function buildOrgCoverageMap(allRosterFiles, orgMap) {
  const coverage = new Map()

  for (const file of allRosterFiles) {
    const inferred = [
      ...(file.inferredOrganizationIds || []),
      ...((file.organizationCandidates || []).map((candidate) => candidate.organizationId)),
    ]
    const uniqueOrgIds = Array.from(new Set(inferred.filter(Boolean)))
    if (uniqueOrgIds.length === 0) continue

    for (const orgId of uniqueOrgIds) {
      if (!coverage.has(orgId)) {
        coverage.set(orgId, {
          organizationId: orgId,
          organizationName: orgMap.get(orgId) || orgId,
          deputyFileCount: 0,
          otherRosterFileCount: 0,
          samplePaths: [],
        })
      }

      const entry = coverage.get(orgId)
      if (file.sourceType === 'deputy') entry.deputyFileCount += 1
      else entry.otherRosterFileCount += 1
      if (entry.samplePaths.length < 5) {
        entry.samplePaths.push(`${file.bucket}/${file.path}`)
      }
    }
  }

  return coverage
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

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: allBuckets, error: bucketError } = await supabase.storage.listBuckets()
  if (bucketError) {
    throw new Error(`Failed listing storage buckets: ${bucketError.message}`)
  }

  const include = new Set(args.includeBuckets)
  const buckets = (allBuckets || [])
    .map((b) => b.name)
    .filter((name) => !include.size || include.has(name))

  const allFiles = []
  const bucketScanStats = []

  for (const bucket of buckets) {
    const files = await listBucketFiles(supabase, bucket, args.limitPerBucket)
    allFiles.push(...files)
    bucketScanStats.push({ bucket, scannedFiles: files.length, cappedAt: args.limitPerBucket })
  }

  const organizations = await fetchOrganizations(supabase)
  const clientSites = await fetchClientSites(supabase)
  const clientSiteOrgIds = await fetchClientSiteOrgIds(supabase)

  const orgMap = new Map(organizations.map((org) => [org.id, org.name || org.id]))
  const orgIndex = buildOrganizationNameIndex(organizations)
  const siteIndex = buildSiteNameIndex(clientSites)
  const classified = classifyRosterFiles(allFiles, orgIndex, siteIndex)
  const deputyFiles = classified.deputyFiles
  const rosterFiles = classified.rosterFiles
  const styleCounts = classified.styleCounts
  const allRoster = [...deputyFiles, ...rosterFiles]

  const orgCoverage = buildOrgCoverageMap(allRoster, orgMap)

  const missingRosterSourceForSiteOrgs = []
  for (const orgId of clientSiteOrgIds) {
    if (!orgCoverage.has(orgId)) {
      missingRosterSourceForSiteOrgs.push({
        organizationId: orgId,
        organizationName: orgMap.get(orgId) || orgId,
      })
    }
  }

  const rosterFilesWithoutOrgInference = allRoster
    .filter((file) => !file.inferredOrganizationIds?.length)
    .map((file) => ({
      bucket: file.bucket,
      path: file.path,
      sourceType: file.sourceType,
    }))

  const artifact = {
    runAt: new Date().toISOString(),
    settings: {
      limitPerBucket: args.limitPerBucket,
      includeBuckets: args.includeBuckets,
    },
    bucketScanStats,
    summary: {
      bucketsScanned: buckets.length,
      filesScanned: allFiles.length,
      deputyFilesFound: deputyFiles.length,
      otherRosterFilesFound: rosterFiles.length,
      rosterDocumentStyles: styleCounts,
      rosterFilesWithoutOrgInference: rosterFilesWithoutOrgInference.length,
      siteOrganizationsReviewed: clientSiteOrgIds.size,
      siteOrganizationsMissingRosterSources: missingRosterSourceForSiteOrgs.length,
    },
    deputyFiles,
    otherRosterFiles: rosterFiles,
    organizationCoverage: Array.from(orgCoverage.values()).sort((a, b) => {
      const aTotal = a.deputyFileCount + a.otherRosterFileCount
      const bTotal = b.deputyFileCount + b.otherRosterFileCount
      return bTotal - aTotal
    }),
    missingRosterSourceOrganizations: missingRosterSourceForSiteOrgs,
    rosterFilesWithoutOrgInference,
  }

  writeArtifact(args.artifactOut, artifact)

  console.log('[Summary]')
  console.log(`  buckets_scanned: ${artifact.summary.bucketsScanned}`)
  console.log(`  files_scanned: ${artifact.summary.filesScanned}`)
  console.log(`  deputy_files_found: ${artifact.summary.deputyFilesFound}`)
  console.log(`  other_roster_files_found: ${artifact.summary.otherRosterFilesFound}`)
  console.log(`  site_orgs_missing_roster_sources: ${artifact.summary.siteOrganizationsMissingRosterSources}`)
}

main().catch((error) => {
  console.error(error?.message || String(error))
  process.exit(1)
})
