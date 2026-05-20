#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return ''
  return String(process.argv[index + 1] || '').trim()
}

function runVitest(testFile) {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const args = ['vitest', 'run', testFile]
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
  })

  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  }
}

function writeReport(reportPath, payload) {
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function main() {
  const runId = String(process.env.GITHUB_RUN_ID || 'local')
  const outputArg = argValue('--out')
  const outPath = resolve(
    ROOT,
    outputArg || `tools/llm-regression/${runId}/bob-llm-regression-report.json`,
  )

  const testFile = 'src/lib/__tests__/edgeFunctionsPolicy.test.ts'
  const startedAt = new Date().toISOString()
  const result = runVitest(testFile)
  const completedAt = new Date().toISOString()

  const report = {
    generatedAt: completedAt,
    startedAt,
    completedAt,
    suite: 'bob-llm-policy-regression',
    status: result.ok ? 'passed' : 'failed',
    tests: [
      {
        testFile,
        status: result.ok ? 'passed' : 'failed',
        exitCode: result.status,
      },
    ],
    notes: [
      'Covers emergency-priority block semantics and execution review payload shape via edgeFunctionsPolicy tests.',
      'Use this report as policy regression evidence for LLM governance changes.',
    ],
    stdoutTail: result.stdout.split('\n').slice(-60),
    stderrTail: result.stderr.split('\n').slice(-60),
  }

  writeReport(outPath, report)

  console.log(`[bob-llm-regression] Report: ${outPath}`)
  console.log(`[bob-llm-regression] Status: ${report.status}`)

  if (!result.ok) {
    process.stderr.write(result.stdout)
    process.stderr.write(result.stderr)
    process.exit(result.status || 1)
  }
}

main()