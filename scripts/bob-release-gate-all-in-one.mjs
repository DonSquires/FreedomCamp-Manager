#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runDrBobReview } from './dr-bob-review.mjs'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function parseArgs(argv) {
  const args = {
    outRoot: 'tools/bob-release-gates',
    autonomousCmd: 'node scripts/bob-inject-training.mjs --autonomous',
    humanCmd: 'node scripts/human-test-engine.mjs',
    sensesCmd: 'node scripts/bob-senses-smoke.mjs',
    sensesMode: 'off',
    skipSenses: false,
    humanReportRoot: 'tools/human-test-engine/reports',
    drBobFiles: ['plan.md', 'spec.md'],
    minHumanReadiness: 85,
    sensesTimeoutMs: 900000,
    skipAutonomous: false,
    skipDrBob: false,
    skipHuman: false,
    drBobFailOnRevision: true,
    dryRun: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const t = String(argv[i] || '')
    if (t === '--help') args.help = true
    else if (t === '--dry-run') args.dryRun = true
    else if (t === '--skip-autonomous') args.skipAutonomous = true
    else if (t === '--skip-dr-bob') args.skipDrBob = true
    else if (t === '--skip-human') args.skipHuman = true
    else if (t === '--skip-senses') args.skipSenses = true
    else if (t === '--out') args.outRoot = String(argv[i + 1] || args.outRoot)
    else if (t.startsWith('--out=')) args.outRoot = t.slice('--out='.length)
    else if (t === '--autonomous-cmd') args.autonomousCmd = String(argv[i + 1] || args.autonomousCmd)
    else if (t.startsWith('--autonomous-cmd=')) args.autonomousCmd = t.slice('--autonomous-cmd='.length)
    else if (t === '--human-cmd') args.humanCmd = String(argv[i + 1] || args.humanCmd)
    else if (t.startsWith('--human-cmd=')) args.humanCmd = t.slice('--human-cmd='.length)
    else if (t === '--senses-cmd') args.sensesCmd = String(argv[i + 1] || args.sensesCmd)
    else if (t.startsWith('--senses-cmd=')) args.sensesCmd = t.slice('--senses-cmd='.length)
    else if (t === '--senses-mode') args.sensesMode = String(argv[i + 1] || args.sensesMode)
    else if (t.startsWith('--senses-mode=')) args.sensesMode = t.slice('--senses-mode='.length)
    else if (t === '--human-report-root') args.humanReportRoot = String(argv[i + 1] || args.humanReportRoot)
    else if (t.startsWith('--human-report-root=')) args.humanReportRoot = t.slice('--human-report-root='.length)
    else if (t === '--dr-bob-files') {
      const raw = String(argv[i + 1] || '')
      args.drBobFiles = raw.split(',').map((x) => x.trim()).filter(Boolean)
    } else if (t.startsWith('--dr-bob-files=')) {
      const raw = t.slice('--dr-bob-files='.length)
      args.drBobFiles = raw.split(',').map((x) => x.trim()).filter(Boolean)
    } else if (t === '--min-human-readiness') {
      const n = Number.parseInt(String(argv[i + 1] || ''), 10)
      if (Number.isFinite(n)) args.minHumanReadiness = n
    } else if (t.startsWith('--min-human-readiness=')) {
      const n = Number.parseInt(t.slice('--min-human-readiness='.length), 10)
      if (Number.isFinite(n)) args.minHumanReadiness = n
    } else if (t === '--senses-timeout-ms') {
      const n = Number.parseInt(String(argv[i + 1] || ''), 10)
      if (Number.isFinite(n) && n > 0) args.sensesTimeoutMs = n
    } else if (t.startsWith('--senses-timeout-ms=')) {
      const n = Number.parseInt(t.slice('--senses-timeout-ms='.length), 10)
      if (Number.isFinite(n) && n > 0) args.sensesTimeoutMs = n
    } else if (t === '--dr-bob-fail-on-revision') {
      args.drBobFailOnRevision = String(argv[i + 1] || 'true').trim().toLowerCase() !== 'false'
    } else if (t.startsWith('--dr-bob-fail-on-revision=')) {
      args.drBobFailOnRevision = t.slice('--dr-bob-fail-on-revision='.length).trim().toLowerCase() !== 'false'
    }
  }

  return args
}

