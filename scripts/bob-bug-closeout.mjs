#!/usr/bin/env node

import process from 'node:process'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const TERMINAL_STATUSES = new Set(['resolved', 'closed', 'wont_fix', 'duplicate'])

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

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`)
}

function nowIso() {
  return new Date().toISOString()
}

function baseUrl() {
  return String(process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
}

function serviceRole() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
}

function ensureEnv() {
  const base = baseUrl()
  const key = serviceRole()
  if (!base || !key) {
    throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return { base, key }
}

async function supabaseFetch(endpoint, init = {}) {
  const { base, key } = ensureEnv()
  const response = await fetch(`${base}/rest/v1${endpoint}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...init.headers,
    },
  })

  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  return { ok: response.ok, status: response.status, data }
}

async function patchOpenAgenticReports(status, stage, note) {
  const statusSafe = encodeURIComponent(status)
  const appVersionLike = encodeURIComponent('ops-bob-agentic%')
  const endpoint = `/bug_reports?auto_reported=eq.true&app_version=like.${appVersionLike}&status=not.in.(resolved,closed,wont_fix,duplicate)`
  const body = {
    status,
    ai_analyzed: true,
    ai_analysis: {
      source: 'bob-autonomous-closeout',
      stage,
      note,
      updated_at: nowIso(),
      status: statusSafe,
    },
  }

  const res = await supabaseFetch(endpoint, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(`Failed stage update (${res.status}): ${JSON.stringify(res.data)}`)
  }

  const count = Array.isArray(res.data) ? res.data.length : 0
  return count
}

async function resolveOpenAgenticReports(note) {
  const appVersionLike = encodeURIComponent('ops-bob-agentic%')
  const endpoint = `/bug_reports?auto_reported=eq.true&app_version=like.${appVersionLike}&status=not.in.(resolved,closed,wont_fix,duplicate)`
  const res = await supabaseFetch(endpoint, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      status: 'resolved',
      requires_human_review: false,
      resolution_notes: note,
      resolved_at: nowIso(),
      ai_analyzed: true,
      ai_analysis: {
        source: 'bob-autonomous-closeout',
        stage: 'closeout',
        note,
        updated_at: nowIso(),
      },
    }),
  })

  if (!res.ok) {
    throw new Error(`Failed resolve closeout (${res.status}): ${JSON.stringify(res.data)}`)
  }

  return Array.isArray(res.data) ? res.data.length : 0
}

function parseDate(value) {
  const t = Date.parse(String(value || ''))
  return Number.isFinite(t) ? t : 0
}

async function deleteResolvedOlderThan(hours) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000
  const appVersionLike = encodeURIComponent('ops-bob-agentic%')
  const endpoint = `/bug_reports?select=id,status,created_at,updated_at,resolved_at&auto_reported=eq.true&app_version=like.${appVersionLike}&status=in.(resolved,closed,wont_fix,duplicate)&order=resolved_at.asc.nullslast&limit=500`
  const listed = await supabaseFetch(endpoint)

  if (!listed.ok || !Array.isArray(listed.data)) {
    throw new Error(`Failed list for retention cleanup (${listed.status}): ${JSON.stringify(listed.data)}`)
  }

  const toDelete = listed.data
    .filter((row) => TERMINAL_STATUSES.has(String(row?.status || '').trim()))
    .filter((row) => {
      const marker = parseDate(row?.resolved_at) || parseDate(row?.updated_at) || parseDate(row?.created_at)
      return marker > 0 && marker <= cutoff
    })
    .map((row) => String(row.id || '').trim())
    .filter(Boolean)

  let deleted = 0
  for (const id of toDelete) {
    const del = await supabaseFetch(`/bug_reports?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        Prefer: 'return=minimal',
      },
    })
    if (!del.ok) {
      throw new Error(`Failed delete for ${id} (${del.status}): ${JSON.stringify(del.data)}`)
    }
    deleted += 1
  }

  return deleted
}

async function main() {
  const mode = String(arg('mode', 'stage')).trim().toLowerCase()
  const dryRun = hasFlag('dry-run')

  if (mode === 'stage') {
    const stage = String(arg('stage', 'unknown')).trim()
    const status = String(arg('status', 'in_progress')).trim()
    const note = String(arg('note', `Stage ${stage} completed`)).trim()

    if (dryRun) {
      console.log(`[bob-bug-closeout] dry-run stage=${stage} status=${status}`)
      return
    }

    const updated = await patchOpenAgenticReports(status, stage, note)
    console.log(`[bob-bug-closeout] stage_update stage=${stage} status=${status} updated=${updated}`)
    return
  }

  if (mode === 'closeout') {
    const note = String(arg('note', 'Resolved by autonomous remediation cycle')).trim()
    if (dryRun) {
      console.log('[bob-bug-closeout] dry-run closeout')
      return
    }

    const resolved = await resolveOpenAgenticReports(note)
    console.log(`[bob-bug-closeout] closeout resolved=${resolved}`)
    return
  }

  if (mode === 'retention') {
    const hoursRaw = Number.parseFloat(arg('hours', '24'))
    const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : 24

    if (dryRun) {
      console.log(`[bob-bug-closeout] dry-run retention hours=${hours}`)
      return
    }

    const deleted = await deleteResolvedOlderThan(hours)
    console.log(`[bob-bug-closeout] retention hours=${hours} deleted=${deleted}`)
    return
  }

  throw new Error(`Unsupported mode: ${mode}`)
}

main().catch((error) => {
  console.error('[bob-bug-closeout] fatal:', error?.message || error)
  process.exit(1)
})
