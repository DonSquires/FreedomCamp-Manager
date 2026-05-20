#!/usr/bin/env node

/**
 * E2E Escalation Processor
 *
 * Parses Playwright test results and creates escalation entries for Bob's
 * autonomous decision-making system. Escalations include:
 * - Manual-vs-actual discrepancies
 * - Test failures with diagnostic data
 * - Feature implementation recommendations
 * - Manual amendment suggestions
 */

import { execSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const DATA_DIR = resolve(ROOT, 'data')
const RESULTS_DIR = resolve(DATA_DIR, 'e2e-test-results')
const ESCALATION_QUEUE_PATH = resolve(DATA_DIR, 'dr-bob-escalation-queue.jsonl')
const ESCALATION_LATEST_PATH = resolve(DATA_DIR, 'dr-bob-escalation-latest.json')

// Command line arguments
function getArg(name, fallback = '') {
  const key = `--${name}`
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '')
    if (token === key) return argv[i + 1] || fallback
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1)
  }
  return fallback
}

function parseBool(value, fallback = false) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return fallback
  if (['1', 'true', 'yes', 'y', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(raw)) return false
  return fallback
}

// File I/O
function readJson(filePath, fallback = null) {
  try {
    if (!existsSync(filePath)) return fallback
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true })
}

function appendEscalation(entry) {
  ensureDir(DATA_DIR)
  appendFileSync(ESCALATION_QUEUE_PATH, `${JSON.stringify(entry)}\n`, 'utf8')
  writeFileSync(ESCALATION_LATEST_PATH, `${JSON.stringify(entry, null, 2)}\n`, 'utf8')
}

// Parse Playwright test results
function parsePlaywrightResults(filePath) {
  const raw = readJson(filePath, { suites: [], stats: {} })
  
  const stats = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
  }

  const failures = []
  const diagnostics = []

  if (!Array.isArray(raw.suites)) {
    return { stats, failures, diagnostics, raw }
  }

  function traverseSuites(suites) {
    for (const suite of suites) {
      if (Array.isArray(suite.tests)) {
        for (const test of suite.tests) {
          stats.total += 1

          if (test.status === 'passed') {
            stats.passed += 1
            diagnostics.push(`✓ ${test.title}`)
          } else if (test.status === 'failed') {
            stats.failed += 1
            failures.push({
              title: test.title,
              error: test.error?.message || 'Unknown error',
              trace: test.error?.stack || '',
            })
            diagnostics.push(`✗ ${test.title} - ${test.error?.message || 'Unknown error'}`)
          } else if (test.status === 'skipped') {
            stats.skipped += 1
            diagnostics.push(`⊘ ${test.title}`)
          }
        }
      }

      if (Array.isArray(suite.suites)) {
        traverseSuites(suite.suites)
      }
    }
  }

  traverseSuites(raw.suites)

  return { stats, failures, diagnostics, raw }
}

// Extract manual discrepancies from test failures
function analyzeManualDiscrepancies(failures, diagnostics) {
  const discrepancies = []

  // Check for specific manual section failures
  const manualSections = {
    '§ 2.1': 'Sign In - Email and password form, forgotten password flow',
    '§ 2.2': 'Session Lock & Inactivity - Automatic lock after inactivity period',
  }

  for (const diag of diagnostics) {
    for (const [section, description] of Object.entries(manualSections)) {
      if (diag.includes(section) && diag.startsWith('✗')) {
        discrepancies.push({
          section,
          description,
          issue: diag,
          recommendation: `Check if ${description} is implemented correctly`,
        })
      }
    }

    // Detect common missing features
    if (diag.includes('NOT found') || diag.includes('not appearing')) {
      discrepancies.push({
        type: 'missing-feature',
        issue: diag,
        recommendation: 'Feature may not be implemented; consider creating feature ticket',
      })
    }
  }

  return discrepancies
}

