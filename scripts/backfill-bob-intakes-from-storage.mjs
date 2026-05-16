#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const HELP_TEXT = `
Backfill Bob intake rows from Supabase Storage bucket files.

Usage:
  node scripts/backfill-bob-intakes-from-storage.mjs [options]

Options:
  --bucket <name>             Storage bucket name (default: evidence)
  --prefix <path>             Prefix to scan (repeatable). Default scans entire bucket.
  --organization-id <uuid>    Fallback organization_id when it cannot be inferred from path.
  --offset <n>                Zero-based file offset before applying --limit (default: 0)
  --limit <n>                 Maximum files to process (default: 200)
  --apply                     Perform inserts. Omit for dry-run mode.
  --verbose                   Print per-file decisions.
  --help                      Show this help.

Examples:
  node scripts/backfill-bob-intakes-from-storage.mjs --prefix historical-imports --limit 100
  node scripts/backfill-bob-intakes-from-storage.mjs --organization-id <org-uuid> --offset 100 --limit 100 --apply
  node scripts/backfill-bob-intakes-from-storage.mjs --prefix bob-intake --organization-id <org-uuid> --apply
`

function parseArgs(argv) {
  const args = {
    bucket: 'evidence',
    prefixes: [],
    organizationId: '',
    offset: 0,
    limit: 200,
    apply: false,
    verbose: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--bucket') {
      args.bucket = String(argv[i + 1] || '').trim() || 'evidence'
      i += 1
      continue
    }
    if (token === '--prefix') {
      const value = String(argv[i + 1] || '').trim()
      if (value) args.prefixes.push(value.replace(/^\/+|\/+$/g, ''))
      i += 1
      continue
    }
    if (token === '--organization-id') {
      args.organizationId = String(argv[i + 1] || '').trim()
      i += 1
      continue
    }
    if (token === '--limit') {
      const parsed = Number.parseInt(String(argv[i + 1] || ''), 10)
      args.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : args.limit
      i += 1
      continue
    }
    if (token === '--offset') {
      const parsed = Number.parseInt(String(argv[i + 1] || ''), 10)
      args.offset = Number.isFinite(parsed) && parsed >= 0 ? parsed : args.offset
      i += 1
      continue
    }
    if (token === '--apply') {
      args.apply = true
      continue
    }
    if (token === '--verbose') {
      args.verbose = true
      continue
    }
    if (token === '--help' || token === '-h') {
      args.help = true
      continue
    }
  }

  if (args.prefixes.length === 0) args.prefixes = ['']
  return args
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function toFileKind(name, mimeType) {
  const lower = String(name || '').toLowerCase()
  const extension = lower.includes('.') ? lower.split('.').pop() : ''
  if (['csv', 'xls', 'xlsx'].includes(extension || '')) return 'spreadsheet'
  if (String(mimeType || '').startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'heic'].includes(extension || '')) return 'image'
  if (String(mimeType || '').startsWith('text/') || ['txt', 'json', 'jsonl', 'md'].includes(extension || '')) return 'text'
  if (['pdf', 'doc', 'docx'].includes(extension || '')) return 'document'
  return 'unknown'
}

function inferPurpose(storagePath, fileKind) {
  const lower = String(storagePath || '').toLowerCase()
  if (lower.includes('historical-imports')) return 'historical_records'
  if (lower.includes('vehicle') && lower.includes('interest')) return 'vehicle_of_interest_photo'
  if (lower.includes('person') && lower.includes('interest')) return 'person_of_interest_photo'
  if (lower.includes('identity')) return 'identity_reference'
  if (fileKind === 'image') return 'general_observation'
  return 'general_document'
}

function inferOrganizationIdCandidates(storagePath, fallbackOrgId) {
  const cleaned = String(storagePath || '').replace(/^\/+|\/+$/g, '')
  const parts = cleaned.split('/').filter(Boolean)
  const ordered = []
  const seen = new Set()

  const push = (value) => {
    const v = String(value || '').trim()
    if (!v || !UUID_RE.test(v) || seen.has(v)) return
    seen.add(v)
    ordered.push(v)
  }

  // Preserve legacy behavior first, then evaluate all UUID path segments.
  push(parts[1])
  push(parts[2])
  for (const part of parts) push(part)
  push(fallbackOrgId)

  return ordered
}

async function organizationExists(supabase, organizationId, cache) {
  if (!organizationId) return false
  if (cache.has(organizationId)) return cache.get(organizationId)

  const { data, error } = await supabase
    .from('organizations')
    .select('id')
    .eq('id', organizationId)
    .limit(1)

  if (error) {
    throw new Error(`Failed checking organization ${organizationId}: ${error.message}`)
  }

  const exists = Array.isArray(data) && data.length > 0
  cache.set(organizationId, exists)
  return exists
}

async function resolveOrganizationId(supabase, storagePath, fallbackOrgId, cache) {
  const candidates = inferOrganizationIdCandidates(storagePath, fallbackOrgId)
  for (const candidate of candidates) {
    if (await organizationExists(supabase, candidate, cache)) {
      return candidate
    }
  }

  return ''
}

async function listAllFiles(supabase, bucket, prefix) {
  const files = []
  const queue = [prefix.replace(/^\/+|\/+$/g, '')]

  while (queue.length > 0) {
    const currentPrefix = queue.shift() || ''
    let offset = 0

    while (true) {
      const { data, error } = await supabase.storage.from(bucket).list(currentPrefix, {
        limit: 100,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })

      if (error) {
        throw new Error(`Failed to list bucket "${bucket}" at prefix "${currentPrefix}": ${error.message}`)
      }

      const page = data || []
      for (const item of page) {
        const childPath = [currentPrefix, item.name].filter(Boolean).join('/')
        const isFolder = !item.id && !item.metadata
        if (isFolder) {
          queue.push(childPath)
        } else {
          files.push({
            path: childPath,
            name: item.name,
            mimeType: item.metadata?.mimetype || null,
            size: item.metadata?.size || null,
            createdAt: item.created_at || null,
            updatedAt: item.updated_at || null,
          })
        }
      }

      if (page.length < 100) break
      offset += 100
    }
  }

  return files
}

async function intakeExists(supabase, bucket, storagePath) {
  const { data, error } = await supabase
    .from('ai_import_intakes')
    .select('id')
    .eq('storage_bucket', bucket)
    .eq('storage_path', storagePath)
    .limit(1)

  if (error) {
    throw new Error(`Failed checking existing intake for ${storagePath}: ${error.message}`)
  }

  return Array.isArray(data) && data.length > 0
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
    console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(2)
  }

  if (args.organizationId && !UUID_RE.test(args.organizationId)) {
    console.error('--organization-id must be a UUID.')
    process.exit(2)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const dryRun = !args.apply
  console.log(`[Start] bucket=${args.bucket} prefixes=${args.prefixes.join(', ') || '(root)'} mode=${dryRun ? 'dry-run' : 'apply'} offset=${args.offset} limit=${args.limit}`)

  const allFiles = []
  for (const prefix of args.prefixes) {
    const files = await listAllFiles(supabase, args.bucket, prefix)
    allFiles.push(...files)
  }

  const uniqueByPath = new Map()
  for (const file of allFiles) {
    uniqueByPath.set(file.path, file)
  }
  const candidateFiles = Array.from(uniqueByPath.values()).slice(args.offset, args.offset + args.limit)

  let scanned = 0
  let skippedExisting = 0
  let skippedMissingOrg = 0
  let staged = 0
  let failed = 0
  const orgExistsCache = new Map()

  for (const file of candidateFiles) {
    scanned += 1
    const organizationId = await resolveOrganizationId(supabase, file.path, args.organizationId, orgExistsCache)

    if (!organizationId) {
      skippedMissingOrg += 1
      if (args.verbose) {
        console.log(`[Skip:org] ${file.path}`)
      }
      continue
    }

    const alreadyExists = await intakeExists(supabase, args.bucket, file.path)
    if (alreadyExists) {
      skippedExisting += 1
      if (args.verbose) {
        console.log(`[Skip:existing] ${file.path}`)
      }
      continue
    }

    const fileKind = toFileKind(file.name, file.mimeType)
    const purpose = inferPurpose(file.path, fileKind)
    const { data: publicUrlData } = supabase.storage.from(args.bucket).getPublicUrl(file.path)

    const payload = {
      organization_id: organizationId,
      created_by: null,
      assistant_name: 'Bob',
      purpose,
      file_name: file.name,
      file_kind: fileKind,
      mime_type: file.mimeType,
      storage_bucket: args.bucket,
      storage_path: file.path,
      file_public_url: publicUrlData?.publicUrl || null,
      source_system: 'supabase-storage-backfill',
      date_range: null,
      operator_notes: 'Backfilled from raw Supabase Storage object for Bob queue review.',
      context: {
        backfill: true,
        backfill_version: '2026-05-15',
        object_size: file.size,
        object_created_at: file.createdAt,
        object_updated_at: file.updatedAt,
      },
      extracted_text: null,
      extracted_headers: [],
      assistant_brief: 'Staged from raw storage file. Review in Bob Intake Queue before actioning.',
      recommended_table: 'ai_import_intakes',
      recommendation_score: 50,
      recommendations: [],
      status: 'staged',
      action_target_table: null,
      action_target_id: null,
      action_summary: 'Awaiting Bob/agent review in intake queue.',
    }

    if (dryRun) {
      staged += 1
      if (args.verbose) {
        console.log(`[DryRun:stage] ${file.path} -> org=${organizationId} purpose=${purpose} kind=${fileKind}`)
      }
      continue
    }

    const { error } = await supabase.from('ai_import_intakes').insert(payload)
    if (error) {
      failed += 1
      console.error(`[Error] ${file.path}: ${error.message}`)
      continue
    }

    staged += 1
    if (args.verbose) {
      console.log(`[Staged] ${file.path}`)
    }
  }

  console.log('[Summary]')
  console.log(`  scanned: ${scanned}`)
  console.log(`  staged: ${staged}`)
  console.log(`  skipped_existing: ${skippedExisting}`)
  console.log(`  skipped_missing_org: ${skippedMissingOrg}`)
  console.log(`  failed: ${failed}`)
  console.log(`  mode: ${dryRun ? 'dry-run' : 'apply'}`)
}

main().catch((error) => {
  console.error(error?.message || String(error))
  process.exit(1)
})
