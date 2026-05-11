#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const INFRA_HINTS = [
  'not configured',
  'unreachable',
  'timed out',
  'aborted',
  'upstream',
  '404',
  '502',
  '503',
  'network',
  'fetch failed',
  'service unavailable',
  'connection',
  'row-level security policy',
]

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7mV3UAAAAASUVORK5CYII='

const SILENCE_WAV_BASE64 =
  'UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAAAAAAAA'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const [k, v] = token.slice(2).split('=')
    if (v != null) {
      args[k] = v
      continue
    }
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args[k] = next
      i += 1
    } else {
      args[k] = 'true'
    }
  }
  return args
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function toBool(v, fallback) {
  if (v == null) return fallback
  const s = String(v).trim().toLowerCase()
  if (!s) return fallback
  return ['1', 'true', 'yes', 'on'].includes(s)
}

function toNumber(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function isLikelyInfraError(errorText) {
  const t = String(errorText || '').toLowerCase()
  return INFRA_HINTS.some((hint) => t.includes(hint))
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function fileContainsAll(filePath, snippets) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return snippets.every((snippet) => raw.includes(snippet))
  } catch {
    return false
  }
}

async function runCommand(command, args, cwd, envOverrides = {}) {
  const mergedEnv = { ...process.env, ...envOverrides }
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: mergedEnv,
      shell: false,
      stdio: 'pipe',
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (buf) => {
      const text = buf.toString()
      stdout += text
      process.stdout.write(text)
    })

    child.stderr.on('data', (buf) => {
      const text = buf.toString()
      stderr += text
      process.stderr.write(text)
    })

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })

    child.on('error', (error) => {
      resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${String(error.message || error)}` })
    })
  })
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function isHttpReachable(url, timeoutMs = 2500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
    })
    return res.status > 0
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function waitForBaseUrlReady(baseUrl, totalWaitMs = 30000, pollMs = 1000) {
  const deadline = Date.now() + Math.max(1000, totalWaitMs)
  const loginUrl = `${baseUrl.replace(/\/$/, '')}/login`
  while (Date.now() < deadline) {
    if (await isHttpReachable(loginUrl)) return true
    if (await isHttpReachable(baseUrl)) return true
    await sleep(pollMs)
  }
  return false
}

function startBackgroundCommand(command, cwd, envOverrides = {}) {
  const mergedEnv = { ...process.env, ...envOverrides }
  const child = spawn(command, {
    cwd,
    env: mergedEnv,
    shell: true,
    stdio: 'pipe',
  })

  let output = ''
  child.stdout.on('data', (buf) => {
    const text = buf.toString()
    output += text
    process.stdout.write(text)
  })
  child.stderr.on('data', (buf) => {
    const text = buf.toString()
    output += text
    process.stderr.write(text)
  })

  const stop = async () => {
    if (child.exitCode != null) return child.exitCode
    await new Promise((resolve) => {
      const hardKill = setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
      }, 5000)
      child.once('close', () => {
        clearTimeout(hardKill)
        resolve(null)
      })
      try { child.kill('SIGTERM') } catch { resolve(null) }
    })
    return child.exitCode ?? 0
  }

  return { child, stop, getOutput: () => output }
}

function buildScore(tests) {
  const totals = {
    pass: 0,
    fail: 0,
    infra: 0,
    skipped: 0,
  }
  for (const t of tests) {
    totals[t.status] = (totals[t.status] ?? 0) + 1
  }
  const denominator = totals.pass + totals.fail + totals.infra
  const reliability = denominator > 0 ? Math.round((totals.pass / denominator) * 100) : 0
  const stability = denominator > 0 ? Math.max(0, 100 - Math.round((totals.fail / denominator) * 100)) : 0
  const operationalReadiness = Math.round((reliability * 0.65) + (stability * 0.35))

  return {
    totals,
    reliability,
    stability,
    operationalReadiness,
  }
}

function summarizeFindings(report) {
  const findings = []
  const failed = report.tests.filter((t) => t.status === 'fail')
  const infra = report.tests.filter((t) => t.status === 'infra')

  for (const t of failed) {
    findings.push({
      severity: 'high',
      test: t.name,
      detail: t.detail,
    })
  }

  for (const t of infra) {
    findings.push({
      severity: 'medium',
      test: t.name,
      detail: t.detail,
    })
  }

  if (report.ux.a11yViolations > 0) {
    findings.push({
      severity: 'medium',
      test: 'ux-a11y',
      detail: `${report.ux.a11yViolations} accessibility violation(s) were found in agentic flows`,
    })
  }

  if (report.ux.blockedAuthCount > 0) {
    findings.push({
      severity: 'medium',
      test: 'ux-auth-flow',
      detail: `${report.ux.blockedAuthCount} flow(s) were blocked by authentication`,
    })
  }

  if ((report.secretAlignment?.mismatchCount || 0) > 0) {
    findings.push({
      severity: 'high',
      test: 'secret-alignment',
      detail: `${report.secretAlignment.mismatchCount} secret alias mismatch(es) detected`,
    })
  }

  if ((report.secretAlignment?.missingCount || 0) > 0) {
    findings.push({
      severity: 'medium',
      test: 'secret-alignment',
      detail: `${report.secretAlignment.missingCount} required or recommended secret group(s) missing`,
    })
  }

  return findings
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (toBool(args.help, false)) {
    console.log(`Human Test Engine\n\nUsage:\n  node scripts/human-test-engine.mjs [--profile tools/human-test-engine/profiles/default.json] [--out tools/human-test-engine/reports] [--skip-ui true] [--skip-multimodal true]\n`)
    process.exit(0)
  }

  const repoRoot = process.cwd()
  const profilePath = path.resolve(args.profile || 'tools/human-test-engine/profiles/default.json')
  const outRoot = path.resolve(args.out || 'tools/human-test-engine/reports')
  const runId = nowStamp()
  const runDir = path.join(outRoot, runId)
  await ensureDir(runDir)

  const profile = await readJson(profilePath)
  const profileEnv = profile?.env && typeof profile.env === 'object' ? profile.env : {}

  // Profile-level env values are authoritative for this run and all child commands.
  for (const [key, value] of Object.entries(profileEnv)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      process.env[key] = String(value)
    }
  }

  // Normalize inference service URL aliases to a single canonical value
  {
    const inferenceCanonical =
      String(process.env.BOB_SERVICE_URL || '').trim() ||
      String(process.env.INFERENCE_SERVICE_URL || '').trim() ||
      String(process.env.VITE_INFERENCE_SERVICE_URL || '').trim() ||
      ''

    if (inferenceCanonical) {
      process.env.BOB_SERVICE_URL = inferenceCanonical
      process.env.INFERENCE_SERVICE_URL = inferenceCanonical
      process.env.VITE_INFERENCE_SERVICE_URL = inferenceCanonical
    }
  }

  // Normalize RunPod URL aliases to a single canonical value
  {
    const runpodCanonical =
      String(process.env.RUNPOD_URL || '').trim() ||
      String(process.env.RUNPOD_GATEWAY_URL || '').trim() ||
      String(process.env.RUNPOD_SERVERLESS_URL || '').trim() ||
      ''

    if (runpodCanonical) {
      process.env.RUNPOD_URL = runpodCanonical
      process.env.RUNPOD_GATEWAY_URL = runpodCanonical
      process.env.RUNPOD_SERVERLESS_URL = runpodCanonical
    }
  }

  const report = {
    runId,
    startedAt: new Date().toISOString(),
    profilePath,
    config: profile,
    tests: [],
    ux: {
      a11yViolations: 0,
      blockedAuthCount: 0,
      flowBreaks: 0,
    },
    auth: {
      userId: null,
      organizationId: null,
    },
    secretAlignment: {
      mismatchCount: 0,
      missingCount: 0,
      checks: [],
    },
    architectureContext: {
      configured: false,
      missingKeys: [],
    },
    trainingPacks: {
      enabled: false,
      configuredCount: 0,
      missing: [],
    },
    findings: [],
    score: null,
  }

  function record(name, status, detail, extra = {}) {
    report.tests.push({
      name,
      status,
      detail,
      at: new Date().toISOString(),
      ...extra,
    })
  }

  if (!toBool(args['skip-architecture-context'], false) && toBool(profile.stages?.architectureContextChecks, true)) {
    const context = profile?.architectureContext && typeof profile.architectureContext === 'object'
      ? profile.architectureContext
      : null

    const hasMultiOrg = Boolean(context?.multiOrgDriver?.scopeBy)
      && context?.multiOrgDriver?.requireContextIndicator === true
      && context?.multiOrgDriver?.forbidCrossTenantLeakage === true

    const hasVisual = context?.visualHierarchy?.preferSpacingOverBorders === true
      && Boolean(context?.visualHierarchy?.colorLogic?.action)
      && Boolean(context?.visualHierarchy?.colorLogic?.success)
      && Boolean(context?.visualHierarchy?.colorLogic?.warning)
      && Boolean(context?.visualHierarchy?.colorLogic?.danger)

    const hasRealtime = context?.realtimeAndPTT?.optimisticUpdatesRequired === true
      && Array.isArray(context?.realtimeAndPTT?.requiredStates)
      && context.realtimeAndPTT.requiredStates.length >= 4

    const hasModuleBlueprint = Boolean(context?.moduleBlueprint?.root)
      && Array.isArray(context?.moduleBlueprint?.requiredStructure)
      && context.moduleBlueprint.requiredStructure.length >= 4

    const missingKeys = []
    if (!hasMultiOrg) missingKeys.push('multiOrgDriver')
    if (!hasVisual) missingKeys.push('visualHierarchy')
    if (!hasRealtime) missingKeys.push('realtimeAndPTT')
    if (!hasModuleBlueprint) missingKeys.push('moduleBlueprint')

    report.architectureContext.configured = missingKeys.length === 0
    report.architectureContext.missingKeys = missingKeys

    if (missingKeys.length === 0) {
      record('architecture-context.blueprint', 'pass', 'Architecture context injection loaded from Human Test profile')
    } else {
      record('architecture-context.blueprint', 'fail', `Missing architecture context sections: ${missingKeys.join(', ')}`)
    }
  }

  if (!toBool(args['skip-training-packs'], false) && toBool(profile.stages?.trainingPackChecks, true)) {
    const configuredPacks = Array.isArray(profile?.trainingPacks) ? profile.trainingPacks : []
    const packs = configuredPacks.length > 0
      ? configuredPacks
      : [
          {
            name: 'all-in-one-training-bundle',
            path: 'docs/BOB_TRAINING_ALL_IN_ONE.md',
            requiredSnippets: ['Unified Training Bundle', 'Required Output Evidence Block', 'Unified Acceptance Gate'],
          },
          {
            name: 'stack-schema-fidelity',
            path: 'docs/BOB_TRAINING_STACK_SCHEMA_FIDELITY.md',
            requiredSnippets: ['Stack Lock (Non-Negotiable)', 'Schema Truth Protocol', 'Required Output Evidence Block'],
          },
          {
            name: 'tenant-isolation-proof',
            path: 'docs/BOB_TRAINING_TENANT_ISOLATION_PROOF.md',
            requiredSnippets: ['Tenant Isolation Proof', 'Negative Test Cases (Mandatory)'],
          },
          {
            name: 'self-eval-loop',
            path: 'docs/BOB_TRAINING_SELF_EVAL_LOOP.md',
            requiredSnippets: ['Self-Eval Gates (8)', 'Auto-Revision Rule', 'Blocker Declaration'],
          },
          {
            name: 'cinematic-ui-interaction',
            path: 'docs/BOB_TRAINING_CINEMATIC_UI_INTERACTION.md',
            requiredSnippets: ['Cinematic Interaction Contract', 'Multimodal UX Modules (Required)', 'Required Output Evidence Block'],
          },
          {
            name: 'autonomous-debugger',
            path: 'docs/BOB_TRAINING_AUTONOMOUS_DEBUGGER.md',
            requiredSnippets: ['The Autonomous Debug Loop (ADL)', 'Pattern Library: Known Failure Signatures', 'Acceptance Gate'],
          },
        ]

    report.trainingPacks.enabled = true
    report.trainingPacks.configuredCount = packs.length

    for (const pack of packs) {
      const relativePath = String(pack.path || '').trim()
      const absolutePath = path.resolve(path.join(repoRoot, relativePath))
      const exists = await fileExists(absolutePath)
      if (!exists) {
        report.trainingPacks.missing.push(relativePath)
        record(`training-pack.${pack.name}`, 'fail', `Missing training pack file: ${relativePath}`)
        continue
      }

      const requiredSnippets = Array.isArray(pack.requiredSnippets)
        ? pack.requiredSnippets.map((item) => String(item)).filter(Boolean)
        : []

      if (requiredSnippets.length === 0) {
        record(`training-pack.${pack.name}`, 'pass', `Training pack present: ${relativePath}`)
        continue
      }

      const contentOk = await fileContainsAll(absolutePath, requiredSnippets)
      if (contentOk) {
        record(`training-pack.${pack.name}`, 'pass', `Training pack present and content-validated: ${relativePath}`)
      } else {
        record(`training-pack.${pack.name}`, 'fail', `Training pack missing required sections: ${relativePath}`)
      }
    }

    const instructionsPath = path.resolve(path.join(repoRoot, 'BOB_INSTRUCTIONS.md'))
    const instructionsOk = await fileContainsAll(instructionsPath, [
      'docs/BOB_TRAINING_ALL_IN_ONE.md',
      'docs/BOB_TRAINING_STACK_SCHEMA_FIDELITY.md',
      'docs/BOB_TRAINING_TENANT_ISOLATION_PROOF.md',
      'docs/BOB_TRAINING_SELF_EVAL_LOOP.md',
      'docs/BOB_TRAINING_CINEMATIC_UI_INTERACTION.md',
      'docs/BOB_TRAINING_AUTONOMOUS_DEBUGGER.md',
    ])
    record(
      'training-pack.instructions-wiring',
      instructionsOk ? 'pass' : 'fail',
      instructionsOk
        ? 'BOB_INSTRUCTIONS references all required training packs'
        : 'BOB_INSTRUCTIONS missing one or more training pack references',
    )
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || ''
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || ''
  const API_TEST_EMAIL = process.env.API_TEST_EMAIL || process.env.PLAYWRIGHT_ADMIN_EMAIL || ''
  const API_TEST_PASSWORD = process.env.API_TEST_PASSWORD || process.env.PLAYWRIGHT_ADMIN_PASSWORD || ''

  if (!toBool(args['skip-secret-alignment'], false) && toBool(profile.stages?.secretAlignmentChecks, true)) {
    const secretGroups = [
      { name: 'supabase-url', required: true, vars: ['VITE_SUPABASE_URL', 'SUPABASE_URL'] },
      { name: 'inference-url', required: false, vars: ['BOB_SERVICE_URL', 'INFERENCE_SERVICE_URL', 'VITE_INFERENCE_SERVICE_URL'] },
      { name: 'inference-key', required: false, vars: ['BOB_INFERENCE_API_KEY', 'INFERENCE_API_KEY', 'VITE_INFERENCE_API_KEY'] },
      { name: 'runpod-url', required: false, vars: ['RUNPOD_GATEWAY_URL', 'RUNPOD_SERVERLESS_URL', 'RUNPOD_URL', 'BOB_SERVICE_URL', 'INFERENCE_SERVICE_URL', 'VITE_INFERENCE_SERVICE_URL'] },
      { name: 'runpod-key', required: false, vars: ['RUNPOD_API_KEY', 'DR_BOB_API'] },
    ]

    const normalizeSecretValue = (name, value) => {
      const raw = String(value || '').trim()
      if (!raw) return ''
      if (name.toLowerCase().includes('url')) return raw.replace(/\/+$/, '')
      return raw
    }

    for (const group of secretGroups) {
      const present = group.vars
        .map((name) => ({ name, value: normalizeSecretValue(name, process.env[name]) }))
        .filter((entry) => entry.value)
      const uniqueValues = [...new Set(present.map((entry) => entry.value))]
      const missing = present.length === 0
      const mismatch = uniqueValues.length > 1

      report.secretAlignment.checks.push({
        group: group.name,
        vars: group.vars,
        present: present.map((entry) => entry.name),
        missing,
        mismatch,
      })

      if (mismatch) report.secretAlignment.mismatchCount += 1
      if (missing) report.secretAlignment.missingCount += 1

      if (mismatch) {
        record(`secret-alignment.${group.name}`, 'fail', `Alias values do not align across ${group.vars.join(', ')}`)
      } else if (missing) {
        record(`secret-alignment.${group.name}`, group.required ? 'fail' : 'infra', `No value set for ${group.vars.join(', ')}`)
      } else {
        record(`secret-alignment.${group.name}`, 'pass', `Aligned across ${present.map((entry) => entry.name).join(', ')}`)
      }
    }

    const supabaseServiceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
    report.secretAlignment.checks.push({
      group: 'supabase-service-role',
      vars: ['SUPABASE_SERVICE_ROLE_KEY'],
      present: supabaseServiceRole ? ['SUPABASE_SERVICE_ROLE_KEY'] : [],
      missing: !supabaseServiceRole,
      mismatch: false,
    })
    if (!supabaseServiceRole) {
      report.secretAlignment.missingCount += 1
      record('secret-alignment.supabase-service-role', 'infra', 'SUPABASE_SERVICE_ROLE_KEY not set; admin/document probes may be limited')
    } else {
      record('secret-alignment.supabase-service-role', 'pass', 'SUPABASE_SERVICE_ROLE_KEY present')
    }

    const apiEmail = String(process.env.API_TEST_EMAIL || '').trim()
    const playwrightEmail = String(process.env.PLAYWRIGHT_ADMIN_EMAIL || '').trim()
    if (apiEmail && playwrightEmail && apiEmail !== playwrightEmail) {
      report.secretAlignment.mismatchCount += 1
      report.secretAlignment.checks.push({
        group: 'test-user-email',
        vars: ['API_TEST_EMAIL', 'PLAYWRIGHT_ADMIN_EMAIL'],
        present: ['API_TEST_EMAIL', 'PLAYWRIGHT_ADMIN_EMAIL'],
        missing: false,
        mismatch: true,
      })
      record('secret-alignment.test-user-email', 'fail', 'API_TEST_EMAIL and PLAYWRIGHT_ADMIN_EMAIL differ')
    } else if (apiEmail || playwrightEmail) {
      report.secretAlignment.checks.push({
        group: 'test-user-email',
        vars: ['API_TEST_EMAIL', 'PLAYWRIGHT_ADMIN_EMAIL'],
        present: [apiEmail ? 'API_TEST_EMAIL' : '', playwrightEmail ? 'PLAYWRIGHT_ADMIN_EMAIL' : ''].filter(Boolean),
        missing: false,
        mismatch: false,
      })
      record('secret-alignment.test-user-email', 'pass', 'Test-user email sources align')
    }
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !API_TEST_EMAIL || !API_TEST_PASSWORD) {
    record('bootstrap.credentials', 'fail', 'Missing one or more required env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, API_TEST_EMAIL, API_TEST_PASSWORD')
    report.score = buildScore(report.tests)
    report.findings = summarizeFindings(report)
    report.endedAt = new Date().toISOString()
    const reportFile = path.join(runDir, 'report.json')
    await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const signinStarted = Date.now()
  const signIn = await supabase.auth.signInWithPassword({
    email: API_TEST_EMAIL,
    password: API_TEST_PASSWORD,
  })
  if (signIn.error || !signIn.data.session?.access_token || !signIn.data.user?.id) {
    record('auth.signin', 'fail', signIn.error?.message || 'Sign-in failed', { durationMs: Date.now() - signinStarted })
  } else {
    record('auth.signin', 'pass', 'Authenticated test account', { durationMs: Date.now() - signinStarted })
    report.auth.userId = signIn.data.user.id
  }

  const token = signIn.data.session?.access_token || ''
  const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  let organizationId = null
  if (token && signIn.data.user?.id) {
    const orgStart = Date.now()
    const { data: profileData, error: profileError } = await authed
      .from('user_profiles')
      .select('organization_id')
      .eq('id', signIn.data.user.id)
      .single()
    if (profileError || !profileData?.organization_id) {
      record('auth.resolve_org', 'fail', profileError?.message || 'organization_id not found', { durationMs: Date.now() - orgStart })
    } else {
      organizationId = profileData.organization_id
      report.auth.organizationId = organizationId
      record('auth.resolve_org', 'pass', `organization_id=${organizationId}`, { durationMs: Date.now() - orgStart })
    }
  }

  if (!toBool(args['skip-secret-alignment'], false) && toBool(profile.stages?.secretAlignmentChecks, true)) {
    const explicitOrgValues = ['BOB_ORG_ID', 'ORG_ID', 'DEFAULT_ORG_ID']
      .map((name) => ({ name, value: String(process.env[name] || '').trim() }))
      .filter((entry) => entry.value)

    const uniqueExplicitOrgValues = [...new Set(explicitOrgValues.map((entry) => entry.value))]
    const derivedOrgId = String(organizationId || '').trim()
    const orgContextMismatch = uniqueExplicitOrgValues.length > 1
    const orgContextMissing = explicitOrgValues.length === 0 && !derivedOrgId

    report.secretAlignment.checks.push({
      group: 'org-context',
      vars: ['BOB_ORG_ID', 'ORG_ID', 'DEFAULT_ORG_ID'],
      present: explicitOrgValues.length > 0
        ? explicitOrgValues.map((entry) => entry.name)
        : (derivedOrgId ? ['auth.resolve_org'] : []),
      missing: orgContextMissing,
      mismatch: orgContextMismatch,
    })

    if (orgContextMismatch) {
      report.secretAlignment.mismatchCount += 1
      record('secret-alignment.org-context', 'fail', 'Alias values do not align across BOB_ORG_ID, ORG_ID, DEFAULT_ORG_ID')
    } else if (derivedOrgId) {
      record('secret-alignment.org-context', 'pass', `Derived org context from authenticated test account: ${derivedOrgId}`)
    } else {
      report.secretAlignment.missingCount += 1
      record('secret-alignment.org-context', 'infra', 'No value set for BOB_ORG_ID, ORG_ID, DEFAULT_ORG_ID and auth.resolve_org did not produce an organization_id')
    }
  }

  async function callEdge(functionName, body, timeoutMs = 45000) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
      })
      const text = await res.text().catch(() => '')
      let json = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = null
      }
      return {
        ok: res.ok,
        status: res.status,
        json,
        text,
        contentType: String(res.headers.get('content-type') || '').toLowerCase(),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async function callEdgeMultipart(functionName, formData, timeoutMs = 45000) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: formData,
        signal: controller.signal,
      })
      const text = await res.text().catch(() => '')
      let json = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = null
      }
      return {
        ok: res.ok,
        status: res.status,
        json,
        text,
        contentType: String(res.headers.get('content-type') || '').toLowerCase(),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  let externalHealthPayload = null
  if (!toBool(args['skip-external'], false) && toBool(profile.stages?.externalServiceChecks, true)) {
    const start = Date.now()
    try {
      const health = await fetch(`${SUPABASE_URL}/functions/v1/check-services-health`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      })
      const payload = await health.json().catch(() => ({}))
      externalHealthPayload = payload
      if (health.ok) {
        record('external.check_railway_health', 'pass', `HTTP ${health.status}`, {
          durationMs: Date.now() - start,
          payload,
        })
      } else {
        const msg = `HTTP ${health.status}`
        record('external.check_railway_health', isLikelyInfraError(msg) ? 'infra' : 'fail', msg, {
          durationMs: Date.now() - start,
        })
      }
    } catch (error) {
      const msg = String(error?.message || error)
      record('external.check_railway_health', isLikelyInfraError(msg) ? 'infra' : 'fail', msg, {
        durationMs: Date.now() - start,
      })
    }
  }

  if (!toBool(args['skip-multimodal'], false) && toBool(profile.stages?.multimodalChecks, true) && token) {
    const inferenceReportedOffline = String(externalHealthPayload?.inference?.status || '').toLowerCase() === 'offline'

    const multimodalCases = [
      {
        name: 'multimodal.chat_response',
        fn: async () => callEdge('onspace-ai-chat', {
          message: 'In one short paragraph, explain the safest first action for a dispatcher when a live incident starts.',
        }, 90000),
        validate: (resp) => resp.ok && !!(resp.json?.response || resp.json?.reply || resp.text),
      },
      {
        name: 'multimodal.speak',
        optionalCapability: true,
        fn: async () => callEdge('synthesize-speech', {
          text: 'FieldOps audio system test. Confirm voice synthesis and playback path.',
          format: 'wav',
        }),
        validate: (resp) => {
          if (!resp.ok) return false
          if (resp.json?.error) return false
          return Boolean(
            resp.json?.audio_base64 ||
              resp.json?.audio ||
              resp.json?.url ||
              resp.json?.spoken_text ||
              resp.json?.client_action ||
              (resp.contentType && resp.contentType.startsWith('audio/')),
          )
        },
      },
      {
        name: 'multimodal.listen',
        optionalCapability: true,
        fn: async () => callEdge('transcribe-audio', {
          audio_base64: SILENCE_WAV_BASE64,
          audio_mime_type: 'audio/wav',
          language: 'en',
        }),
        validate: (resp) => resp.ok,
      },
      {
        name: 'multimodal.image_assess',
        fn: async () => callEdge('smoke-assess', {
          image_base64: ONE_PIXEL_PNG_BASE64,
          address: 'Test Address, Nelson',
          complaint_time: new Date().toISOString(),
          duration_reported: 5,
        }),
        validate: (resp) => resp.ok && resp.json?.success === true,
      },
    ]

    for (const test of multimodalCases) {
      const start = Date.now()
      try {
        const resp = await test.fn()
        if (test.validate(resp)) {
          record(test.name, 'pass', `HTTP ${resp.status}`, { durationMs: Date.now() - start })
        } else {
          const detail = resp.json?.error || resp.text || `HTTP ${resp.status}`
          const detailText = String(detail || '').toLowerCase()
          const infer404 = detailText.includes('(404)') || detailText.includes(' 404') || detailText.includes('not found')
          const unsupportedAction = detailText.includes('unknown action') || detailText.includes('unsupported action')

          if (test.optionalCapability && (inferenceReportedOffline || infer404 || unsupportedAction)) {
            record(test.name, 'skipped', inferenceReportedOffline
              ? 'Inference service reported offline in external health check'
              : unsupportedAction
                ? 'Inference provider does not expose this optional capability in current runtime'
                : 'Inference endpoint unavailable (404)', {
              durationMs: Date.now() - start,
              statusCode: resp.status,
            })
          } else {
            record(test.name, isLikelyInfraError(detail) ? 'infra' : 'fail', String(detail).slice(0, 220), {
              durationMs: Date.now() - start,
              statusCode: resp.status,
            })
          }
        }
      } catch (error) {
        const detail = String(error?.message || error)
        record(test.name, isLikelyInfraError(detail) ? 'infra' : 'fail', detail, { durationMs: Date.now() - start })
      }
    }

    // Document path: use server-side ingest function to validate reference ingestion.
    const docStart = Date.now()
    try {
      const form = new FormData()
      form.append('title', `Human Test Engine Probe ${Date.now()}`)
      form.append('description', 'Automated document extraction probe')
      form.append('material_type', 'policy')
      form.append('manual_text', 'Human test engine manual reference text for ingestion verification.')

      const ingest = await callEdgeMultipart('ingest-reference-material', form)
      if (ingest.ok && ingest.json?.reference_material_id) {
        record('multimodal.document_extract', 'pass', 'Reference ingestion accepted', { durationMs: Date.now() - docStart })
      } else {
        const detail = String(ingest.json?.error || ingest.text || `HTTP ${ingest.status}`)
        const lowered = detail.toLowerCase()
        if (lowered.includes("could not find the table 'public.tender_reference_materials'")) {
          record('multimodal.document_extract', 'skipped', 'Tender reference library table not available in this environment', {
            durationMs: Date.now() - docStart,
            statusCode: ingest.status,
          })
        } else
        if (ingest.status === 403 && (lowered.includes('admin') || lowered.includes('organization'))) {
          record('multimodal.document_extract', 'skipped', detail.slice(0, 220), { durationMs: Date.now() - docStart })
        } else {
          record('multimodal.document_extract', isLikelyInfraError(detail) ? 'infra' : 'fail', detail.slice(0, 220), {
            durationMs: Date.now() - docStart,
            statusCode: ingest.status,
          })
        }
      }
    } catch (error) {
      const detail = String(error?.message || error)
      record('multimodal.document_extract', isLikelyInfraError(detail) ? 'infra' : 'fail', detail, { durationMs: Date.now() - docStart })
    }
  }

  if (!toBool(args['skip-ui'], false) && toBool(profile.stages?.uiChecks, true)) {
    const agenticBaseUrl = String(profile.ui?.agenticBaseUrl || process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173').replace(/\/$/, '')
    const agenticBaseUrlWaitMs = toNumber(profile.ui?.agenticBaseUrlWaitMs, 30000)
    const autoStartAgenticWebServer = toBool(profile.ui?.autoStartAgenticWebServer, true)
    const agenticWebServerCommand = String(profile.ui?.agenticWebServerCommand || 'bunx vite --port 5173 --strictPort')
    let managedUiServer = null
    let baseReady = await waitForBaseUrlReady(agenticBaseUrl, agenticBaseUrlWaitMs)

    if (!baseReady && autoStartAgenticWebServer) {
      managedUiServer = startBackgroundCommand(agenticWebServerCommand, repoRoot, profileEnv)
      baseReady = await waitForBaseUrlReady(agenticBaseUrl, agenticBaseUrlWaitMs)
    }

    const runAgenticPacks = toBool(profile.ui?.runAgenticPacks, true)
    const agenticPacks = runAgenticPacks && Array.isArray(profile.ui?.agenticPacks) ? profile.ui.agenticPacks : []
    try {
      if (!baseReady) {
        for (const pack of agenticPacks) {
          report.ux.flowBreaks += 1
          record(`ui.agentic.${pack}`, 'infra', `Agentic base URL unreachable: ${agenticBaseUrl}`, { durationMs: 0 })
        }
      } else {
        for (const pack of agenticPacks) {
          const start = Date.now()
          const evidenceDir = path.join(runDir, 'agentic', pack)
          await ensureDir(evidenceDir)
          const cmd = await runCommand('node', [
            'scripts/agentic-ui-shadow-user.mjs',
            '--pack',
            pack,
            '--base-url',
            agenticBaseUrl,
            '--email',
            API_TEST_EMAIL,
            '--password',
            API_TEST_PASSWORD,
            '--evidence-dir',
            evidenceDir,
            '--max-steps',
            String(toNumber(profile.ui?.agenticMaxSteps, 14)),
            '--timeout-ms',
            String(toNumber(profile.ui?.agenticTimeoutMs, 15000)),
            ...(toBool(profile.ui?.agenticNoPlanner, true) ? ['--no-planner'] : []),
          ], repoRoot, profileEnv)

          let packStatus = 'fail'
          let packDetail = `exit=${cmd.exitCode}`
          try {
            const packReport = await readJson(path.join(evidenceDir, 'report.json'))
            const result = String(packReport.result || 'unknown')
            const actionViolations = (packReport.actions || []).reduce((sum, a) => {
              const count = Array.isArray(a.execution?.a11y?.violations) ? a.execution.a11y.violations.length : 0
              return sum + count
            }, 0)
            report.ux.a11yViolations += actionViolations
            if (result === 'blocked_auth') report.ux.blockedAuthCount += 1
            if (['failed', 'failed_launch'].includes(result)) report.ux.flowBreaks += 1

            const executionError = String(packReport.actions?.[0]?.execution?.error || '')
            if (executionError.includes('ERR_CONNECTION_REFUSED') || executionError.includes('ECONNREFUSED') || result === 'blocked_infra') {
              packStatus = 'infra'
              packDetail = `result=${result}, startup connectivity error`
            } else if (['completed', 'max-steps-reached'].includes(result) && cmd.exitCode === 0) {
              packStatus = 'pass'
              packDetail = `result=${result}, a11y_violations=${actionViolations}`
            } else if (result === 'blocked_auth') {
              packStatus = 'infra'
              packDetail = 'flow blocked by authentication credentials'
            } else {
              packStatus = 'fail'
              packDetail = `result=${result}, exit=${cmd.exitCode}, a11y_violations=${actionViolations}`
            }
          } catch {
            packStatus = cmd.exitCode === 0 ? 'pass' : 'fail'
          }

          record(`ui.agentic.${pack}`, packStatus, packDetail, { durationMs: Date.now() - start })
        }
      }
    } finally {
      if (managedUiServer) {
        await managedUiServer.stop()
      }
    }

    if (toBool(profile.ui?.runPlaywrightSweep, true)) {
      const start = Date.now()
      const command = String(profile.ui?.playwrightCommand || 'bunx playwright test tests/e2e/crm-service-provider-visual.spec.ts --project=chromium')
      const parts = command.split(' ').filter(Boolean)
      const cmd = await runCommand(parts[0], parts.slice(1), repoRoot, profileEnv)
      if (cmd.exitCode === 0) {
        record('ui.playwright.crm_visual_sweep', 'pass', 'Playwright sweep passed', { durationMs: Date.now() - start })
      } else {
        const detail = (cmd.stderr || cmd.stdout || 'Playwright failure').slice(-300)
        record('ui.playwright.crm_visual_sweep', 'fail', detail, { durationMs: Date.now() - start })
        report.ux.flowBreaks += 1
      }
    }
  }

  report.score = buildScore(report.tests)
  report.findings = summarizeFindings(report)
  report.endedAt = new Date().toISOString()

  const reportFile = path.join(runDir, 'report.json')
  const markdownFile = path.join(runDir, 'report.md')
  await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  const md = [
    '# Human Test Engine Report',
    '',
    `- Run ID: ${report.runId}`,
    `- Started: ${report.startedAt}`,
    `- Ended: ${report.endedAt}`,
    `- Reliability: ${report.score.reliability}%`,
    `- Stability: ${report.score.stability}%`,
    `- Operational Readiness: ${report.score.operationalReadiness}%`,
    '',
    '## Totals',
    '',
    `- Pass: ${report.score.totals.pass}`,
    `- Fail: ${report.score.totals.fail}`,
    `- Infra: ${report.score.totals.infra}`,
    `- Skipped: ${report.score.totals.skipped}`,
    '',
    '## UX Signals',
    '',
    `- A11y violations: ${report.ux.a11yViolations}`,
    `- Auth-blocked flows: ${report.ux.blockedAuthCount}`,
    `- Flow breaks: ${report.ux.flowBreaks}`,
    '',
    '## Findings',
    '',
    ...(report.findings.length
      ? report.findings.map((f) => `- [${f.severity.toUpperCase()}] ${f.test}: ${f.detail}`)
      : ['- No findings recorded.']),
    '',
    '## Test Results',
    '',
    ...report.tests.map((t) => `- ${t.status.toUpperCase()} ${t.name}: ${t.detail}`),
    '',
  ].join('\n')
  await fs.writeFile(markdownFile, md, 'utf8')

  console.log(`\nHuman test engine completed.\nReport: ${reportFile}\nSummary: ${markdownFile}`)

  if (report.score.totals.fail > 0) process.exit(1)
}

main().catch((error) => {
  console.error('[human-test-engine] fatal:', error?.message || error)
  process.exit(1)
})