// Create escalation entry
function createEscalation(testPattern, stats, failures, discrepancies, diagnostics) {
  const hasFailures = stats.failed > 0
  const successRate = stats.total > 0 ? ((stats.passed / stats.total) * 100).toFixed(1) : '0'

  const escalation = {
    timestamp: new Date().toISOString(),
    sourceFile: 'e2e-escalation-processor.mjs',
    structured: true,
    testPattern,
    decision: hasFailures ? 'needs-manual-review' : 'no-action',
    reason: hasFailures ? 'e2e-test-failure' : 'e2e-passed',
    summary: hasFailures
      ? `E2E tests found ${stats.failed} failure(s) in ${testPattern}. Success rate: ${successRate}%`
      : `E2E tests passed. All ${stats.total} tests successful.`,
    findingsCount: failures.length,
    topFinding: failures.length > 0 ? failures[0].title : 'All tests passed',
    stats,
    failures: failures.slice(0, 5), // Top 5 failures
    discrepancies,
    diagnosticSummary: diagnostics.slice(0, 20), // Top 20 diagnostics
    testReport: `data/e2e-test-results/session-inactivity-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  }

  return escalation
}

// Generate escalation summary file
function generateSummary(escalation) {
  const md = [
    '# E2E Validation Report',
    '',
    `**Generated**: ${escalation.timestamp}`,
    `**Test Pattern**: ${escalation.testPattern}`,
    `**Status**: ${escalation.decision}`,
    '',
    '## Summary',
    `${escalation.summary}`,
    '',
    '## Test Results',
    `- **Total**: ${escalation.stats.total}`,
    `- **Passed**: ${escalation.stats.passed}`,
    `- **Failed**: ${escalation.stats.failed}`,
    `- **Skipped**: ${escalation.stats.skipped}`,
    '',
  ]

  if (escalation.failures.length > 0) {
    md.push('## Failures')
    md.push('')
    for (const failure of escalation.failures.slice(0, 10)) {
      md.push(`### ${failure.title}`)
      md.push(`\`\`\`\n${failure.error}\n\`\`\``)
      md.push('')
    }
  }

  if (escalation.discrepancies.length > 0) {
    md.push('## Manual Discrepancies')
    md.push('')
    for (const disc of escalation.discrepancies) {
      md.push(`- **${disc.section || disc.type}**: ${disc.issue}`)
      md.push(`  - Recommendation: ${disc.recommendation}`)
    }
    md.push('')
  }

  md.push('## Diagnostic Output')
  md.push('```')
  md.push(...escalation.diagnosticSummary)
  md.push('```')

  return md.join('\n')
}

// Main
function main() {
  ensureDir(RESULTS_DIR)

  const resultsFile = getArg('results-file', resolve(RESULTS_DIR, 'playwright-raw.json'))
  const reportToBob = parseBool(getArg('report-to-bob', 'true'))
  const autoAmendManual = parseBool(getArg('auto-amend-manual', 'false'))

  console.log('[E2E Escalation] Processing results from:', resultsFile)

  if (!existsSync(resultsFile)) {
    console.warn('[E2E Escalation] Results file not found; skipping escalation processing')
    return
  }

  // Parse results
  const { stats, failures, diagnostics, raw } = parsePlaywrightResults(resultsFile)

  console.log(`[E2E Escalation] Stats: ${stats.passed}/${stats.total} passed`)

  // Analyze manual discrepancies
  const discrepancies = analyzeManualDiscrepancies(failures, diagnostics)

  // Create escalation
  const testPattern = getArg('test-pattern', '*.spec.ts')
  const escalation = createEscalation(testPattern, stats, failures, discrepancies, diagnostics)

  // Save summary
  const summaryMd = generateSummary(escalation)
  writeFileSync(resolve(RESULTS_DIR, 'summary.md'), summaryMd, 'utf8')

  // Report to Bob (add to escalation queue)
  if (reportToBob && stats.failed > 0) {
    console.log('[E2E Escalation] Adding to escalation queue for Bob review')
    appendEscalation(escalation)

    // Save escalation file for workflow
    const escalationFile = resolve(DATA_DIR, `e2e-test-escalation-${testPattern.replace(/[*/?]/g, '')}.json`)
    writeFileSync(escalationFile, JSON.stringify(escalation, null, 2), 'utf8')

    console.log('[E2E Escalation] Escalation saved to:', escalationFile)
  }

  // Auto-amend manual if requested
  if (autoAmendManual && discrepancies.length > 0) {
    console.log('[E2E Escalation] Auto-amending INSTRUCTION_MANUAL.md for missing features')

    const manualPath = resolve(ROOT, 'docs', 'INSTRUCTION_MANUAL.md')
    if (existsSync(manualPath)) {
      let manual = readFileSync(manualPath, 'utf8')

      // Add notes about missing features
      const missingFeatures = discrepancies.filter((d) => d.type === 'missing-feature')
      if (missingFeatures.length > 0) {
        const note = [
          '',
          '## E2E Validation Notes',
          '',
          '**Last Updated by E2E Processor**: ' + new Date().toISOString(),
          '',
          '### Features in Development',
          ...missingFeatures.map((f) => `- ${f.issue}`),
        ].join('\n')

        if (!manual.includes('## E2E Validation Notes')) {
          manual += note
          writeFileSync(manualPath, manual, 'utf8')
          console.log('[E2E Escalation] Updated INSTRUCTION_MANUAL.md with feature notes')
        }
      }
    }
  }

  // Output report
  console.log('[E2E Escalation] Report:')
  console.log(summaryMd)
}

main()
