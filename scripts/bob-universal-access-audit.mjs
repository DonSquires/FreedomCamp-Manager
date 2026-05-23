#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function toBool(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function sanitizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

async function pathExists(relativePath) {
  const absolute = path.resolve(process.cwd(), relativePath)
  try {
    await fs.access(absolute)
    return true
  } catch {
    return false
  }
}

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
  })

  return {
    ok: result.status === 0,
    exitCode: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  }
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    const text = await response.text().catch(() => '')
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
      bodyPreview: String(text || '').slice(0, 400),
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      data: null,
      bodyPreview: String(error?.message || error).slice(0, 400),
    }
  } finally {
    clearTimeout(timer)
  }
}

function buildServiceCandidates() {
  const urls = [
    ['bobService', process.env.BOB_SERVICE_URL],
    ['inferenceService', process.env.INFERENCE_SERVICE_URL],
    ['proxyService', process.env.PROXY_SERVER_URL],
    ['pttService', process.env.PTT_SERVER_URL],
    ['runpodGateway', process.env.RUNPOD_GATEWAY_URL],
    ['runpodServerless', process.env.RUNPOD_SERVERLESS_URL],
  ]

  return urls
    .map(([label, value]) => [label, sanitizeBaseUrl(value)])
    .filter(([, value]) => /^https?:\/\//i.test(value))
}

async function probeServices() {
  const candidates = buildServiceCandidates()
  const probes = []

  for (const [label, baseUrl] of candidates) {
    const endpointCandidates =
      /api\.runpod\.ai\/v2\//i.test(baseUrl)
        ? [`${baseUrl}/runsync/health`, `${baseUrl}/health`]
        : [`${baseUrl}/health`, `${baseUrl}`]

    let best = null
    for (const endpoint of endpointCandidates) {
      const result = await fetchJson(endpoint, {
        method: 'GET',
        headers: {
          ...(process.env.RUNPOD_API_KEY ? { Authorization: `Bearer ${process.env.RUNPOD_API_KEY}` } : {}),
        },
      })

      if (!best || (result.ok && !best.ok)) {
        best = { endpoint, ...result }
      }

      if (result.ok) break
    }

    probes.push({
      label,
      baseUrl,
      ok: Boolean(best?.ok),
      status: best?.status ?? null,
      endpoint: best?.endpoint || null,
      detail: best?.ok ? 'reachable' : best?.bodyPreview || 'unreachable',
    })
  }

  return probes
}

async function probeSupabaseAccess() {
  const supabaseUrl = sanitizeBaseUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

  if (!supabaseUrl || !serviceRole) {
    return {
      ok: false,
      reason: 'SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing',
      dbProbe: null,
      bucketProbe: null,
      buckets: [],
    }
  }

  const headers = {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
  }

  const dbProbe = await fetchJson(
    `${supabaseUrl}/rest/v1/organizations?select=id&limit=1`,
    { method: 'GET', headers },
  )

  const bucketProbe = await fetchJson(
    `${supabaseUrl}/storage/v1/bucket`,
    { method: 'GET', headers },
  )

  const buckets = Array.isArray(bucketProbe.data)
    ? bucketProbe.data
        .map((row) => String(row?.name || '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    : []

  return {
    ok: dbProbe.ok && bucketProbe.ok,
    reason: dbProbe.ok && bucketProbe.ok
      ? 'db + storage probes passed'
      : `dbProbe=${dbProbe.status || 'error'} bucketProbe=${bucketProbe.status || 'error'}`,
    dbProbe,
    bucketProbe,
    buckets,
  }
}

async function main() {
  const strict = hasFlag('strict') || toBool(process.env.BOB_UNIVERSAL_ACCESS_STRICT)
  const json = hasFlag('json')

  const repoGit = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })

  const repoReadable = repoGit.status === 0 && String(repoGit.stdout || '').trim() === 'true'
  const schemaFileExists = await pathExists('src/types/database.ts')
  const trainingWiring = runNodeScript('scripts/verify-bob-training-wiring.mjs', ['--json-only'])
  const supabaseProbe = await probeSupabaseAccess()
  const serviceProbes = await probeServices()

  const servicePassCount = serviceProbes.filter((probe) => probe.ok).length

  const checks = [
    {
      id: 'repo.readable',
      required: true,
      ok: repoReadable,
      detail: repoReadable ? 'git repository readable' : 'git repository probe failed',
    },
    {
      id: 'training.wiring',
      required: true,
      ok: trainingWiring.ok,
      detail: trainingWiring.ok ? 'training wiring verified' : trainingWiring.stderr || 'training wiring verification failed',
    },
    {
      id: 'schema.database_types',
      required: true,
      ok: schemaFileExists,
      detail: schemaFileExists ? 'src/types/database.ts present' : 'src/types/database.ts missing',
    },
    {
      id: 'supabase.db_and_storage',
      required: true,
      ok: supabaseProbe.ok,
      detail: supabaseProbe.reason,
    },
    {
      id: 'supabase.storage_all_buckets_visible',
      required: true,
      ok: supabaseProbe.ok && supabaseProbe.buckets.length > 0,
      detail: supabaseProbe.ok
        ? `visible buckets (${supabaseProbe.buckets.length}): ${supabaseProbe.buckets.join(', ')}`
        : 'bucket list unavailable',
    },
    {
      id: 'hosted.services_reachable',
      required: false,
      ok: serviceProbes.length === 0 ? false : servicePassCount === serviceProbes.length,
      detail:
        serviceProbes.length === 0
          ? 'no service URLs provided in environment'
          : `reachable ${servicePassCount}/${serviceProbes.length}`,
    },
  ]

  const requiredFailures = checks.filter((check) => check.required && !check.ok)
  const summary = {
    generatedAt: new Date().toISOString(),
    status: requiredFailures.length === 0 ? 'READY' : 'BLOCKED',
    strict,
    totals: {
      checks: checks.length,
      requiredFailures: requiredFailures.length,
      visibleBuckets: supabaseProbe.buckets.length,
      serviceProbes: serviceProbes.length,
      servicePassCount,
    },
  }

  const report = {
    summary,
    checks,
    supabase: {
      dbStatus: supabaseProbe.dbProbe?.status ?? null,
      bucketStatus: supabaseProbe.bucketProbe?.status ?? null,
      buckets: supabaseProbe.buckets,
    },
    services: serviceProbes,
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('Bob universal access audit')
    for (const check of checks) {
      const state = check.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN'
      const scope = check.required ? 'required' : 'optional'
      console.log(`${state} [${scope}] ${check.id} - ${check.detail}`)
    }
    console.log(`Summary: ${summary.status} (required failures: ${summary.totals.requiredFailures})`)
  }

  if (strict && requiredFailures.length > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('[bob-universal-access-audit] fatal:', error?.message || error)
  process.exit(1)
})
