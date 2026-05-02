#!/usr/bin/env node

import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_BUDGET_PATH = 'tools/budgets/eslint-warning-budget.json'

function parseArgs(argv) {
  const args = {
    budget: DEFAULT_BUDGET_PATH,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]

    if (token.startsWith('--budget=')) {
      args.budget = token.split('=')[1] || args.budget
      continue
    }

    if (token === '--budget') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args.budget = next
        i += 1
      }
    }
  }

  return args
}

function runEslintJson() {
  const command = 'eslint . -f json'

  try {
    return execSync(command, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    })
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`
    if (!output) {
      throw new Error(`eslint execution failed: ${error.message}`)
    }
    return output
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const budgetPath = path.resolve(process.cwd(), args.budget)

  const budgetRaw = await fs.readFile(budgetPath, 'utf8')
  const budget = JSON.parse(budgetRaw)
  const maxWarnings = Number(budget.maxWarnings)

  if (!Number.isFinite(maxWarnings) || maxWarnings < 0) {
    throw new Error(`Invalid maxWarnings in ${args.budget}`)
  }

  const eslintRaw = runEslintJson()
  const report = JSON.parse(eslintRaw)

  const totals = report.reduce(
    (acc, file) => {
      acc.errors += Number(file.errorCount || 0)
      acc.warnings += Number(file.warningCount || 0)
      return acc
    },
    { errors: 0, warnings: 0 },
  )

  console.log(`[eslint-warning-budget] maxWarnings=${maxWarnings}`)
  console.log(`[eslint-warning-budget] currentWarnings=${totals.warnings}`)
  console.log(`[eslint-warning-budget] currentErrors=${totals.errors}`)

  if (totals.errors > 0) {
    console.error('[eslint-warning-budget] FAIL: eslint reported errors.')
    process.exit(1)
  }

  if (totals.warnings > maxWarnings) {
    console.error(`[eslint-warning-budget] FAIL: warning budget exceeded (${totals.warnings} > ${maxWarnings}).`)
    process.exit(1)
  }

  console.log('[eslint-warning-budget] PASS')
}

main().catch((error) => {
  console.error(`[eslint-warning-budget] ${error.message}`)
  process.exit(1)
})
