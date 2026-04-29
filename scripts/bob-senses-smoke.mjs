#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

function parseArgs(argv) {
  const args = {
    mode: 'auto', // off|mock|auto|strict
    outDir: 'tools/bob-release-gates/manual',
    required: 'screen',
    timeoutMs: 12000,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const t = String(argv[i] || '')
    if (t === '--help') args.help = true
    else if (t === '--mode') args.mode = String(argv[i + 1] || args.mode)
    else if (t.startsWith('--mode=')) args.mode = t.slice('--mode='.length)
    else if (t === '--out-dir') args.outDir = String(argv[i + 1] || args.outDir)
    else if (t.startsWith('--out-dir=')) args.outDir = t.slice('--out-dir='.length)
    else if (t === '--required') args.required = String(argv[i + 1] || args.required)
    else if (t.startsWith('--required=')) args.required = t.slice('--required='.length)
    else if (t === '--timeout-ms') {
      const n = Number.parseInt(String(argv[i + 1] || ''), 10)
      if (Number.isFinite(n)) args.timeoutMs = n
    } else if (t.startsWith('--timeout-ms=')) {
      const n = Number.parseInt(t.slice('--timeout-ms='.length), 10)
      if (Number.isFinite(n)) args.timeoutMs = n
    }
  }

  args.mode = String(args.mode || 'auto').trim().toLowerCase()
  const valid = new Set(['off', 'mock', 'auto', 'strict'])
  if (!valid.has(args.mode)) throw new Error(`Invalid --mode value: ${args.mode}`)

  args.requiredList = String(args.required || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)

  return args
}

function nowIso() {
  return new Date().toISOString()
}

async function runShell(command, timeoutMs) {
  return await new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      env: process.env,
      stdio: 'pipe',
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch {}
    }, timeoutMs)

    child.stdout.on('data', (buf) => {
      stdout += buf.toString()
    })

    child.stderr.on('data', (buf) => {
      stderr += buf.toString()
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code ?? 1, stdout, stderr, timedOut })
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${String(error?.message || error)}`, timedOut })
    })
  })
}

async function checkModality({ name, mode, cmd, timeoutMs }) {
  if (mode === 'mock') {
    return {
      name,
      status: 'pass',
      detail: 'mock simulation pass',
      command: cmd || '',
    }
  }

  if (!cmd) {
    return {
      name,
      status: 'not-configured',
      detail: 'no command configured',
      command: '',
    }
  }

  const result = await runShell(cmd, timeoutMs)
  if (result.timedOut) {
    return {
      name,
      status: 'fail',
      detail: `command timed out after ${timeoutMs}ms`,
      command: cmd,
      output: (result.stdout + result.stderr).slice(-400),
    }
  }

  return {
    name,
    status: result.exitCode === 0 ? 'pass' : 'fail',
    detail: `command exit=${result.exitCode}`,
    command: cmd,
    output: (result.stdout + result.stderr).slice(-400),
  }
}

function summarize(report) {
  const counts = { pass: 0, fail: 0, 'not-configured': 0, skipped: 0 }
  for (const t of report.tests) counts[t.status] = (counts[t.status] || 0) + 1

  const byName = Object.fromEntries(report.tests.map((t) => [t.name, t.status]))

  let pass = true
  if (report.mode === 'strict') {
    pass = report.tests.every((t) => t.status === 'pass')
  } else if (report.mode === 'auto') {
    for (const required of report.required) {
      if (byName[required] !== 'pass') pass = false
    }
    if (report.required.length === 0) {
      pass = report.tests.some((t) => t.status === 'pass')
    }
  } else if (report.mode === 'mock') {
    pass = true
  }

  return { counts, pass }
}

function toMd(report) {
  const lines = [
    '# Bob Senses Smoke Report',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Mode: ${report.mode}`,
    `- Final Decision: ${report.finalDecision.toUpperCase()}`,
    '',
    '## Tests',
    '',
    ...report.tests.map((t) => `- ${t.name}: ${String(t.status).toUpperCase()} (${t.detail})`),
    '',
    '## Summary',
    '',
    `- Pass: ${report.summary.counts.pass}`,
    `- Fail: ${report.summary.counts.fail}`,
    `- Not configured: ${report.summary.counts['not-configured']}`,
    `- Skipped: ${report.summary.counts.skipped}`,
    '',
  ]
  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log('Bob Senses Smoke\n\nUsage:\n  node scripts/bob-senses-smoke.mjs --mode auto|mock|strict --out-dir tools/bob-release-gates/<run-id> [--required screen,camera,audio]\n\nCommands can be provided via env vars:\n  BOB_SCREEN_CAPTURE_CMD\n  BOB_CAMERA_SNAPSHOT_CMD\n  BOB_STT_CHECK_CMD\n')
    process.exit(0)
  }

  if (args.mode === 'off') {
    console.log('Senses smoke mode is off; nothing to run.')
    process.exit(0)
  }

  const outDir = path.resolve(args.outDir)
  await fs.mkdir(outDir, { recursive: true })

  const tests = []
  const screenCmd = String(process.env.BOB_SCREEN_CAPTURE_CMD || '').trim()
  const cameraCmd = String(process.env.BOB_CAMERA_SNAPSHOT_CMD || '').trim()
  const audioCmd = String(process.env.BOB_STT_CHECK_CMD || '').trim()

  tests.push(await checkModality({ name: 'screen', mode: args.mode, cmd: screenCmd, timeoutMs: args.timeoutMs }))
  tests.push(await checkModality({ name: 'camera', mode: args.mode, cmd: cameraCmd, timeoutMs: args.timeoutMs }))
  tests.push(await checkModality({ name: 'audio', mode: args.mode, cmd: audioCmd, timeoutMs: args.timeoutMs }))

  const report = {
    generatedAt: nowIso(),
    mode: args.mode,
    required: args.requiredList,
    tests,
    summary: null,
    finalDecision: 'fail',
  }

  report.summary = summarize({ mode: args.mode, tests: report.tests, required: args.requiredList })
  report.finalDecision = report.summary.pass ? 'pass' : 'fail'

  const jsonPath = path.join(outDir, 'senses-report.json')
  const mdPath = path.join(outDir, 'senses-report.md')

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(mdPath, `${toMd(report)}\n`, 'utf8')

  console.log(`Senses report JSON: ${jsonPath}`)
  console.log(`Senses report MD: ${mdPath}`)
  console.log(`Senses final decision: ${report.finalDecision.toUpperCase()}`)

  if (report.finalDecision !== 'pass') process.exit(1)
}

main().catch((error) => {
  console.error('[bob-senses-smoke] fatal:', error?.message || error)
  process.exit(1)
})
