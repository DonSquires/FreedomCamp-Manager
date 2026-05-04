#!/usr/bin/env node

/**
 * Bob Agentic Test Runner
 *
 * Bob is the autonomous executor. When the RunPod worker supports
 * action:"run_playwright" (Node.js + Playwright installed in the container),
 * tests are submitted to Bob's GPU and he runs them autonomously.
 *
 * Fallback: if Bob can't execute (old image, missing Node.js), tests run
 * locally with Bob providing pre/post advice via action:"chat".
 *
 * Usage:
 *   node scripts/run-tests-on-runpod.mjs --scope quick --suite core
 *   node scripts/run-tests-on-runpod.mjs --scope quick --suite workflows --gpu-tier 1
 *   npm run test:bob:runpod:96
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { loadLocalEnv } from './load-local-env.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

process.chdir(rootDir)
loadLocalEnv()

// ============================================================================
// Configuration
// ============================================================================

const RUNPOD_CONFIG = {
  maxWorkers: 2,
  activeWorkers: 1,
  gpuCount: 2,
  idleTimeout: 60,
  executionTimeout: 600,
  flashboot: false,
}

const GPU_TIERS = {
  '1': { label: '96GB', recommendedWorkers: 2 },
  '2': { label: '24GB Pro', recommendedWorkers: 1 },
}

const TEST_SUITES = {
  core: [
    'tests/e2e/deep-functional.spec.ts',
    'tests/e2e/module-route-access.spec.ts',
  ],
  workflows: [
    'tests/e2e/module-route-access.spec.ts',
    'tests/e2e/module-e2e-comprehensive.spec.ts',
    'tests/e2e/ui-comprehensive.spec.ts',
  ],
}

const BROWSER_PROJECTS = ['chromium', 'firefox', 'webkit', 'Mobile Chrome', 'Mobile Safari']

function collectForwardedTestEnv() {
  const forwarded = {}
  const prefixes = ['PLAYWRIGHT_', 'E2E_', 'API_TEST_']
  const exact = new Set([
    'DEFAULT_PLAYWRIGHT_BASE_URL',
    'PLAYWRIGHT_BASE_URL',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'INFERENCE_SERVICE_URL',
    'INFERENCE_API_KEY',
  ])

  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue
    if (prefixes.some((prefix) => key.startsWith(prefix)) || exact.has(key)) {
      forwarded[key] = value
    }
  }

  const aliases = [
    ['PLAYWRIGHT_OFFICER_ORG1_EMAIL', 'PLAYWRIGHT_OFFICER_EMAIL'],
    ['PLAYWRIGHT_OFFICER_ORG1_PASSWORD', 'PLAYWRIGHT_OFFICER_PASSWORD'],
    ['PLAYWRIGHT_CLIENT_VIEWER_EMAIL', 'PLAYWRIGHT_CLIENT_EMAIL'],
    ['PLAYWRIGHT_CLIENT_VIEWER_PASSWORD', 'PLAYWRIGHT_CLIENT_PASSWORD'],
    ['PLAYWRIGHT_CLIENT_STAFF_EMAIL', 'PLAYWRIGHT_CLIENT_OFFICER_EMAIL'],
    ['PLAYWRIGHT_CLIENT_STAFF_PASSWORD', 'PLAYWRIGHT_CLIENT_OFFICER_PASSWORD'],
  ]

  for (const [target, source] of aliases) {
    if (!forwarded[target] && forwarded[source]) forwarded[target] = forwarded[source]
  }

  if (!forwarded.PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK) {
    forwarded.PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK = '1'
  }

  return forwarded
}

function resolveRepoContext() {
  const repoUrl = String(
    process.env.GITHUB_REPO_URL ||
    process.env.REPO_URL ||
    ''
  ).trim()

  const branch = String(
    process.env.GITHUB_REPO_BRANCH ||
    process.env.REPO_BRANCH ||
    ''
  ).trim()

  const repoToken = String(
    process.env.BOB_WORKER_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_API ||
    ''
  ).trim()

  let resolvedRepoUrl = repoUrl
  let resolvedBranch = branch

  try {
    if (!resolvedRepoUrl) {
      resolvedRepoUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
        cwd: rootDir,
        encoding: 'utf8',
      }).trim()
    }
  } catch {}

  try {
    if (!resolvedBranch) {
      resolvedBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: rootDir,
        encoding: 'utf8',
      }).trim()
    }
  } catch {}

  return {
    repoUrl: resolvedRepoUrl,
    repoBranch: resolvedBranch || 'main',
    repoToken,
  }
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2)
  const parsed = {
    scope: 'quick',
    suite: 'core',
    maxWorkers: RUNPOD_CONFIG.maxWorkers,
    gpuTier: '1',
    queueTimeoutMs: Number(process.env.RUNPOD_QUEUE_TIMEOUT_MS || 600000),
    executionTimeoutMs: Number(process.env.RUNPOD_EXECUTION_TIMEOUT_MS || 3600000),
    out: path.join(rootDir, 'tools/bob-agentic-test-runs/runpod'),
    continueOnFailure: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--scope') {
      parsed.scope = args[++i] || 'quick'
    } else if (arg === '--suite') {
      parsed.suite = args[++i] || 'core'
    } else if (arg === '--max-workers') {
      parsed.maxWorkers = parseInt(args[++i], 10) || 1
    } else if (arg === '--gpu-tier') {
      parsed.gpuTier = args[++i] || '1'
    } else if (arg === '--queue-timeout') {
      parsed.queueTimeoutMs = parseInt(args[++i], 10) || parsed.queueTimeoutMs
    } else if (arg === '--execution-timeout') {
      parsed.executionTimeoutMs = parseInt(args[++i], 10) || parsed.executionTimeoutMs
    } else if (arg === '--timeout') {
      // Backward-compatible alias for queue timeout.
      parsed.queueTimeoutMs = parseInt(args[++i], 10) || parsed.queueTimeoutMs
    } else if (arg === '--out') {
      parsed.out = args[++i]
    } else if (arg === '--continue-on-failure') {
      parsed.continueOnFailure = true
    }
  }

  return parsed
}

function resolveGpuTier(gpuTier) {
  return GPU_TIERS[String(gpuTier)] || GPU_TIERS['1']
}

// ============================================================================
// Bob Autonomous Test Execution (run_playwright action)
// ============================================================================

async function runTestsOnBob(opts) {
  const runpodBase = resolveRunpodBaseUrl().replace(/\/run$/, '')
  const apiKey = resolveRunpodApiKey()
  if (!apiKey) return null
  const repo = resolveRepoContext()
  const forwardedEnv = collectForwardedTestEnv()

  const suiteSpecs = TEST_SUITES[opts.suite] || TEST_SUITES.core
  const specs = opts.scope === 'quick'
    ? [...suiteSpecs, '--project=chromium']
    : suiteSpecs
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  console.log(`[bob] Submitting run_playwright job — scope=${opts.scope} suite=${opts.suite}`)

  const runRes = await fetch(`${runpodBase}/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: {
        action: 'run_playwright',
        scope: opts.scope,
        specs,
        timeout_ms: opts.scope === 'quick'
          ? Math.min(opts.executionTimeoutMs, 540000)
          : opts.executionTimeoutMs,
        ...(repo.repoUrl ? { repo_url: repo.repoUrl } : {}),
        ...(repo.repoBranch ? { repo_branch: repo.repoBranch } : {}),
        ...(repo.repoToken ? { repo_token: repo.repoToken } : {}),
        repo_auth_mode: 'token',
        ...forwardedEnv,
      },
    }),
  }).catch((e) => { throw new Error(`[bob] submit failed: ${e.message}`) })

  if (!runRes.ok) {
    const text = await runRes.text().catch(() => '')
    throw new Error(`[bob] run_playwright submit (${runRes.status}): ${text.slice(0, 240)}`)
  }

  const { id: jobId } = await runRes.json().catch(() => ({}))
  if (!jobId) return null

  console.log(`[bob] Job queued: ${jobId}`)

  const deadline = Date.now() + opts.executionTimeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000))
    const statusRes = await fetch(`${runpodBase}/status/${jobId}`, { headers }).catch(() => null)
    if (!statusRes?.ok) continue
    const payload = await statusRes.json().catch(() => ({}))
    const status = String(payload?.status || '').toUpperCase()
    process.stdout.write(`\r[bob] status=${status}                  `)
    if (status === 'COMPLETED' || status === 'SUCCESS') {
      console.log()
      const output = payload?.output || {}
      if (output.error === 'npx/playwright not found in PATH — Node.js not installed in this worker image') {
        console.warn('[bob] Worker image does not have Node.js yet — falling back to local run')
        return null
      }
      return output
    }
    if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
      console.warn(`\n[bob] Job ${status}: ${JSON.stringify(payload?.error || '').slice(0, 120)}`)
      return null
    }
  }

  console.warn('\n[bob] Execution timed out — falling back to local run')
  return null
}

// ============================================================================
// Ask Bob (RunPod chat action)
// ============================================================================

async function askBob(message) {
  const runpodBase = resolveRunpodBaseUrl().replace(/\/run$/, '')
  const apiKey = resolveRunpodApiKey()

  if (!apiKey) {
    console.warn('[bob] No API key — skipping Bob consultation')
    return null
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  console.log('[bob] Asking Bob via RunPod…')

  const runRes = await fetch(`${runpodBase}/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input: { action: 'chat', message } }),
  }).catch((e) => { throw new Error(`[bob] RunPod submit failed: ${e.message}`) })

  if (!runRes.ok) {
    const text = await runRes.text().catch(() => '')
    throw new Error(`[bob] RunPod run (${runRes.status}): ${text.slice(0, 240)}`)
  }

  const { id: jobId } = await runRes.json().catch(() => ({}))
  if (!jobId) return null

  console.log(`[bob] Job queued: ${jobId}`)

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    const statusRes = await fetch(`${runpodBase}/status/${jobId}`, { headers }).catch(() => null)
    if (!statusRes?.ok) continue
    const payload = await statusRes.json().catch(() => ({}))
    const status = String(payload?.status || '').toUpperCase()
    console.log(`[bob] status=${status}`)
    if (status === 'COMPLETED' || status === 'SUCCESS') {
      return payload?.output?.response || payload?.output?.message || null
    }
    if (status === 'FAILED' || status === 'CANCELLED' || status === 'TIMED_OUT') {
      console.warn(`[bob] Job ${status}: ${JSON.stringify(payload?.error || '').slice(0, 120)}`)
      return null
    }
  }

  console.warn('[bob] Timed out waiting for Bob response — continuing without')
  return null
}

// ============================================================================
// Run tests locally via Bob assist wrapper
// ============================================================================

function runTestsLocally(opts) {
  return new Promise((resolve) => {
    const testSpecs = TEST_SUITES[opts.suite] || TEST_SUITES.core
    const projects = opts.scope === 'quick' ? ['--project', 'chromium', '--project', 'firefox'] : []

    const playwrightArgs = [
      'npx', 'playwright', 'test',
      ...testSpecs,
      ...projects,
      '--reporter=list,json',
      `--workers=${opts.maxWorkers}`,
    ]

    const child = spawn(
      process.execPath,
      ['scripts/run-test-with-bob-assist.mjs', '--', ...playwrightArgs],
      { stdio: 'inherit', env: process.env, cwd: rootDir }
    )

    child.on('close', (code) => resolve(code ?? 1))
    child.on('error', () => resolve(1))
  })
}

// ============================================================================
// Report Generation
// ============================================================================

function generateReport(opts, exitCode, bobPreAdvice, bobPostAdvice) {
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const reportDir = path.join(opts.out, runId)

  mkdirSync(reportDir, { recursive: true })

  const summary = {
    runId,
    gpuTier: resolveGpuTier(opts.gpuTier),
    testConfig: {
      scope: opts.scope,
      suite: opts.suite,
      maxWorkers: opts.maxWorkers,
    },
    bobAssist: {
      enabled: true,
      script: 'scripts/run-test-with-bob-assist.mjs',
      provider: 'runpod/ollama',
      preAdviceSent: true,
      preAdvice: bobPreAdvice || '(Bob unavailable)',
      postAdvice: bobPostAdvice || '(Bob unavailable)',
    },
    result: { exitCode, passed: exitCode === 0 },
    timestamp: new Date().toISOString(),
  }

  writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(summary, null, 2))

  console.log(`\n📊 Report: ${path.join(reportDir, 'report.json')}`)
  console.log('\n' + '='.repeat(70))
  console.log('BOB-COORDINATED TEST SUMMARY')
  console.log('='.repeat(70))
  console.log(`Run ID:    ${runId}`)
  console.log(`Suite:     ${opts.suite}  Scope: ${opts.scope}`)
  console.log(`GPU Tier:  ${resolveGpuTier(opts.gpuTier).label}`)
  console.log(`Runner:    Bob assist wrapper (run-test-with-bob-assist.mjs)`)
  console.log(`Result:    ${exitCode === 0 ? '✅ PASSED' : `❌ FAILED (exit ${exitCode})`}`)
  if (bobPostAdvice) {
    console.log('\nBob post-run advice:')
    console.log(bobPostAdvice.slice(0, 600))
  }
  console.log('='.repeat(70) + '\n')

  return summary
}

// ============================================================================
// Helpers needed by askBob
// ============================================================================

function resolveRunpodBaseUrl() {
  const url = (
    process.env.RUNPOD_API_URL ||
    process.env.RUNPOD_SERVERLESS_URL ||
    process.env.RUNPOD_GATEWAY_URL ||
    ''
  ).trim().replace(/\/+$/, '').replace(/\/run$/, '')

  if (!url) throw new Error('No RunPod URL configured. Set RUNPOD_API_URL.')
  return url
}

function resolveRunpodApiKey() {
  return (process.env.RUNPOD_API_KEY || process.env.INFERENCE_API_KEY || '').trim()
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  try {
    const opts = parseArgs()
    const tier = resolveGpuTier(opts.gpuTier)
    console.log(`\n🤖 Bob Agentic Test Runner`)
    console.log(`   Suite: ${opts.suite}  Scope: ${opts.scope}  GPU: ${tier.label}\n`)

    mkdirSync(opts.out, { recursive: true })

    // ── 1. Try Bob running tests autonomously on GPU ──────────────────────
    const bobResult = await runTestsOnBob(opts).catch((e) => {
      console.warn(`[bob] run_playwright unavailable: ${e.message}`)
      return null
    })

    if (bobResult !== null) {
      // Bob ran the tests himself
      const exitCode = bobResult.success ? 0 : 1
      const { stats = {}, failures = [] } = bobResult
      console.log('\n' + '='.repeat(70))
      console.log('BOB AUTONOMOUS TEST EXECUTION — RESULTS')
      console.log('='.repeat(70))
      console.log(`Passed:  ${stats.passed ?? '?'}`)
      console.log(`Failed:  ${stats.failed ?? '?'}`)
      console.log(`Skipped: ${stats.skipped ?? '?'}`)
      if (failures.length) {
        console.log('\nTop failures:')
        failures.slice(0, 5).forEach((f, i) => {
          console.log(`  ${i + 1}. ${f.file} — ${f.title}`)
          if (f.error) console.log(`     ${f.error.slice(0, 120)}`)
        })
      }
      console.log(`Result:  ${exitCode === 0 ? '✅ PASSED' : `❌ FAILED`}`)
      console.log('='.repeat(70) + '\n')

      // Post-triage from Bob if tests failed
      if (exitCode !== 0) {
        const failureSummary = failures.slice(0, 5).map((f) => `- ${f.file}: ${f.error?.slice(0, 80)}`).join('\n')
        const bobAdvice = await askBob(`Bob, tests failed on the GPU runner.\nFailed: ${stats.failed}. Top failures:\n${failureSummary}\nProvide the top 3 remediation steps.`).catch(() => null)
        if (bobAdvice) {
          console.log('Bob remediation advice:')
          console.log(bobAdvice.slice(0, 600))
          console.log()
        }
      }

      process.exit(exitCode)
    }

    // ── 2. Fallback: Bob advises, tests run locally ───────────────────────
    console.log('[bob] Falling back to local test execution with Bob coaching\n')

    const preMessage = [
      `Bob, about to run the "${opts.suite}" Playwright suite locally (scope: ${opts.scope}).`,
      `GPU tier: ${tier.label}.`,
      'Briefly: any known flaky tests or setup steps to check first?',
    ].join(' ')

    const bobPreAdvice = await askBob(preMessage).catch((e) => {
      console.warn(`[bob] Pre-ask failed: ${e.message}`)
      return null
    })

    if (bobPreAdvice) {
      console.log('\n💬 Bob pre-run advice:')
      console.log(bobPreAdvice.slice(0, 800))
      console.log()
    }

    console.log('▶  Running tests via Bob assist wrapper…\n')
    const exitCode = await runTestsLocally(opts)

    const postMessage = [
      'Bob, the automated Playwright test run just completed.',
      `Suite: ${opts.suite} | Exit code: ${exitCode}`,
      exitCode === 0
        ? 'Tests passed. Provide quick verification checks for regressions to watch.'
        : 'Tests failed. Provide the most likely root causes and top 3 remediation steps.',
    ].join('\n')

    const bobPostAdvice = await askBob(postMessage).catch((e) => {
      console.warn(`[bob] Post-ask failed: ${e.message}`)
      return null
    })

    generateReport(opts, exitCode, bobPreAdvice, bobPostAdvice)

    process.exit(exitCode)
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    process.exit(1)
  }
}

main()
