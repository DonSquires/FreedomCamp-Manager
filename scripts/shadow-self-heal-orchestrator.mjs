#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const LEVEL_SCORE = {
  normal: 0,
  watch: 1,
  action: 2,
  critical: 3,
}

function getArg(name, fallback = '') {
  const key = `--${name}`
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '')
    if (token === key) return String(argv[i + 1] || fallback)
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1)
  }
  return fallback
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function runShell(command, allowFailure = false) {
  try {
    const stdout = execSync(command, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, stdout: String(stdout || '').trim(), stderr: '', command }
  } catch (error) {
    const stdout = String(error?.stdout || '').trim()
    const stderr = String(error?.stderr || '').trim()
    if (!allowFailure) {
      throw new Error(`${command}\n${stderr || stdout || 'command failed'}`)
    }
    return { ok: false, stdout, stderr: stderr || stdout || 'command failed', command }
  }
}

function runMonitor({ minutes, orgId }) {
  const pieces = [
    'node scripts/shadow-near-live-monitor.mjs --json --no-write-report',
    `--minutes ${minutes}`,
  ]
  if (orgId) pieces.push(`--org-id ${orgId}`)
  const cmd = pieces.join(' ')
  const result = runShell(cmd, true)
  if (!result.ok) {
    throw new Error(`shadow monitor failed: ${result.stderr}`)
  }

  let json
  try {
    json = JSON.parse(result.stdout)
  } catch {
    throw new Error('shadow monitor returned non-json output')
  }
  return json
}

function improvementReached(beforeSummary, afterSummary, minImprovementRate) {
  const beforeLevelScore = LEVEL_SCORE[String(beforeSummary?.level || 'critical')] ?? 3
  const afterLevelScore = LEVEL_SCORE[String(afterSummary?.level || 'critical')] ?? 3
  const levelImproved = afterLevelScore < beforeLevelScore

  const beforeRate = Number(beforeSummary?.errorRate || 0)
  const afterRate = Number(afterSummary?.errorRate || 0)
  const errorRateDelta = beforeRate - afterRate

  const beforeCount = Number(beforeSummary?.errorEvents || 0)
  const afterCount = Number(afterSummary?.errorEvents || 0)
  const errorCountImproved = afterCount < beforeCount

  const rateImprovedEnough = errorRateDelta >= minImprovementRate

  return {
    ok: levelImproved || rateImprovedEnough || errorCountImproved,
    levelImproved,
    rateImprovedEnough,
    errorCountImproved,
    errorRateDelta,
    beforeLevel: String(beforeSummary?.level || 'unknown'),
    afterLevel: String(afterSummary?.level || 'unknown'),
    beforeRate,
    afterRate,
    beforeCount,
    afterCount,
  }
}

function ensureProfile(profileFile, profileName) {
  const all = readJson(profileFile)
  const defaultProfile = String(all?.defaultProfile || 'production')
  const name = String(profileName || defaultProfile)
  const profile = all?.profiles?.[name]
  if (!profile) {
    throw new Error(`Unknown profile: ${name}`)
  }
  return { name, profile }
}

function writeRunArtifact(payload) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = resolve(process.cwd(), 'tools', 'shadow-self-heal-runs', stamp)
  mkdirSync(dir, { recursive: true })
  const path = resolve(dir, 'run.json')
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return path
}

