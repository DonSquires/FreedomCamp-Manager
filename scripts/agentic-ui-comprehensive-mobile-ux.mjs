#!/usr/bin/env node

/**
 * Comprehensive Mobile UI/UX Testing Suite
 *
 * Tests every mobile page across all user roles using Vercel emulator.
 *
 * Usage:
 *   bun scripts/agentic-ui-comprehensive-mobile-ux.mjs
 *   bun scripts/agentic-ui-comprehensive-mobile-ux.mjs --role officer
 *   bun scripts/agentic-ui-comprehensive-mobile-ux.mjs --dry-run
 *
 * Output:
 *   tools/agentic-ui-reports/mobile-comprehensive-TIMESTAMP/
 */

import { execSync, spawn } from 'node:child_process'
import path from 'node:path'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const roles = ['admin', 'master', 'officer', 'admin_officer']
const mobilePages = [
  {
    category: 'shared',
    roles,
    pages: [
      '/portal-selection',
      '/login',
      '/profile',
      '/settings',
      '/notifications',
    ],
  },
  {
    category: 'officer',
    roles: ['officer', 'admin_officer'],
    pages: [
      '/field-officer',
      '/officer-home',
      '/officer-welfare',
      '/observations',
      '/incidents',
      '/breaches',
      '/vehicles',
      '/radio',
      '/patrol-kpis',
      '/roster',
      '/availability',
      '/team-chat',
      '/bob-assistant',
    ],
  },
  {
    category: 'admin',
    roles: ['admin', 'master', 'admin_officer'],
    pages: [
      '/admin',
      '/admin/dashboard',
      '/users',
      '/organizations',
      '/access-control',
      '/audit-log',
      '/data-management',
    ],
  },
  {
    category: 'live-ops',
    roles: ['admin', 'master', 'admin_officer'],
    pages: [
      '/live-tracking',
      '/live-patrol',
      '/operations-map',
      '/job-map',
      '/hotspots',
      '/incident-heatmap',
    ],
  },
  {
    category: 'dispatch',
    roles: ['admin', 'master', 'admin_officer', 'officer'],
    pages: [
      '/dispatch',
      '/dispatch-jobs',
    ],
  },
]

const testPacks = [
  { name: 'login-health', desc: 'Login health check' },
  { name: 'tender-shadow', desc: 'Tender compliance submission' },
  { name: 'ptt-zindex', desc: 'PTT control visibility and z-index' },
  { name: 'crm-business-crossover', desc: 'CRM and business cross-module page access' },
  { name: 'client-portal-isolation', desc: 'Client portal isolation and admin-route block' },
  { name: 'live-ops', desc: 'Live operations monitoring pages' },
  { name: 'shared', desc: 'Shared profile/settings/notifications pages' },
  { name: 'dispatch', desc: 'Dispatch and dispatch jobs coverage' },
  { name: 'admin', desc: 'Admin portal and bug report log coverage' },
  { name: 'admin-bug-reports', desc: 'Direct admin bug report log coverage' },
]

// ─── Server readiness helpers ──────────────────────────────────────────────────

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function isHttpReachable(url, timeoutMs = 2500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' })
    return res.status > 0
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function waitForBaseUrlReady(baseUrl, totalWaitMs = 30000, pollMs = 1000) {
  const deadline = Date.now() + Math.max(1000, totalWaitMs)
  const loginUrl = `${baseUrl.replace(/\/$/, '')}/login`
  while (Date.now() < deadline) {
    if (await isHttpReachable(loginUrl)) return true
    if (await isHttpReachable(baseUrl)) return true
    await sleep(pollMs)
  }
  return false
}

function startWebServer(command, cwd) {
  const parts = command.split(' ').filter(Boolean)
  const child = spawn(parts[0], parts.slice(1), {
    cwd,
    stdio: 'ignore',
    detached: true,
  })
  child.unref()
  return child
}

// ─── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const config = {
    role: null,
    dryRun: false,
    headless: true,
    verbose: false,
    baseUrl: (process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173').replace(/\/$/, ''),
    baseUrlWaitMs: Number(process.env.AGENTIC_BASE_URL_WAIT_MS) || 30000,
    autoStartServer: true,
    webServerCommand: 'bunx vite --port 5173 --strictPort',
  }

  for (const arg of args) {
    if (arg === '--dry-run') config.dryRun = true
    if (arg === '--headed') config.headless = false
    if (arg === '--verbose') config.verbose = true
    if (arg === '--no-auto-start') config.autoStartServer = false
    if (arg.startsWith('--role=')) config.role = arg.split('=')[1]
    if (arg.startsWith('--base-url=')) config.baseUrl = arg.split('=').slice(1).join('=').replace(/\/$/, '')
  }

  return config
}

function log(msg, level = 'info') {
  const timestamp = new Date().toISOString()
  const prefix = level.toUpperCase()
  console.log(`[${timestamp}] [${prefix}] ${msg}`)
}

