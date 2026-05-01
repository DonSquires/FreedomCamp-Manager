#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')
const outPath = path.join(root, 'data', 'live-session-diagnostics-summary.json')

function getArg(name, fallback = '') {
  const key = `--${name}`
  const argv = process.argv.slice(2)

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '')
    if (token === key) return argv[i + 1] || fallback
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1)
  }

  return fallback
}

function asFiniteNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function parseEventTimestampMs(value) {
  const ms = Date.parse(String(value || ''))
  return Number.isFinite(ms) ? ms : null
}

function flattenConsoleErrors(events) {
  const out = []
  for (const event of events) {
    const details = event && typeof event.details === 'object' ? event.details : {}
    const snapshot = details && typeof details.snapshot === 'object' ? details.snapshot : null

    const directConsoleErrors = Array.isArray(snapshot?.console_errors)
      ? snapshot.console_errors
      : Array.isArray(details?.console_errors)
        ? details.console_errors
        : []

    for (const err of directConsoleErrors) {
      if (!err || typeof err !== 'object') continue
      out.push({
        level: String(err.level || '').toLowerCase(),
        message: String(err.message || ''),
      })
    }
  }
  return out
}

async function writeSummary(summary) {
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
}

async function fetchJson(url, headers) {
  const resp = await fetch(url, { headers })
  const text = await resp.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { ok: resp.ok, status: resp.status, text, json }
}

