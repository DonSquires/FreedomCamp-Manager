#!/usr/bin/env node

import process from 'node:process'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const TERMINAL_STATUSES = ['resolved', 'closed', 'wont_fix', 'duplicate']

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

function boolArg(name, fallback = false) {
  const raw = String(arg(name, String(fallback))).trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeRunpodRunsyncUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (/^rpa_[a-z0-9]+$/i.test(trimmed)) return ''
  if (!/^https?:\/\//i.test(trimmed) && !/[./:]/.test(trimmed)) return ''

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  if (/\/runsync$/i.test(withScheme)) return withScheme
  if (/\/run-sync$/i.test(withScheme)) return withScheme.replace(/\/run-sync$/i, '/runsync')
  if (/\/run$/i.test(withScheme)) return withScheme.replace(/\/run$/i, '/runsync')
  if (/api\.runpod\.ai\/v2\//i.test(withScheme)) return `${withScheme}/runsync`
  if (/\/v2\/[^/]+$/i.test(withScheme)) return `${withScheme}/runsync`

  return `${withScheme}/runsync`
}

function resolveDrBobUrl() {
  const endpointId = String(process.env.RUNPOD_ENDPOINT_ID || '').trim()
  const candidates = [
    process.env.DR_BOB_RUNPOD_URL,
    process.env.BOB_SERVICE_URL,
    process.env.INFERENCE_SERVICE_URL,
    process.env.RUNPOD_RUNSYNC_URL,
    process.env.RUNPOD_SERVERLESS_URL,
    process.env.RUNPOD_GATEWAY_URL,
    process.env.RUNPOD_ENDPOINT_URL,
    process.env.RUNPOD_API_URL,
    endpointId ? `https://api.runpod.ai/v2/${endpointId}` : '',
  ]

  for (const candidate of candidates) {
    const normalized = normalizeRunpodRunsyncUrl(candidate)
    if (normalized) return normalized
  }

  return ''
}

function resolveDrBobApiKey() {
  const candidates = [
    process.env.RUNPOD_API_KEY,
    process.env.RUNPOD_ENDPOINT_API_KEY,
    process.env.BOB_INFERENCE_API_KEY,
    process.env.INFERENCE_API_KEY,
    process.env.DR_BOB_API,
  ]

  for (const candidate of candidates) {
    const value = String(candidate || '').trim()
    if (value) return value
  }

  return ''
}

function resolveModelForLane(lane) {
  if (lane === 'coding') {
    return String(process.env.DR_BOB_SPECIALIST_MODEL_CODING || process.env.DR_BOB_MODEL || '').trim()
  }
  if (lane === 'runtime_infra') {
    return String(process.env.DR_BOB_SPECIALIST_MODEL_INFRA || process.env.DR_BOB_MODEL || '').trim()
  }
  return String(process.env.DR_BOB_MODEL || '').trim()
}

function supabaseBase() {
  return String(process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
}

function supabaseKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
}

async function supabaseFetch(endpoint, init = {}) {
  const base = supabaseBase()
  const key = supabaseKey()
  if (!base || !key) throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

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

async function fetchOpenBugReports(limit) {
  const endpoint = `/bug_reports?select=id,title,description,status,severity,issue_type,requires_human_review,app_version,current_page,created_at&status=not.in.(${TERMINAL_STATUSES.join(',')})&order=created_at.desc&limit=${limit}`
  const res = await supabaseFetch(endpoint)
  if (!res.ok || !Array.isArray(res.data)) {
    throw new Error(`Failed to query bug reports (${res.status}): ${JSON.stringify(res.data)}`)
  }
  return res.data
}

function classifyBug(report) {
  const title = String(report?.title || '').toLowerCase()
  const appVersion = String(report?.app_version || '').toLowerCase()
  const description = String(report?.description || '').toLowerCase()
  const issueType = String(report?.issue_type || '').toLowerCase()
  const currentPage = String(report?.current_page || '').toLowerCase()
  const haystack = [title, description, issueType, currentPage, appVersion].join(' ')

  const launchFailure =
    haystack.includes('failed_launch') ||
    haystack.includes('failed launch') ||
    haystack.includes('failed to load') ||
    haystack.includes('err_connection_refused') ||
    haystack.includes('econnrefused') ||
    haystack.includes('net::err_')

  const endpointOrApiUrlIssue =
    haystack.includes('runpod') ||
    haystack.includes('runsync') ||
    haystack.includes('run-sync') ||
    haystack.includes('endpoint url') ||
    haystack.includes('api vs url') ||
    haystack.includes('invalid url') ||
    haystack.includes('missing scheme') ||
    haystack.includes('enotfound') ||
    haystack.includes('dns')

  const envConfigIssue =
    haystack.includes('env') ||
    haystack.includes('environment') ||
    haystack.includes('missing key') ||
    haystack.includes('service role key') ||
    haystack.includes('supabase_service_role_key') ||
    haystack.includes('vite_supabase_url') ||
    haystack.includes('undefined') ||
    haystack.includes('null config')

  const wiringDirectionIssue =
    haystack.includes('wrong wiring') ||
    haystack.includes('wrong direction') ||
    haystack.includes('miswired') ||
    haystack.includes('route mismatch') ||
    haystack.includes('endpoint mismatch')

  const vercelLane = appVersion.includes('ops-vercel-emulator')
  const runtimeInfra =
    launchFailure ||
    vercelLane ||
    endpointOrApiUrlIssue ||
    envConfigIssue ||
    wiringDirectionIssue

  const codingLikely =
    !runtimeInfra &&
    (title.includes('[bob agentic]') ||
      title.includes('test failure') ||
      appVersion.includes('ops-bob-agentic'))

  const lane = runtimeInfra ? 'runtime_infra' : codingLikely ? 'coding' : 'operations'

  let nonCodingType = 'general_non_coding'
  if (endpointOrApiUrlIssue) nonCodingType = 'endpoint_or_api_url_misconfig'
  else if (envConfigIssue) nonCodingType = 'environment_configuration'
  else if (launchFailure) nonCodingType = 'failure_to_load_or_launch'
  else if (wiringDirectionIssue) nonCodingType = 'wiring_or_route_direction'
  else if (lane === 'operations') nonCodingType = 'operations_process'

  return {
    lane,
    launchFailure,
    runtimeInfra,
    codingLikely,
    endpointOrApiUrlIssue,
    envConfigIssue,
    wiringDirectionIssue,
    nonCodingType,
  }
}

function extractResponseText(payload) {
  if (!payload || typeof payload !== 'object') return ''
  const candidates = [
    payload.output?.message,
    payload.output?.response,
    payload.message,
    payload.response,
    payload.output,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate
    if (candidate && typeof candidate === 'object') return JSON.stringify(candidate)
  }
  return ''
}

function parseDrBobJson(text) {
  const raw = String(text || '').trim()
  const match = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const normalized = match ? match[1].trim() : raw

  const candidates = [normalized]
  const firstBrace = normalized.indexOf('{')
  const lastBrace = normalized.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(normalized.slice(firstBrace, lastBrace + 1))
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // Keep fallback parsing.
    }
  }

  return null
}

async function askDrBob(report, classification) {
  const url = resolveDrBobUrl()
  const apiKey = resolveDrBobApiKey()
  const model = resolveModelForLane(classification.lane)

  if (!url || !apiKey) {
    return { ok: false, reason: 'missing-drbob-endpoint-or-key' }
  }

  const prompt = [
    'You are Dr Bob triage specialist.',
    'Task: triage one bug report and return strict JSON only.',
    'Allowed decisions: resolve, keep_open, needs_human.',
    'Allowed statuses: acknowledged, investigating, in_progress, resolved.',
    'Non-coding triage matrix:',
    '- endpoint/API-URL confusion (including API key used as URL, malformed runsync URL) => lane=runtime_infra, keep_open, status=investigating',
    '- environment config missing/wrong (.env, keys, service role, URL) => lane=runtime_infra, keep_open, status=investigating',
    '- failed to load / launch / connection refused => lane=runtime_infra, keep_open, status=investigating',
    '- wrong wiring direction / route mismatch / endpoint mismatch => lane=runtime_infra, keep_open, status=investigating',
    '- other non-coding operational incidents => lane=operations, keep_open, status=investigating',
    'If bug is coding/test-regression, classify lane=coding.',
    'Do NOT auto-close non-coding issues. They must remain triaged/open until verified remediation evidence is attached.',
    'When triaging non-coding issues, always include exact nextAction and evidenceRequired fields.',
    'JSON schema:',
    '{"decision":"resolve|keep_open|needs_human","lane":"coding|runtime_infra|operations","status":"acknowledged|investigating|in_progress|resolved","requiresHumanReview":true|false,"fixEvidence":true|false,"nonCodingType":"endpoint_or_api_url_misconfig|environment_configuration|failure_to_load_or_launch|wiring_or_route_direction|operations_process|n/a","nextAction":"...","evidenceRequired":"...","resolutionNotes":"...","trainingNote":"..."}',
    'Bug report payload:',
    JSON.stringify(report),
    'Classification hint:',
    JSON.stringify(classification),
  ].join('\n')

  const body = {
    input: {
      action: 'chat',
      stream: false,
      message: prompt,
      messages: [{ role: 'user', content: prompt }],
      ...(model ? { model } : {}),
    },
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'x-inference-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = { response: text }
  }

  if (!response.ok) {
    return { ok: false, reason: `drbob-http-${response.status}`, raw: String(text || '') }
  }

  const rawResponse = extractResponseText(payload)
  const parsed = parseDrBobJson(rawResponse)
  if (!parsed) {
    return { ok: false, reason: 'drbob-non-json', raw: rawResponse }
  }

  return { ok: true, parsed, raw: rawResponse }
}

function heuristicDecision(classification, autoResolveNonCoding) {
  if (classification.runtimeInfra) {
    return {
      decision: autoResolveNonCoding ? 'resolve' : 'keep_open',
      lane: 'runtime_infra',
      status: autoResolveNonCoding ? 'resolved' : 'investigating',
      requiresHumanReview: false,
      fixEvidence: false,
      nonCodingType: classification.nonCodingType,
      nextAction:
        'Validate endpoint and environment wiring, then rerun in clean environment before considering resolution.',
      evidenceRequired:
        'Attach successful rerun output, endpoint reachability check, and corrected env/wiring diff.',
      resolutionNotes: autoResolveNonCoding
        ? 'Auto-triaged runtime launch failure. Routed to environment lane and resolved by automation policy.'
        : 'Runtime launch failure triaged and kept open for investigation. No auto-close applied.',
      trainingNote: 'Treat FAILED_LAUNCH and connection-refused signatures as runtime/infrastructure first and keep open unless explicitly verified fixed.',
    }
  }

  if (classification.codingLikely) {
    return {
      decision: 'keep_open',
      lane: 'coding',
      status: 'in_progress',
      requiresHumanReview: false,
      fixEvidence: false,
      nonCodingType: 'n/a',
      nextAction: 'Implement and validate code remediation in coding lane.',
      evidenceRequired: 'Attach passing tests/build evidence for the affected flow.',
      resolutionNotes: 'Coding-lane bug rerun through Dr Bob; kept open for remediation.',
      trainingNote: 'Coding test failures stay open until remediation evidence is attached.',
    }
  }

  return {
    decision: 'keep_open',
    lane: 'operations',
    status: 'investigating',
    requiresHumanReview: false,
    fixEvidence: false,
    nonCodingType: classification.nonCodingType,
    nextAction: 'Triage operational cause and collect reproducible evidence before escalation.',
    evidenceRequired: 'Attach logs, exact repro steps, and verification checkpoints.',
    resolutionNotes: 'Operations-lane bug rerun through Dr Bob triage; retained for investigation.',
    trainingNote: 'Prefer lane-specific triage before human escalation.',
  }
}

function normalizeDecision(candidate, fallback) {
  const value = candidate && typeof candidate === 'object' ? candidate : {}
  return {
    decision: ['resolve', 'keep_open', 'needs_human'].includes(String(value.decision || '').trim())
      ? String(value.decision).trim()
      : fallback.decision,
    lane: ['coding', 'runtime_infra', 'operations'].includes(String(value.lane || '').trim())
      ? String(value.lane).trim()
      : fallback.lane,
    status: ['acknowledged', 'investigating', 'in_progress', 'resolved'].includes(String(value.status || '').trim())
      ? String(value.status).trim()
      : fallback.status,
    requiresHumanReview:
      typeof value.requiresHumanReview === 'boolean' ? value.requiresHumanReview : fallback.requiresHumanReview,
    fixEvidence: typeof value.fixEvidence === 'boolean' ? value.fixEvidence : fallback.fixEvidence,
    nonCodingType: String(value.nonCodingType || '').trim() || fallback.nonCodingType,
    nextAction: String(value.nextAction || '').trim() || fallback.nextAction,
    evidenceRequired: String(value.evidenceRequired || '').trim() || fallback.evidenceRequired,
    resolutionNotes: String(value.resolutionNotes || '').trim() || fallback.resolutionNotes,
    trainingNote: String(value.trainingNote || '').trim() || fallback.trainingNote,
  }
}

function enforceTriagePolicy(decision, classification) {
  const normalized = { ...decision }

  // All non-coding issues must be triaged and kept open until explicit fix evidence exists.
  if (normalized.lane !== 'coding') {
    if (normalized.decision !== 'needs_human') normalized.decision = 'keep_open'
    if (normalized.status === 'resolved') normalized.status = 'investigating'
    normalized.requiresHumanReview = false
    normalized.fixEvidence = false
    normalized.nextAction =
      normalized.nextAction ||
      'Triage non-coding incident, validate endpoint/env/wiring, and rerun with proof before closure.'
    normalized.evidenceRequired =
      normalized.evidenceRequired ||
      'Successful rerun output plus corrected endpoint/env/wiring evidence.'
    normalized.resolutionNotes =
      normalized.resolutionNotes ||
      'Non-coding incident triaged by Dr Bob and kept open pending verified rerun success evidence.'
  }

  return normalized
}

async function updateBugReport(report, decision, source) {
  const patch = {
    status: decision.status,
    requires_human_review: decision.requiresHumanReview,
    ai_analyzed: true,
    ai_analysis: {
      source,
      triaged_at: nowIso(),
      decision: decision.decision,
      lane: decision.lane,
      non_coding_type: decision.nonCodingType,
      next_action: decision.nextAction,
      evidence_required: decision.evidenceRequired,
      fix_evidence: decision.fixEvidence,
      training_note: decision.trainingNote,
    },
  }

  if (decision.decision === 'resolve' || decision.status === 'resolved') {
    patch.status = 'resolved'
    patch.resolved_at = nowIso()
    patch.resolution_notes = decision.resolutionNotes
  } else {
    patch.resolution_notes = decision.resolutionNotes
  }

  const endpoint = `/bug_reports?id=eq.${encodeURIComponent(String(report.id || ''))}`
  const res = await supabaseFetch(endpoint, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  })

  if (!res.ok) {
    throw new Error(`Failed update for ${report.id} (${res.status}): ${JSON.stringify(res.data)}`)
  }
}