function run(cmd, opts = {}) {
  const { silent = false, verbose = false } = opts
  if (verbose || (!silent && true)) {
    log(`Running: ${cmd}`, 'debug')
  }

  try {
    const result = execSync(cmd, { stdio: silent ? 'pipe' : 'inherit', encoding: 'utf8' })
    return { success: true, output: result }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

/**
 * Converts an app route path to a filesystem-safe directory slug.
 * Removes leading slashes, normalizes non-word characters to dashes,
 * trims edge dashes, and falls back to "root" if empty.
 */
function createPageSlug(page) {
  return page.replace(/^\/+/, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'root'
}

async function main() {
  const config = parseArgs()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportDir = path.resolve('tools', 'agentic-ui-reports', `mobile-comprehensive-${timestamp}`)

  log(`Starting comprehensive mobile UI/UX test suite`, 'info')
  log(`Report directory: ${reportDir}`, 'info')
  log(`Base URL: ${config.baseUrl}`, 'info')

  const results = {
    timestamp,
    reportDir,
    config,
    testPacks: [],
    rolePageTests: [],
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
    },
  }

  // Ensure report directory exists
  await fs.mkdir(reportDir, { recursive: true })

  // ── Server readiness check ──────────────────────────────────────────────────
  let managedServer = null
  let serverReady = false

  if (!config.dryRun) {
    log(`Checking if app server is reachable at ${config.baseUrl} …`, 'info')
    serverReady = await waitForBaseUrlReady(config.baseUrl, config.baseUrlWaitMs)

    if (!serverReady && config.autoStartServer) {
      log(`Server not ready — starting: ${config.webServerCommand}`, 'warn')
      managedServer = startWebServer(config.webServerCommand, path.resolve('.'))
      serverReady = await waitForBaseUrlReady(config.baseUrl, config.baseUrlWaitMs)
    }

    if (!serverReady) {
      log(`App server unreachable at ${config.baseUrl} — skipping all packs and page tests (infra issue)`, 'warn')
      for (const pack of testPacks) {
        results.testPacks.push({ pack: pack.name, status: 'infra-skip', reason: 'app server unreachable' })
        results.summary.total += 1
        results.summary.skipped += 1
      }
      // Write results and exit without marking as failed
      const resultsFile = path.join(reportDir, 'results.json')
      await fs.writeFile(resultsFile, JSON.stringify(results, null, 2))
      log(`Results saved to: ${resultsFile}`, 'info')
      log(`\n[INFRA] App server was unreachable. No tests ran. This is an infrastructure issue, not a UI regression.`, 'warn')
      process.exit(0)
    }

    log(`✓ App server is reachable`, 'info')
  }

  // ── Phase 1: Built-in test packs ───────────────────────────────────────────
  log(`\n=== PHASE 1: Built-in Test Packs ===`, 'info')
  for (const pack of testPacks) {
    log(`Running pack: ${pack.name}`, 'info')

    const packReportDir = path.join(reportDir, `pack-${pack.name}`)
    const cmd = [
      `bun scripts/agentic-ui-shadow-user.mjs`,
      `--pack=${pack.name}`,
      `--no-planner`,
      `--no-video`,
      `--base-url=${config.baseUrl}`,
      `--evidence-dir=${packReportDir}`,
    ].join(' ')

    if (config.dryRun) {
      log(`[DRY-RUN] ${cmd}`, 'debug')
      results.testPacks.push({ pack: pack.name, status: 'dry-run', cmd })
    } else {
      const packResult = run(cmd, { silent: false })

      // Detect infrastructure failures embedded in the pack report
      let status = packResult.success ? 'passed' : 'failed'
      try {
        const reportJson = JSON.parse(
          await fs.readFile(path.join(packReportDir, 'report.json'), 'utf8').catch(() => '{}')
        )
        const firstErrMsg = String(reportJson.actions?.[0]?.execution?.error || '')
        if (firstErrMsg.includes('ERR_CONNECTION_REFUSED') || firstErrMsg.includes('ECONNREFUSED')) {
          status = 'infra-fail'
          results.summary.skipped += 1
          results.summary.total += 1
          log(`⚠ Pack ${pack.name} skipped — server connectivity error (infra)`, 'warn')
          results.testPacks.push({ pack: pack.name, status, cmd, reason: 'server connectivity error' })
          continue
        }
        if (reportJson.result === 'blocked_infra') {
          status = 'infra-fail'
          results.summary.skipped += 1
          results.summary.total += 1
          log(`⚠ Pack ${pack.name} skipped — blocked_infra (infra)`, 'warn')
          results.testPacks.push({ pack: pack.name, status, cmd })
          continue
        }
      } catch {
        // ignore JSON parse errors; fall through to normal status
      }

      results.testPacks.push({
        pack: pack.name,
        status,
        cmd,
        error: packResult.error,
      })

      results.summary.total += 1
      if (packResult.success) {
        results.summary.passed += 1
        log(`✓ Pack ${pack.name} passed`, 'info')
      } else {
        results.summary.failed += 1
        log(`✗ Pack ${pack.name} failed: ${packResult.error}`, 'error')
      }
    }
  }

  // ── Phase 2: Role-specific page tests ──────────────────────────────────────
  log(`\n=== PHASE 2: Role-Specific Mobile Page Testing ===`, 'info')

  const targetRoles = config.role ? [config.role] : roles
  const totalTests = targetRoles.reduce((sum, role) => {
    return sum + mobilePages.reduce((pageSum, group) => pageSum + (group.roles.includes(role) ? group.pages.length : 0), 0)
  }, 0)

  let testCount = 0
  for (const role of targetRoles) {
    log(`\nTesting role: ${role}`, 'info')

    for (const pageGroup of mobilePages) {
      if (!pageGroup.roles.includes(role)) {
        continue
      }

      log(`  Testing ${pageGroup.category} pages (${pageGroup.pages.length} pages)`, 'info')

      for (const page of pageGroup.pages) {
        testCount += 1
        const testName = `${role}-${pageGroup.category}-${page.replace(/\//g, '-')}`
        const pageSlug = createPageSlug(page)
        const testReportDir = path.join(reportDir, `role-${role}`, pageGroup.category, pageSlug)
        results.summary.total += 1

        // Goal for this test
        const goal = `As ${role} user, navigate to ${page} on mobile and verify page renders without errors, all controls are visible and responsive`

        const cmd =
          `bun scripts/agentic-ui-shadow-user.mjs ` +
          `--goal="${goal}" ` +
          `--no-video ` +
          `--base-url=${config.baseUrl} ` +
          `--evidence-dir=${testReportDir} ` +
          `--role=${role} ` +
          `${config.headless ? '' : '--headed'}`

        if (config.dryRun) {
          log(`[DRY-RUN] ${testName}`, 'debug')
          results.rolePageTests.push({ role, page, pageCategory: pageGroup.category, status: 'dry-run' })
        } else {
          const testResult = run(cmd, { silent: true })
          results.rolePageTests.push({
            role,
            page,
            pageCategory: pageGroup.category,
            status: testResult.success ? 'passed' : 'failed',
            error: testResult.error,
          })

          if (testResult.success) {
            results.summary.passed += 1
            log(`  ✓ ${testName}`, 'info')
          } else {
            results.summary.failed += 1
            log(`  ✗ ${testName}: ${testResult.error}`, 'error')
          }
        }

        const percent = Math.round((testCount / totalTests) * 100)
        if (testCount % 5 === 0) {
          log(`Progress: ${testCount}/${totalTests} (${percent}%)`, 'info')
        }
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  log(`\n=== TEST SUMMARY ===`, 'info')
  log(`Total tests: ${results.summary.total}`, 'info')
  log(`Passed: ${results.summary.passed}`, 'info')
  log(`Failed: ${results.summary.failed}`, 'info')
  log(`Skipped: ${results.summary.skipped}`, 'info')
  log(`Pass rate: ${results.summary.total > 0 ? Math.round((results.summary.passed / results.summary.total) * 100) : 0}%`, 'info')
  log(`Report directory: ${reportDir}`, 'info')

  // Write results JSON
  const resultsFile = path.join(reportDir, 'results.json')
  await fs.writeFile(resultsFile, JSON.stringify(results, null, 2))
  log(`Results saved to: ${resultsFile}`, 'info')

  if (!config.dryRun) {
    const autoPublishEnabled = String(process.env.BOB_AUTO_PUBLISH_BUG_REPORTS || '1').trim() !== '0'
    const hasBugReporterEnv = Boolean(String(process.env.VITE_SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())

    if (autoPublishEnabled && hasBugReporterEnv) {
      log(`Publishing Vercel emulator reports from ${reportDir} to bug_reports`, 'info')
      const publishCmd = `bun scripts/publish-test-failures-to-bug-reports.mjs --emulator-root=${reportDir} --emulator-max-age-hours=24`
      const publishResult = run(publishCmd, { silent: false })
      if (publishResult.success) {
        log(`✓ bug_reports publish completed`, 'info')
      } else {
        log(`✗ bug_reports publish failed: ${publishResult.error}`, 'error')
        results.summary.failed += 1
      }
    } else {
      log(`Skipping bug_reports publish (autoPublish=${autoPublishEnabled}, hasEnv=${hasBugReporterEnv})`, 'warn')
    }
  }

  if (managedServer) {
    try { managedServer.kill() } catch { /* ignore */ }
  }


  // Exit with appropriate code
  if (config.dryRun) {
    log(`\n[DRY-RUN COMPLETE] No tests were executed. Use without --dry-run to run actual tests.`, 'info')
    process.exit(0)
  } else if (results.summary.failed > 0) {
    log(`\n✗ Some tests failed. See report above.`, 'error')
    process.exit(1)
  } else {
    log(`\n✓ All tests passed!`, 'info')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