async function runShell(command, cwd, timeoutMs = 0) {
  return await new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: 'inherit',
    })

    let timedOut = false
    let timeoutId = null
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, timeoutMs)
    }

    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId)
      resolve({ exitCode: timedOut ? 124 : code ?? 1, timedOut })
    })

    child.on('error', () => {
      if (timeoutId) clearTimeout(timeoutId)
      resolve({ exitCode: 1, timedOut: false })
    })
  })
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function findLatestReportDir(root) {
  const rootPath = path.resolve(root)
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => [])
  const dirs = []

  for (const e of entries) {
    if (!e.isDirectory()) continue
    const p = path.join(rootPath, e.name)
    const s = await fs.stat(p).catch(() => null)
    if (s) dirs.push({ path: p, mtimeMs: s.mtimeMs })
  }

  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return dirs[0]?.path || ''
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

function toMd(scorecard) {
  const lines = [
    '# Bob All-in-One Release Gate Scorecard',
    '',
    `- Run ID: ${scorecard.runId}`,
    `- Started: ${scorecard.startedAt}`,
    `- Ended: ${scorecard.endedAt}`,
    `- Final Decision: ${scorecard.finalDecision.toUpperCase()}`,
    '',
    '## Stage Results',
    '',
    `- Autonomous Profile: ${scorecard.stages.autonomous.status.toUpperCase()} (${scorecard.stages.autonomous.detail})`,
    `- Dr Bob Review: ${scorecard.stages.drBob.status.toUpperCase()} (${scorecard.stages.drBob.detail})`,
    `- Human Test: ${scorecard.stages.human.status.toUpperCase()} (${scorecard.stages.human.detail})`,
    `- Senses Smoke: ${scorecard.stages.senses.status.toUpperCase()} (${scorecard.stages.senses.detail})`,
    '',
    '## Notes',
    '',
    ...scorecard.notes.map((n) => `- ${n}`),
    '',
  ]
  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log('Bob All-in-One Release Gate\n\nUsage:\n  node scripts/bob-release-gate-all-in-one.mjs [--out tools/bob-release-gates] [--dr-bob-files plan.md,spec.md] [--min-human-readiness 85] [--senses-mode off|mock|auto|strict] [--senses-timeout-ms 900000] [--dry-run]\n\nGates:\n  1) Autonomous profile load pass\n  2) Dr Bob review pass for required artifacts\n  3) Human-test engine pass with minimum readiness\n  4) Optional senses smoke pass with artifact output\n')
    process.exit(0)
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(scriptDir, '..')
  const runId = nowStamp()
  const outDir = path.resolve(args.outRoot, runId)
  await fs.mkdir(outDir, { recursive: true })

  const scorecard = {
    runId,
    startedAt: new Date().toISOString(),
    endedAt: null,
    config: {
      minHumanReadiness: args.minHumanReadiness,
      sensesTimeoutMs: args.sensesTimeoutMs,
      drBobFiles: args.drBobFiles,
      drBobFailOnRevision: args.drBobFailOnRevision,
      sensesMode: args.sensesMode,
      dryRun: args.dryRun,
    },
    stages: {
      autonomous: { status: 'skipped', detail: 'not executed' },
      drBob: { status: 'skipped', detail: 'not executed', results: [] },
      human: { status: 'skipped', detail: 'not executed', reportPath: '', readiness: null },
      senses: { status: 'skipped', detail: 'not executed', reportPath: '' },
    },
    finalDecision: 'fail',
    notes: [],
  }

  if (!args.skipAutonomous) {
    if (args.dryRun) {
      scorecard.stages.autonomous = { status: 'pass', detail: 'dry-run: simulated pass' }
    } else {
      const r = await runShell(args.autonomousCmd, repoRoot)
      scorecard.stages.autonomous = {
        status: r.exitCode === 0 ? 'pass' : 'fail',
        detail: `command exit=${r.exitCode}`,
      }
    }
  }

  if (!args.skipDrBob) {
    if (args.dryRun) {
      scorecard.stages.drBob = {
        status: 'pass',
        detail: 'dry-run: simulated pass',
        results: args.drBobFiles.map((f) => ({ file: f, decision: 'approve', shouldFail: false })),
      }
    } else {
      const results = []
      let allPass = true

      for (const file of args.drBobFiles) {
        const absolute = path.resolve(repoRoot, file)
        if (!(await exists(absolute))) {
          results.push({ file, decision: 'missing', shouldFail: true })
          allPass = false
          continue
        }

        try {
          const review = await runDrBobReview({
            file,
            failOnRevision: args.drBobFailOnRevision,
            strictJson: true,
            maxAttempts: 3,
            selfHealBasic: false,
          })
          const passed = review.shouldFail !== true
          if (!passed) allPass = false
          results.push({
            file,
            decision: review.review?.decision || 'unknown',
            shouldFail: review.shouldFail === true,
            structured: review.structured === true,
            reviewArtifact: review.outputPath,
            escalationArtifact: review.escalationPath || null,
          })
        } catch (error) {
          allPass = false
          results.push({ file, decision: 'error', shouldFail: true, error: String(error?.message || error) })
        }
      }

      scorecard.stages.drBob = {
        status: allPass ? 'pass' : 'fail',
        detail: allPass ? 'all required artifacts passed Dr Bob review' : 'one or more artifacts failed Dr Bob review',
        results,
      }
    }
  }

  if (!args.skipHuman) {
    if (args.dryRun) {
      scorecard.stages.human = {
        status: 'pass',
        detail: `dry-run: simulated pass (readiness ${args.minHumanReadiness}%)`,
        reportPath: '',
        readiness: args.minHumanReadiness,
      }
    } else {
      const r = await runShell(args.humanCmd, repoRoot)
      const latestDir = await findLatestReportDir(args.humanReportRoot)
      const reportPath = latestDir ? path.join(latestDir, 'report.json') : ''

      let readiness = null
      let failCount = null
      if (reportPath && (await exists(reportPath))) {
        const report = await readJson(reportPath)
        readiness = Number(report?.score?.operationalReadiness ?? 0)
        failCount = Number(report?.score?.totals?.fail ?? 0)
      }

      const passes = r.exitCode === 0 && failCount === 0 && readiness != null && readiness >= args.minHumanReadiness
      scorecard.stages.human = {
        status: passes ? 'pass' : 'fail',
        detail: `command exit=${r.exitCode}, readiness=${readiness ?? 'n/a'}%, failCount=${failCount ?? 'n/a'}`,
        reportPath,
        readiness,
      }
    }
  }

  if (!args.skipSenses && String(args.sensesMode || 'off').toLowerCase() !== 'off') {
    if (args.dryRun) {
      scorecard.stages.senses = {
        status: 'pass',
        detail: `dry-run: simulated pass (mode ${args.sensesMode})`,
        reportPath: path.join(outDir, 'senses-report.json'),
      }
    } else {
      const required = String(args.sensesMode).toLowerCase() === 'strict' ? 'screen,camera,audio' : 'screen'
      const command = `${args.sensesCmd} --mode ${args.sensesMode} --required ${required} --out-dir "${outDir}"`
      const r = await runShell(command, repoRoot, args.sensesTimeoutMs)
      const reportPath = path.join(outDir, 'senses-report.json')
      let decision = 'fail'
      if (await exists(reportPath)) {
        const report = await readJson(reportPath)
        decision = String(report?.finalDecision || 'fail').toLowerCase()
      }

      const passes = r.exitCode === 0 && decision === 'pass'
      scorecard.stages.senses = {
        status: passes ? 'pass' : 'fail',
        detail: `command exit=${r.exitCode}, decision=${decision}, mode=${args.sensesMode}, timeoutMs=${args.sensesTimeoutMs}, timedOut=${r.timedOut === true}`,
        reportPath,
      }
    }
  }

  const allStages = [scorecard.stages.autonomous, scorecard.stages.drBob, scorecard.stages.human, scorecard.stages.senses]
    .filter((s) => s.status !== 'skipped')
  const hasFailure = allStages.some((s) => s.status !== 'pass')

  if (scorecard.stages.autonomous.status !== 'pass') {
    scorecard.notes.push('Autonomous profile gate failed. Ensure --autonomous training injection succeeds.')
  }
  if (scorecard.stages.drBob.status !== 'pass') {
    scorecard.notes.push('Dr Bob gate failed. Resolve blockers or needs-revision findings before release.')
  }
  if (scorecard.stages.human.status !== 'pass') {
    scorecard.notes.push('Human-test gate failed. Address failing flows or increase readiness via fixes, not threshold relaxation.')
  }
  if (scorecard.stages.senses.status !== 'pass' && scorecard.stages.senses.status !== 'skipped') {
    scorecard.notes.push('Senses gate failed. Check senses-report.json and fix hardware/tool wiring or switch senses mode.')
  }

  scorecard.finalDecision = hasFailure ? 'fail' : 'pass'
  scorecard.endedAt = new Date().toISOString()

  const jsonPath = path.join(outDir, 'scorecard.json')
  const mdPath = path.join(outDir, 'scorecard.md')
  await fs.writeFile(jsonPath, `${JSON.stringify(scorecard, null, 2)}\n`, 'utf8')
  await fs.writeFile(mdPath, `${toMd(scorecard)}\n`, 'utf8')

  console.log(`\nAll-in-one gate complete.`)
  console.log(`Scorecard JSON: ${jsonPath}`)
  console.log(`Scorecard MD: ${mdPath}`)
  console.log(`Final decision: ${scorecard.finalDecision.toUpperCase()}`)

  if (scorecard.finalDecision !== 'pass') {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('[bob-release-gate-all-in-one] fatal:', error?.message || error)
  process.exit(1)
})
