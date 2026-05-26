#!/usr/bin/env node

import { execSync } from 'node:child_process'
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

function boolArg(name, fallback = false) {
  const raw = String(arg(name, String(fallback))).trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

function run(command, { allowFailure = false, env = process.env, timeoutMs = 0 } = {}) {
  try {
    const stdout = execSync(command, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      env,
      ...(timeoutMs > 0 ? { timeout: timeoutMs } : {}),
    })
    return { ok: true, code: 0, stdout: String(stdout || ''), stderr: '' }
  } catch (error) {
    const stderr = String(error?.stderr || '')
    const stdout = String(error?.stdout || '')
    const code = Number.isFinite(error?.status) ? Number(error.status) : 1
    if (!allowFailure) {
      throw new Error(`${command}\n${stderr || stdout || String(error?.message || '')}`)
    }
    return { ok: false, code, stdout, stderr }
  }
}

function hasChanges() {
  const res = run('git status --porcelain', { allowFailure: true })
  return String(res.stdout || '').trim().length > 0
}

function main() {
  const maxAttemptsRaw = Number.parseInt(arg('max-attempts', '5'), 10)
  const maxAttempts = Number.isFinite(maxAttemptsRaw) && maxAttemptsRaw > 0 ? maxAttemptsRaw : 5
  const testCommand = String(arg('test-command', 'npm run test')).trim()
  const fixCommand = String(
    arg('fix-command', process.env.BOB_FIX_COMMAND || 'npm run ops:remediate:auto')
  ).trim()
  const commitMessage = String(arg('commit-message', 'chore(self-heal): apply Bob remediation until green')).trim()
  const testTimeoutRaw = Number.parseInt(arg('test-timeout-ms', process.env.BOB_SELF_HEAL_TEST_TIMEOUT_MS || '1800000'), 10)
  const testTimeoutMs = Number.isFinite(testTimeoutRaw) && testTimeoutRaw > 0 ? testTimeoutRaw : 1800000
  const triageTimeoutRaw = Number.parseInt(arg('triage-timeout-ms', process.env.BOB_SELF_HEAL_TRIAGE_TIMEOUT_MS || '600000'), 10)
  const triageTimeoutMs = Number.isFinite(triageTimeoutRaw) && triageTimeoutRaw > 0 ? triageTimeoutRaw : 600000
  const fixTimeoutRaw = Number.parseInt(arg('fix-timeout-ms', process.env.BOB_SELF_HEAL_FIX_TIMEOUT_MS || '900000'), 10)
  const fixTimeoutMs = Number.isFinite(fixTimeoutRaw) && fixTimeoutRaw > 0 ? fixTimeoutRaw : 900000

  const publishFailures = boolArg('publish-failures', true)
  const runTriage = boolArg('triage', true)
  const pushRequested = boolArg('push', false)
  const conductorApproval = String(
    arg('conductor-approval', process.env.BOB_CONDUCTOR_APPROVAL || '')
  )
    .trim()
    .toLowerCase()
  const conductorApproved = ['1', 'true', 'yes', 'approved'].includes(conductorApproval)
  const pushOnGreen = pushRequested && conductorApproved

  const syntheticReporter = String(
    arg('synthetic-monitor-user-id', process.env.SYNTHETIC_MONITOR_USER_ID || '')
  ).trim()

  const summary = {
    startedAt: new Date().toISOString(),
    maxAttempts,
    attempts: [],
    publishFailures,
    runTriage,
    pushRequested,
    conductorApproved,
    pushOnGreen,
    testCommand,
    fixCommand,
    timeoutsMs: {
      test: testTimeoutMs,
      triage: triageTimeoutMs,
      fix: fixTimeoutMs,
    },
    result: 'unknown',
  }

  const publishCmd = syntheticReporter
    ? `SYNTHETIC_MONITOR_USER_ID=${syntheticReporter} node scripts/publish-test-failures-to-bug-reports.mjs`
    : 'node scripts/publish-test-failures-to-bug-reports.mjs'

  if (pushRequested && !conductorApproved) {
    console.warn(
      '[bob-self-heal] push requested but blocked: conductor approval missing. Set --conductor-approval approved (or BOB_CONDUCTOR_APPROVAL=approved).'
    )
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const item = {
      attempt,
      tested: false,
      green: false,
      published: false,
      triaged: false,
      fixed: false,
    }

    console.log(`\n[bob-self-heal] attempt ${attempt}/${maxAttempts}: running tests`) // deliberate concise trace for CI logs
    const test = run(testCommand, { allowFailure: true, timeoutMs: testTimeoutMs })
    item.tested = true
    item.testExitCode = test.code
    item.green = test.ok

    if (test.ok) {
      console.log('[bob-self-heal] tests are green')
      summary.attempts.push(item)
      summary.result = 'green'
      break
    }

    console.log('[bob-self-heal] tests failed; ingesting bug reports and triaging')

    if (publishFailures) {
      const publish = run(publishCmd, { allowFailure: true, timeoutMs: triageTimeoutMs })
      item.published = publish.ok
      item.publishExitCode = publish.code
    }

    if (runTriage) {
      const triage = run('node scripts/rerun-open-bug-reports-dr-bob.mjs --limit=500', {
        allowFailure: true,
        timeoutMs: triageTimeoutMs,
      })
      item.triaged = triage.ok
      item.triageExitCode = triage.code
    }

    if (!fixCommand) {
      item.fixed = false
      summary.attempts.push(item)
      summary.result = 'blocked-no-fix-command'
      console.error('[bob-self-heal] no fix command configured. Set --fix-command or BOB_FIX_COMMAND to continue auto-remediation.')
      break
    }

    console.log('[bob-self-heal] running fix command')
    const fix = run(fixCommand, { allowFailure: true, timeoutMs: fixTimeoutMs })
    item.fixed = fix.ok
    item.fixExitCode = fix.code
    summary.attempts.push(item)
  }

  if (summary.result === 'green') {
    if (hasChanges()) {
      run('git add -A')
      const commit = run(`git commit -m ${JSON.stringify(commitMessage)}`, { allowFailure: true })
      if (!commit.ok) {
        console.warn('[bob-self-heal] commit skipped (possibly no staged changes)')
      }
    }

    if (pushOnGreen) {
      const push = run('git push', { allowFailure: true })
      if (!push.ok) {
        console.error('[bob-self-heal] push failed')
        summary.result = 'green-push-failed'
        summary.finishedAt = new Date().toISOString()
        console.log(`[bob-self-heal] summary ${JSON.stringify(summary)}`)
        process.exit(1)
      }
    }

    summary.finishedAt = new Date().toISOString()
    console.log(`[bob-self-heal] summary ${JSON.stringify(summary)}`)
    process.exit(0)
  }

  if (summary.result === 'unknown') {
    summary.result = 'failed-not-green'
  }

  summary.finishedAt = new Date().toISOString()
  console.log(`[bob-self-heal] summary ${JSON.stringify(summary)}`)
  process.exit(summary.result === 'blocked-no-fix-command' ? 2 : 1)
}

main()
