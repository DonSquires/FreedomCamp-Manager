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
  const supabaseUrl = String(process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
  const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const limit = Number.parseInt(arg('limit', '20'), 10)
  const asJson = process.argv.includes('--json')

  if (!supabaseUrl || !serviceRole) {
    console.error('[monitor-bug-reports] Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const url = `${supabaseUrl}/rest/v1/bug_reports?select=id,title,severity,status,created_at,issue_type,current_page,app_version&status=not.in.(resolved,closed,wont_fix,duplicate)&order=created_at.desc&limit=${Number.isFinite(limit) ? limit : 20}`

  const response = await fetch(url, {
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
    },
  })

  const text = await response.text()
  let data = []
  try {
    data = text ? JSON.parse(text) : []
  } catch {
    console.error('[monitor-bug-reports] Failed to parse response:', text)
    process.exit(1)
  }

  if (!response.ok) {
    console.error(`[monitor-bug-reports] Query failed (${response.status})`, JSON.stringify(data))
    process.exit(1)
  }

  if (asJson) {
    console.log(JSON.stringify(data, null, 2))
    return
  }

  console.log(`[monitor-bug-reports] Open reports: ${Array.isArray(data) ? data.length : 0}`)
  for (const row of Array.isArray(data) ? data : []) {
    console.log(`- [${row.severity || 'unknown'}][${row.status || 'unknown'}] #${row.id || '?'} ${row.title || ''}`)
    console.log(`  created=${row.created_at || 'n/a'} issue_type=${row.issue_type || 'n/a'} page=${row.current_page || 'n/a'} app=${row.app_version || 'n/a'}`)
  }
}

main().catch((error) => {
  console.error('[monitor-bug-reports] fatal:', error?.message || error)
  process.exit(1)
})
