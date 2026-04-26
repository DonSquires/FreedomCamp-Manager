#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const targets = [path.join(root, 'src/hooks'), path.join(root, 'src/lib')]

const requiresOrgScope = new Set([
  'observations',
  'breach_alerts',
  'patrols',
  'patrol_checkpoints',
  'zones',
  'enforcement_actions',
  'import_batches',
  'audit_log',
  'plate_scans',
  'incidents',
  'dispatch_jobs',
  'chat_messages',
])

const allowGlobal = new Set([
  'organizations',
  'user_profiles',
  'notifications',
  'canonical_vehicles',
])

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

function hasOrgFilter(snippet) {
  const hasScopedInsert =
    (snippet.includes('.insert({') || snippet.includes('.insert([')) &&
    (
      snippet.includes('organization_id:') ||
      snippet.includes('organization_id :') ||
      snippet.includes('org_id:') ||
      snippet.includes('org_id :')
    )

  return (
    snippet.includes(".eq('organization_id'") ||
    snippet.includes('.eq("organization_id"') ||
    snippet.includes(".eq('org_id'") ||
    snippet.includes('.eq("org_id"') ||
    hasScopedInsert
  )
}

function isStorageFrom(lines, lineIndex) {
  const start = Math.max(0, lineIndex - 2)
  const context = lines.slice(start, lineIndex + 1).join('\n')
  return context.includes('.storage') || context.includes('storage.from(')
}

function isLegacyAuditLogFallback(file, table, source, lineIndex) {
  const extendedSnippet = source.split(/\r?\n/).slice(lineIndex, lineIndex + 40).join('\n')

  return (
    file === 'src/hooks/useAuditLogs.ts' &&
    table === 'audit_log' &&
    (extendedSnippet.includes('fallbackQuery') || extendedSnippet.includes('legacyFallbackQuery')) &&
    extendedSnippet.includes('user_profile?.organization_id')
  )
}

function isKnownException(file, table, source, lineIndex) {
  return isLegacyAuditLogFallback(file, table, source, lineIndex)
}

function isUserScopedReceipt(table, snippet) {
  return (
    table === 'chat_read_receipts' &&
    snippet.includes('user_id:') &&
    snippet.includes('thread_id:')
  )
}

function isParentScopedAssociation(table, source, lineIndex) {
  const lines = source.split(/\r?\n/)
  const context = lines.slice(Math.max(0, lineIndex - 12), lineIndex + 25).join('\n')

  return (
    table === 'patrol_schedule_zones' &&
    context.includes('patrol_id:') &&
    (context.includes('patrol.id') || context.includes('params.zone_ids'))
  )
}

const findings = []
for (const base of targets) {
  const files = walk(base)
  for (const file of files) {
    const rel = path.relative(root, file)
    const source = readFileSync(file, 'utf8')
    const lines = source.split(/\r?\n/)

    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].match(/\.from\('([^']+)'\)|\.from\("([^"]+)"\)/)
      if (!m) continue
      if (isStorageFrom(lines, i)) continue
      const table = m[1] || m[2]
      const window = lines.slice(i, i + 22).join('\n')

      const orgRequired = requiresOrgScope.has(table)
      const scoped = hasOrgFilter(window)
      const globallyAllowed = allowGlobal.has(table)
      const knownException = isKnownException(rel, table, source, i)
      const userScopedReceipt = isUserScopedReceipt(table, window)
      const parentScopedAssociation = isParentScopedAssociation(table, source, i)

      const status = scoped
        ? 'ok'
        : (knownException
          ? 'known_exception'
          : (orgRequired
            ? 'missing_org_filter'
            : ((globallyAllowed || userScopedReceipt || parentScopedAssociation)
              ? 'allowed_global_or_user_scoped'
              : 'review')))

      findings.push({
        file: rel,
        line: i + 1,
        table,
        status,
        orgRequired,
        scoped,
      })
    }
  }
}

const summary = findings.reduce((acc, item) => {
  acc.total += 1
  acc[item.status] = (acc[item.status] || 0) + 1
  return acc
}, { total: 0 })

const missing = findings.filter((f) => f.status === 'missing_org_filter')
const review = findings.filter((f) => f.status === 'review')
const knownExceptions = findings.filter((f) => f.status === 'known_exception')

const report = {
  generatedAt: new Date().toISOString(),
  scope: ['src/hooks', 'src/lib'],
  policy: {
    requiresOrgScope: [...requiresOrgScope],
    allowGlobal: [...allowGlobal],
  },
  summary,
  missingOrgFilter: missing,
  reviewNeeded: review,
  knownExceptions,
  findings,
}

const jsonPath = path.join(root, 'data/org-scoping-audit-2026-04-25.json')
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

const md = []
md.push('# Org Scoping Audit (2026-04-25)')
md.push('')
md.push(`Generated: ${report.generatedAt}`)
md.push('')
md.push(`Total query sites: ${summary.total}`)
md.push(`Missing required org filter: ${summary.missing_org_filter || 0}`)
md.push(`Review needed: ${summary.review || 0}`)
md.push(`Known exceptions: ${summary.known_exception || 0}`)
md.push('')

if (missing.length > 0) {
  md.push('## Missing Required Org Filters')
  md.push('')
  for (const row of missing) {
    md.push(`- ${row.file}:${row.line} table=${row.table}`)
  }
  md.push('')
}

if (review.length > 0) {
  md.push('## Review Needed')
  md.push('')
  for (const row of review.slice(0, 30)) {
    md.push(`- ${row.file}:${row.line} table=${row.table}`)
  }
  md.push('')
}

if (knownExceptions.length > 0) {
  md.push('## Known Exceptions')
  md.push('')
  for (const row of knownExceptions.slice(0, 30)) {
    md.push(`- ${row.file}:${row.line} table=${row.table}`)
  }
  md.push('')
}

md.push('## Notes')
md.push('')
md.push('- This is a static text audit; final authority remains Supabase RLS policies.')
md.push('- Tables marked global/user-scoped are allowed to omit organization filters in client code.')

const mdPath = path.join(root, 'docs/ORG_ID_SCOPING_AUDIT_2026-04-25.md')
writeFileSync(mdPath, `${md.join('\n')}\n`, 'utf8')

console.log(`Wrote ${jsonPath}`)
console.log(`Wrote ${mdPath}`)
console.log(`Missing required org filters: ${missing.length}`)
