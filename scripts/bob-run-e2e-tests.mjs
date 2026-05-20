#!/usr/bin/env node

/**
 * Bob Autonomous E2E Test Runner
 * 
 * Purpose: Run E2E tests in background and report findings to escalation queue
 * 
 * Usage:
 *   node scripts/bob-run-e2e-tests.mjs [--test-pattern <pattern>] [--report-to-bob] [--timeout <ms>]
 * 
 * Examples:
 *   node scripts/bob-run-e2e-tests.mjs --test-pattern session-inactivity
 *   node scripts/bob-run-e2e-tests.mjs --report-to-bob --timeout 600000
 * 
 * Integration with Bob:
 *   - Bob calls this script periodically or on-demand
 *   - Script generates JSON report under data/e2e-test-results/
 *   - Bob reads results and adds to escalation queue if manual amendments needed
 *   - Results feed into self-healing safety scorecard
 */

import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const ROOT = process.cwd()
const RESULTS_DIR = resolve(ROOT, 'data/e2e-test-results')
const TEST_PATTERN = getArg('test-pattern', 'session-inactivity')
const REPORT_TO_BOB = getBoolArg('report-to-bob', true)
const TIMEOUT_MS = getNumArg('timeout', 600000) // 10 minutes default
const TEST_FILE = `tests/e2e/${TEST_PATTERN}.spec.ts`

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

function getBoolArg(name, fallback = false) {
  const val = getArg(name, String(fallback))
  return val === 'true' || val === '1' || val === 'yes'
}

function getNumArg(name, fallback = 0) {
  const val = getArg(name, String(fallback))
  const num = Number(val)
  return Number.isFinite(num) ? num : fallback
}

function runCommand(cmd, options = {}) {
  console.log(`[BOB] Running: ${cmd}`)
  try {
    const result = execSync(cmd, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: TIMEOUT_MS,
      ...options,
    })
    return { success: true, output: result }
  } catch (error) {
    return {
      success: false,
      output: String(error?.message || error),
      code: error?.status || 1,
    }
  }
}

function parsePlaywrightOutput(output) {
  /**
   * Parse Playwright test output to extract:
   * - Number of passed/failed/skipped tests
   * - Console logs from tests (for diagnostic output)
   * - Any error messages
   */
  
  const lines = String(output).split('\n')
  const result = {
    totalTests: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    diagnostics: [],
    errors: [],
  }
  
  for (const line of lines) {
    if (line.includes('✓') || line.includes('PASSED')) result.passed += 1
    if (line.includes('✗') || line.includes('FAILED')) result.failed += 1
    if (line.includes('⊘') || line.includes('SKIPPED')) result.skipped += 1
    if (line.includes('✓') || line.includes('✗') || line.includes('⊘')) {
      result.totalTests += 1
    }
    
    // Capture diagnostic output (console.log from tests)
    if (line.includes('✓') || line.includes('⚠')) {
      result.diagnostics.push(line.trim())
    }
    
    // Capture errors
    if (line.includes('Error') || line.includes('FAILED')) {
      result.errors.push(line.trim())
    }
  }
  
  return result
}

function main() {
  console.log(`[BOB] Starting E2E test runner`)
  console.log(`[BOB] Test file: ${TEST_FILE}`)
  console.log(`[BOB] Results directory: ${RESULTS_DIR}`)
  
  // Create results directory
  mkdirSync(RESULTS_DIR, { recursive: true })
  
  // Check test file exists
  if (!existsSync(TEST_FILE)) {
    console.error(`[BOB] ✗ Test file not found: ${TEST_FILE}`)
    process.exit(1)
  }
  
  console.log(`[BOB] ✓ Test file found`)
  
  // Run Playwright tests with detailed reporting
  const testCommand = `npx playwright test ${TEST_FILE} --reporter=json --reporter=list`
  const runResult = runCommand(testCommand)
  
  if (!runResult.success) {
    console.error(`[BOB] ✗ Test execution failed:`)
    console.error(runResult.output)
  }
  
  // Parse results
  const parsed = parsePlaywrightOutput(runResult.output)
  
  // Build report
  const report = {
    testRunId: randomUUID(),
    timestamp: new Date().toISOString(),
    testFile: TEST_FILE,
    testPattern: TEST_PATTERN,
    status: runResult.success ? 'completed' : 'failed',
    summary: {
      total: parsed.totalTests,
      passed: parsed.passed,
      failed: parsed.failed,
      skipped: parsed.skipped,
      successRate: parsed.totalTests > 0 ? ((parsed.passed / parsed.totalTests) * 100).toFixed(1) + '%' : 'N/A',
    },
    diagnostics: parsed.diagnostics.slice(0, 20), // First 20 diagnostic messages
    errors: parsed.errors.slice(0, 10),              // First 10 errors
    rawOutput: runResult.output.slice(0, 5000),      // First 5KB of output
  }
  
  // Write report to disk
  const reportPath = resolve(RESULTS_DIR, `${TEST_PATTERN}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`[BOB] ✓ Report written to: ${reportPath}`)
  
  // Print summary
  console.log(`\n[BOB] TEST SUMMARY:`)
  console.log(`  Total: ${report.summary.total}`)
  console.log(`  Passed: ${report.summary.passed}`)
  console.log(`  Failed: ${report.summary.failed}`)
  console.log(`  Skipped: ${report.summary.skipped}`)
  console.log(`  Success Rate: ${report.summary.successRate}`)
  
  // If report-to-bob flag is set, prepare escalation payload
  if (REPORT_TO_BOB && report.summary.failed > 0) {
    console.log(`\n[BOB] Generating escalation for manual review...`)
    
    const escalationPayload = {
      timestamp: new Date().toISOString(),
      source: 'bob-e2e-test-runner',
      testPattern: TEST_PATTERN,
      finding: `E2E tests failed: ${report.summary.failed}/${report.summary.total} tests`,
      severity: report.summary.failed > 3 ? 'critical' : 'high',
      recommendation: `Review test output at ${reportPath} and amend INSTRUCTION_MANUAL.md if actual behavior differs from documented specs`,
      testResults: report,
    }
    
    // Write escalation payload
    const escalationPath = resolve(ROOT, `data/e2e-test-escalation-${TEST_PATTERN}.json`)
    writeFileSync(escalationPath, JSON.stringify(escalationPayload, null, 2))
    console.log(`[BOB] ✓ Escalation payload prepared at: ${escalationPath}`)
  }
  
  // Exit with appropriate code
  process.exit(runResult.success ? 0 : 1)
}

main()