function main() {
  if (hasFlag('help')) {
    console.log(`
shadow-self-heal-orchestrator

Usage:
  node scripts/shadow-self-heal-orchestrator.mjs [--profile production] [--org-id <uuid>]

Options:
  --profile <name>     Profile name from data/shadow-self-heal-profiles.json (default: profile file default)
  --profile-file <p>   Override profile file path
  --org-id <uuid>      Optional org scope for shadow monitor
  --minutes <n>        Override monitor window minutes from profile
  --dry-run            Evaluate and simulate actions without running heal or upgrade commands
  --no-upgrade         Disable upgrade command execution
  --json               Print final run payload as JSON
  --help               Show this help
`)
    return
  }

  const profileFile = resolve(process.cwd(), getArg('profile-file', 'data/shadow-self-heal-profiles.json'))
  const profileName = getArg('profile', '')
  const orgId = String(getArg('org-id', '')).trim()
  const minutesOverride = Number(getArg('minutes', ''))
  const dryRunFlag = hasFlag('dry-run')
  const noUpgrade = hasFlag('no-upgrade')

  const { name, profile } = ensureProfile(profileFile, profileName)

  const minutes = Number.isFinite(minutesOverride) && minutesOverride > 0
    ? minutesOverride
    : Number(profile?.minutes || 30)

  const dryRun = dryRunFlag || Boolean(profile?.dryRun)
  const baseline = runMonitor({ minutes, orgId })
  const baselineLevel = String(baseline?.summary?.level || 'normal')

  const strategy = profile?.strategyByLevel?.[baselineLevel]
  const commandRuns = []

  const runPayload = {
    generatedAt: new Date().toISOString(),
    profile: name,
    orgId: orgId || null,
    minutes,
    baseline,
    strategyApplied: strategy?.name || null,
    dryRun,
    commandRuns,
    postHeal: null,
    theoryResult: null,
    upgrade: {
      enabled: Boolean(profile?.upgrade?.enabled) && !noUpgrade,
      attempted: false,
      success: false,
      command: String(profile?.upgrade?.command || ''),
      reason: '',
    },
  }

  if (!strategy || baselineLevel === 'normal') {
    runPayload.theoryResult = {
      ok: true,
      reason: 'no-heal-needed',
    }

    const out = writeRunArtifact(runPayload)
    if (hasFlag('json')) {
      console.log(JSON.stringify({ ...runPayload, runArtifact: out }, null, 2))
      return
    }

    console.log(`[shadow-self-heal] baseline_level=${baselineLevel}`)
    console.log('[shadow-self-heal] no remediation required')
    console.log(`[shadow-self-heal] run_artifact=${out}`)
    return
  }

  if (!dryRun) {
    for (const cmd of Array.isArray(strategy.commands) ? strategy.commands : []) {
      const result = runShell(String(cmd), true)
      commandRuns.push(result)
    }
  }

  const postHeal = runMonitor({ minutes, orgId })
  runPayload.postHeal = postHeal

  const theory = improvementReached(
    baseline?.summary || {},
    postHeal?.summary || {},
    Number(profile?.minImprovementRate || 0.05),
  )
  runPayload.theoryResult = theory

  const shouldUpgrade =
    runPayload.upgrade.enabled &&
    !dryRun &&
    theory.ok &&
    String(runPayload.upgrade.command || '').trim().length > 0

  if (shouldUpgrade) {
    runPayload.upgrade.attempted = true
    const upgradeResult = runShell(runPayload.upgrade.command, true)
    runPayload.upgrade.success = upgradeResult.ok
    runPayload.upgrade.reason = upgradeResult.ok
      ? 'upgrade executed after positive theory result'
      : upgradeResult.stderr
    commandRuns.push(upgradeResult)
  } else {
    runPayload.upgrade.reason = dryRun
      ? 'dry-run mode'
      : theory.ok
        ? 'upgrade disabled or no command configured'
        : 'theory did not improve enough'
  }

  const artifactPath = writeRunArtifact(runPayload)
  if (hasFlag('json')) {
    console.log(JSON.stringify({ ...runPayload, runArtifact: artifactPath }, null, 2))
    return
  }

  console.log(`[shadow-self-heal] baseline_level=${baselineLevel}`)
  console.log(`[shadow-self-heal] post_level=${postHeal?.summary?.level || 'unknown'}`)
  console.log(`[shadow-self-heal] theory_ok=${theory.ok}`)
  console.log(`[shadow-self-heal] upgrade_attempted=${runPayload.upgrade.attempted}`)
  console.log(`[shadow-self-heal] upgrade_success=${runPayload.upgrade.success}`)
  console.log(`[shadow-self-heal] run_artifact=${artifactPath}`)
}

main()