async function main() {
  const windowMinutes = asFiniteNumber(getArg('window-minutes', process.env.LIVE_DIAG_WINDOW_MINUTES || '20'), 20)
  const limit = Math.max(20, asFiniteNumber(getArg('limit', process.env.LIVE_DIAG_LIMIT || '180'), 180))
  const maxUnhandled = Math.max(1, asFiniteNumber(getArg('max-unhandled', process.env.LIVE_DIAG_MAX_UNHANDLED || '2'), 2))
  const maxErrors = Math.max(1, asFiniteNumber(getArg('max-errors', process.env.LIVE_DIAG_MAX_ERRORS || '8'), 8))

  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '')
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const orgId = String(process.env.BOB_ORG_ID || process.env.ORG_ID || process.env.DEFAULT_ORG_ID || '').trim()

  const summary = {
    checked_at: new Date().toISOString(),
    window_minutes: windowMinutes,
    status: 'unavailable',
    source: 'live-session-diagnostics-summary',
    reason: '',
    recent_events: 0,
    route_changes: 0,
    offline_events: 0,
    console_error_count: 0,
    unhandled_count: 0,
    latest_route: null,
    top_event_types: [],
  }

  if (!supabaseUrl || !serviceRoleKey || !orgId) {
    summary.reason = 'Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or org context (BOB_ORG_ID/ORG_ID/DEFAULT_ORG_ID).'
    await writeSummary(summary)
    console.log(`[live-session-self-heal] ${summary.status}: ${summary.reason}`)
    return
  }

  const headers = {
    Authorization: `Bearer ${serviceRoleKey}`,
    apikey: serviceRoleKey,
  }

  const diagTableUrl = `${supabaseUrl}/rest/v1/live_session_diagnostic_events` +
    `?select=id,session_id,event_type,route_path,title,details,created_at,user_id` +
    `&org_id=eq.${orgId}` +
    `&order=created_at.desc` +
    `&limit=${limit}`

  const diagResponse = await fetchJson(diagTableUrl, headers)

  let events = []
  let latestRoute = null

  if (diagResponse.ok && Array.isArray(diagResponse.json)) {
    events = diagResponse.json
    latestRoute = events[0]?.route_path || null
  } else {
    const diagErrorText = String(diagResponse.text || '').toLowerCase()
    const relationMissing =
      (diagErrorText.includes('live_session_diagnostic_events') && diagErrorText.includes('does not exist'))
      || diagErrorText.includes('could not find the table')
      || diagErrorText.includes('schema cache')
      || diagErrorText.includes('pgrst205')

    if (!relationMissing) {
      summary.reason = `Diagnostics query failed (${diagResponse.status}): ${String(diagResponse.text || '').slice(0, 200)}`
      await writeSummary(summary)
      console.log(`[live-session-self-heal] ${summary.status}: ${summary.reason}`)
      return
    }

    const bugReportsUrl = `${supabaseUrl}/rest/v1/bug_reports` +
      `?select=id,title,current_page,description,console_errors,screenshot_metadata,updated_at,created_at,user_id` +
      `&organization_id=eq.${orgId}` +
      `&title=ilike.${encodeURIComponent('Live session diagnostics%')}` +
      `&order=updated_at.desc` +
      `&limit=${Math.max(30, Math.floor(limit / 2))}`

    const fallbackResponse = await fetchJson(bugReportsUrl, headers)
    if (!fallbackResponse.ok || !Array.isArray(fallbackResponse.json)) {
      summary.reason = `Fallback diagnostics query failed (${fallbackResponse.status}): ${String(fallbackResponse.text || '').slice(0, 200)}`
      await writeSummary(summary)
      console.log(`[live-session-self-heal] ${summary.status}: ${summary.reason}`)
      return
    }

    events = fallbackResponse.json.flatMap((row) => {
      const sessionId = row?.screenshot_metadata?.live_session_diagnostics?.session_id || null
      const rowTs = row.updated_at || row.created_at
      const nestedEvents = Array.isArray(
        row?.screenshot_metadata?.live_session_diagnostics?.recent_events
      ) ? row.screenshot_metadata.live_session_diagnostics.recent_events : []

      // Prefer unpacking the real per-event records stored during ingest
      if (nestedEvents.length > 0) {
        return nestedEvents.map((e) => ({
          id: row.id,
          session_id: sessionId,
          event_type: String(e?.event_type || 'unknown'),
          route_path: e?.route_path || row.current_page || null,
          title: e?.title || null,
          details: e?.details || {},
          created_at: e?.occurred_at || rowTs,
          user_id: row.user_id,
        }))
      }

      // Fallback: represent the whole row as one snapshot event
      return [{
        id: row.id,
        session_id: sessionId,
        event_type: 'fallback_session_snapshot',
        route_path: row.current_page || null,
        title: row.title || null,
        details: {
          description: row.description,
          console_errors: row.console_errors,
          snapshot: row?.screenshot_metadata?.live_session_diagnostics || row.screenshot_metadata,
        },
        created_at: rowTs,
        user_id: row.user_id,
      }]
    })
    latestRoute = events[0]?.route_path || null
  }

  const cutoff = Date.now() - (windowMinutes * 60_000)
  const recent = events.filter((event) => {
    const eventMs = parseEventTimestampMs(event?.created_at)
    return eventMs !== null && eventMs >= cutoff
  })

  const counts = new Map()
  for (const event of recent) {
    const eventType = String(event?.event_type || 'unknown')
    counts.set(eventType, (counts.get(eventType) || 0) + 1)
  }

  const flattenedErrors = flattenConsoleErrors(recent)
  const unhandledCount = flattenedErrors.filter((err) => err.level === 'unhandled').length
  const errorCount = flattenedErrors.filter((err) => err.level === 'error').length

  summary.recent_events = recent.length
  summary.route_changes = Number(counts.get('route_changed') || 0)
  summary.offline_events = Number(counts.get('browser_offline') || 0)
  summary.console_error_count = errorCount
  summary.unhandled_count = unhandledCount
  summary.latest_route = latestRoute
  summary.top_event_types = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }))

  if (recent.length === 0) {
    summary.status = 'stale'
    summary.reason = `No live session diagnostic events detected in last ${windowMinutes}m.`
  } else if (unhandledCount >= maxUnhandled || errorCount >= maxErrors) {
    summary.status = 'warning'
    summary.reason = `Detected elevated live-session error signals (unhandled=${unhandledCount}, errors=${errorCount}).`
  } else {
    summary.status = 'healthy'
    summary.reason = `Recent live-session diagnostics present (${recent.length} events in ${windowMinutes}m).`
  }

  await writeSummary(summary)
  console.log(`[live-session-self-heal] ${summary.status}: ${summary.reason}`)
}

main().catch(async (error) => {
  const summary = {
    checked_at: new Date().toISOString(),
    status: 'unavailable',
    source: 'live-session-diagnostics-summary',
    reason: String(error?.message || error),
  }
  await writeSummary(summary)
  console.log(`[live-session-self-heal] unavailable: ${summary.reason}`)
  process.exit(0)
})
