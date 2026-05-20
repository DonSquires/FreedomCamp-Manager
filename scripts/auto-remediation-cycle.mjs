#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const OUT_DIR = resolve(ROOT, 'tools/auto-remediation')
const APPLY_DEP_FIXES = hasArg('--apply-dependency-fixes') || process.env.APPLY_DEP_FIXES === 'true'

function hasArg(name) {
  return process.argv.includes(name)
}

function quoteShell(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

function commandExists(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function runCommand(command, options = {}) {
  const { allowFailure = false, captureStdout = false } = options
  try {
    const stdout = execSync(command, {
      cwd: ROOT,
      stdio: captureStdout ? ['ignore', 'pipe', 'pipe'] : 'pipe',
      encoding: 'utf8',
    })
    return { ok: true, stdout: captureStdout ? String(stdout || '') : '', error: '' }
  } catch (error) {
    const stderr = String(error?.stderr || '')
    const stdout = String(error?.stdout || '')
    if (!allowFailure) {
      throw new Error(`${command}\n${stderr || stdout || String(error?.message || '')}`)
    }
    return { ok: false, stdout, error: stderr || String(error?.message || 'command failed') }
  }
}

function writeTextFile(filePath, text) {
  writeFileSync(filePath, `${text.endsWith('\n') ? text : `${text}\n`}`, 'utf8')
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  const tools = {
    npm: commandExists('npm'),
    npx: commandExists('npx'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    applyDependencyFixes: APPLY_DEP_FIXES,
    tools,
    steps: [],
    changedFiles: [],
    notes: [],
  }

  function step(name, command, options = {}) {
    const startedAt = new Date().toISOString()
    const result = runCommand(command, options)
    const finishedAt = new Date().toISOString()
    const rec = {
      name,
      command,
      startedAt,
      finishedAt,
      ok: result.ok,
      error: result.error,
    }
    summary.steps.push(rec)
    return rec
  }

  if (tools.npm) {
    step('install', 'npm ci', { allowFailure: true })
  } else {
    summary.notes.push('No package manager detected for dependency install.')
  }

  if (tools.npx) {
    step('eslint-fix', `npx eslint . --fix --format json --output-file ${quoteShell(resolve(OUT_DIR, 'eslint-report.json'))}`, { allowFailure: true })
  } else {
    summary.notes.push('No eslint runner available (npx missing).')
  }

  if (tools.npm) {
    step('npm-audit', `npm audit --json > ${quoteShell(resolve(OUT_DIR, 'npm-audit.json'))}`, { allowFailure: true })
    step('npm-outdated', `npm outdated --json > ${quoteShell(resolve(OUT_DIR, 'npm-outdated.json'))}`, { allowFailure: true })
    if (APPLY_DEP_FIXES && existsSync(resolve(ROOT, 'package-lock.json'))) {
      step('npm-audit-fix', 'npm audit fix', { allowFailure: true })
    }
  }

  const changed = runCommand('git status --porcelain', { allowFailure: true, captureStdout: true })
  const changedFiles = String(changed.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3))
  summary.changedFiles = changedFiles

  // --- Build validation gate (emulation check before PR is created) ---
  // Run tsc + vite build to confirm the autofix didn't introduce type errors or build failures.
  // Failures are recorded but do NOT abort the script — the PR body will flag the regression.
  const buildResult = step('build-validate', 'npm run build', { allowFailure: true })
  if (!buildResult.ok) {
    summary.notes.push('BUILD VALIDATION FAILED after autofix. Review build-validate step before merging the remediation PR.')
  } else {
    summary.notes.push('Build validation passed — remediation changes do not break the production bundle.')
  }

  writeTextFile(resolve(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2))

  const buildOk = summary.steps.find((s) => s.name === 'build-validate')?.ok ?? null
  const buildBadge = buildOk === true ? '✅ passed' : buildOk === false ? '❌ FAILED — do not merge without review' : '⚠️ not run'

  const markdown = [
    '# Automated Remediation Report',
    '',
    `Generated: ${summary.generatedAt}`,
    `Dependency auto-fix enabled: ${summary.applyDependencyFixes}`,
    `Build validation: ${buildBadge}`,
    '',
    '## Steps',
    '',
    '| Step | Result | Command |',
    '|---|---|---|',
    ...summary.steps.map((s) => `| ${s.name} | ${s.ok ? 'ok' : 'warning'} | ${s.command.replace(/\|/g, '\\|')} |`),
    '',
    '## Changed Files',
    '',
    ...(summary.changedFiles.length > 0 ? summary.changedFiles.map((f) => `- ${f}`) : ['- none']),
    '',
    '## Notes',
    '',
    ...(summary.notes.length > 0 ? summary.notes.map((n) => `- ${n}`) : ['- none']),
    '',
    '## Artifacts',
    '',
    '- tools/auto-remediation/summary.json',
    '- tools/auto-remediation/eslint-report.json (if produced)',
    '- tools/auto-remediation/npm-audit.json (if produced)',
    '- tools/auto-remediation/npm-audit.json (if produced)',
  ]

  writeTextFile(resolve(OUT_DIR, 'summary.md'), markdown.join('\n'))

  console.log(`auto_remediation_report=${resolve(OUT_DIR, 'summary.md')}`)
  console.log(`changed_files=${summary.changedFiles.length}`)
}

main()