async function main() {
  const limitRaw = Number.parseInt(arg('limit', '500'), 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 500
  const dryRun = boolArg('dry-run', false)
  const autoResolveNonCoding = boolArg('auto-resolve-non-coding', false)

  const reports = await fetchOpenBugReports(limit)
  const summary = {
    scanned: reports.length,
    resolved: 0,
    keptOpen: 0,
    markedNeedsHuman: 0,
    runtimeInfra: 0,
    coding: 0,
    operations: 0,
    drBobSuccess: 0,
    drBobFallback: 0,
    errors: 0,
  }

  for (const report of reports) {
    try {
      const classification = classifyBug(report)
      summary[classification.lane === 'runtime_infra' ? 'runtimeInfra' : classification.lane] += 1

      const fallback = heuristicDecision(classification, autoResolveNonCoding)
      const dr = await askDrBob(report, classification)
      const decision = enforceTriagePolicy(
        normalizeDecision(dr.ok ? dr.parsed : null, fallback),
        classification
      )

      if (dr.ok) summary.drBobSuccess += 1
      else summary.drBobFallback += 1

      if (decision.decision === 'resolve') summary.resolved += 1
      else if (decision.decision === 'needs_human') summary.markedNeedsHuman += 1
      else summary.keptOpen += 1

      if (dryRun) {
        console.log(`[dr-bob-rerun][dry-run] id=${report.id} lane=${decision.lane} decision=${decision.decision} status=${decision.status}`)
        continue
      }

      await updateBugReport(report, decision, dr.ok ? 'dr-bob-rerun' : 'dr-bob-rerun-fallback')
      console.log(`[dr-bob-rerun] id=${report.id} lane=${decision.lane} decision=${decision.decision} status=${decision.status}`)
    } catch (error) {
      summary.errors += 1
      console.error(`[dr-bob-rerun] failed id=${report?.id || 'unknown'}: ${error?.message || error}`)
    }
  }

  console.log(`[dr-bob-rerun] summary ${JSON.stringify(summary)}`)
}

main().catch((error) => {
  console.error('[dr-bob-rerun] fatal:', error?.message || error)
  process.exit(1)
})
