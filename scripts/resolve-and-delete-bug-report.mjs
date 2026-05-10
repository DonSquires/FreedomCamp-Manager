#!/usr/bin/env node

import process from 'node:process'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

function arg(name, fallback = '') {
  const key = `--${name}`
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '')
    if (token === key) return String(argv[i + 1] || fallback)
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1) || fallback
  }
  return fallback
}

async function main() {
  const id = arg('id', '').trim()
  const resolutionNotes = arg('resolution', 'Resolved and removed by automation').trim()

  if (!id) {
    console.error('Usage: node scripts/resolve-and-delete-bug-report.mjs --id <bug_report_id> [--resolution "notes"]')
    process.exit(1)
  }

  const base = String(process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

  if (!base || !key) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const patch = await fetch(`${base}/rest/v1/bug_reports?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      status: 'resolved',
      resolution_notes: resolutionNotes,
      requires_human_review: false,
    }),
  })

  const patchText = await patch.text()
  if (!(patch.status >= 200 && patch.status < 300)) {
    console.error(`[resolve-and-delete] PATCH failed (${patch.status}): ${patchText}`)
    process.exit(1)
  }

  const del = await fetch(`${base}/rest/v1/bug_reports?id=eq.${id}`, {
    method: 'DELETE',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=representation',
    },
  })

  const delText = await del.text()
  if (!(del.status >= 200 && del.status < 300)) {
    console.error(`[resolve-and-delete] DELETE failed (${del.status}): ${delText}`)
    process.exit(1)
  }

  console.log(`[resolve-and-delete] completed id=${id}`)
}

main().catch((error) => {
  console.error('[resolve-and-delete] fatal:', error?.message || error)
  process.exit(1)
})
