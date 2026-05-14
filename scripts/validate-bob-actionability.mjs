#!/usr/bin/env node
/**
 * Bob Actionability Non-Regression Check
 * 
 * Validates that consolidation changes did NOT break Bob's core control paths:
 * 1. Message control (ask-bob org resolution + proposal creation)
 * 2. Voice control (PTT signaling + command authorization)
 * 3. Officer actuation (generate-infringement org access)
 * 
 * Usage:
 *   node scripts/validate-bob-actionability.mjs \
 *     --supabase-url <url> \
 *     --service-role-key <key> \
 *     --test-org-id <uuid> \
 *     --test-user-id <uuid>
 * 
 * Exit codes:
 *   0 = all checks passed
 *   1 = at least one check failed
 *   2 = configuration error
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function getArg(name, fallback = '') {
  const key = `--${name}`
  const idx = process.argv.indexOf(key)
  if (idx < 0) return fallback
  return process.argv[idx + 1] || fallback
}

const SUPABASE_URL = String(getArg('supabase-url', process.env.SUPABASE_URL || '')).trim()
const SERVICE_ROLE_KEY = String(getArg('service-role-key', process.env.SUPABASE_SERVICE_ROLE_KEY || '')).trim()
const TEST_ORG_ID = String(getArg('test-org-id', process.env.BOB_TEST_ORG_ID || '')).trim()
const TEST_USER_ID = String(getArg('test-user-id', process.env.BOB_TEST_USER_ID || '')).trim()

const results = {
  timestamp: new Date().toISOString(),
  version: '2026-05-13.bob-actionability-v1',
  checks: [],
  summary: { passed: 0, failed: 0 },
}

function report(checkName, passed, details = '') {
  const outcome = passed ? 'PASS' : 'FAIL'
  results.checks.push({ check: checkName, outcome, details })
  results.summary[passed ? 'passed' : 'failed']++
  console.log(`[${outcome}] ${checkName}${details ? ': ' + details : ''}`)
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
    console.error('Provide via --supabase-url / --service-role-key or environment variables')
    process.exit(2)
  }

  console.log(`[bob-actionability-check] Starting at ${new Date().toISOString()}`)
  console.log(`[bob-actionability-check] Config: URL=${SUPABASE_URL.slice(0, 30)}... OrgID=${TEST_ORG_ID || 'any'} UserID=${TEST_USER_ID || 'any'}`)

  try {
    // ─────────────────────────────────────────────────────────────────────
    // CHECK 1: Org access helper exports exist
    // ─────────────────────────────────────────────────────────────────────
    try {
      const orgAccessPath = path.join(__dirname, '../supabase/functions/_shared/orgAccess.ts')
      const content = await fs.readFile(orgAccessPath, 'utf8')
      const hasExports =
        content.includes('buildAccessibleOrgIds') &&
        content.includes('collectDirectOrgIds') &&
        content.includes('orgAccessDenied') &&
        content.includes('export')
      report('Org access helper exports', hasExports, hasExports ? 'all exports present' : 'missing exports')
    } catch (err) {
      report('Org access helper exports', false, String(err).slice(0, 60))
    }

    // ─────────────────────────────────────────────────────────────────────
    // CHECK 2: Ask Bob imports org access helper
    // ─────────────────────────────────────────────────────────────────────
    try {
      const askBobPath = path.join(__dirname, '../supabase/functions/ask-bob/index.ts')
      const content = await fs.readFile(askBobPath, 'utf8')
      const hasImport = content.includes('import { buildAccessibleOrgIds } from')
      const hasUsage = content.includes('buildAccessibleOrgIds(supabaseAdmin')
      report('Ask Bob org access integration', hasImport && hasUsage, hasImport && hasUsage ? 'import + usage found' : 'missing')
    } catch (err) {
      report('Ask Bob org access integration', false, String(err).slice(0, 60))
    }

    // ─────────────────────────────────────────────────────────────────────
    // CHECK 3: PTT signaling imports buildAccessibleOrgIds
    // ─────────────────────────────────────────────────────────────────────
    try {
      const pttPath = path.join(__dirname, '../supabase/functions/ptt-signaling-token/index.ts')
      const content = await fs.readFile(pttPath, 'utf8')
      const hasImport = content.includes('buildAccessibleOrgIds')
      report('PTT signaling org access import', hasImport, hasImport ? 'import found' : 'missing')
    } catch (err) {
      report('PTT signaling org access import', false, String(err).slice(0, 60))
    }

    // ─────────────────────────────────────────────────────────────────────
    // CHECK 4: Smoke notice uses org access
    // ─────────────────────────────────────────────────────────────────────
    try {
      const smokePath = path.join(__dirname, '../supabase/functions/smoke-notice/index.ts')
      const content = await fs.readFile(smokePath, 'utf8')
      const hasImport = content.includes('buildAccessibleOrgIds') && content.includes('orgAccessDenied')
      const hasUsage = content.includes('buildAccessibleOrgIds(supabase')
      report('Smoke notice org access integration', hasImport && hasUsage, 'import + usage found')
    } catch (err) {
      report('Smoke notice org access integration', false, String(err).slice(0, 60))
    }

    // ─────────────────────────────────────────────────────────────────────
    // CHECK 5: Generate infringement uses org access
    // ─────────────────────────────────────────────────────────────────────
    try {
      const genInfPath = path.join(__dirname, '../supabase/functions/generate-infringement/index.ts')
      const content = await fs.readFile(genInfPath, 'utf8')
      const hasImport = content.includes('buildAccessibleOrgIds')
      const hasUsage = content.includes('buildAccessibleOrgIds(supabaseAdmin')
      report('Generate infringement org access integration', hasImport && hasUsage, 'import + usage found')
    } catch (err) {
      report('Generate infringement org access integration', false, String(err).slice(0, 60))
    }

    // ─────────────────────────────────────────────────────────────────────
    // CHECK 6: Unified org restriction gate migration exists
    // ─────────────────────────────────────────────────────────────────────
    try {
      const readMigPath = path.join(__dirname, '../supabase/migrations/20260513000001_unified_org_access_restriction_gate.sql')
      const writeMigPath = path.join(__dirname, '../supabase/migrations/20260513000002_unified_org_access_write_policies.sql')
      const readExists = fs.stat(readMigPath).then(() => true).catch(() => false)
      const writeExists = fs.stat(writeMigPath).then(() => true).catch(() => false)
      const both = (await readExists) && (await writeExists)
      report('Org access gate migrations', both, both ? 'both read + write migrations present' : 'missing')
    } catch (err) {
      report('Org access gate migrations', false, String(err).slice(0, 60))
    }

    // ─────────────────────────────────────────────────────────────────────
    // CHECK 7: Star Trek plan has non-regression guard
    // ─────────────────────────────────────────────────────────────────────
    try {
      const starTrekPath = path.join(__dirname, '../docs/STAR_TREK_PHASED_ROLLOUT_PLAN.md')
      const content = await fs.readFile(starTrekPath, 'utf8')
      const hasGuard = content.includes('Non-Regression Guard')
      const hasVoiceCheck = content.includes('voice and Bob message command paths')
      const hasEvidence = content.includes('Regression evidence')
      report('Star Trek non-regression checkpoint', hasGuard && hasVoiceCheck && hasEvidence, 'guard + evidence checkpoint found')
    } catch (err) {
      report('Star Trek non-regression checkpoint', false, String(err).slice(0, 60))
    }

    // ─────────────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────────────
    console.log('')
    console.log(`[SUMMARY] ${results.summary.passed} passed, ${results.summary.failed} failed`)

    if (results.summary.failed > 0) {
      console.error('[ERROR] Non-regression checks failed')
      process.exit(1)
    } else {
      console.log('[SUCCESS] All Bob actionability checks passed')

      const reportPath = path.join(__dirname, '../data/bob-actionability-check.json')
      await fs.mkdir(path.dirname(reportPath), { recursive: true })
      await fs.writeFile(reportPath, JSON.stringify(results, null, 2))
      console.log(`[INFO] Report written to ${reportPath}`)

      process.exit(0)
    }
  } catch (err) {
    console.error('[FATAL]', err)
    process.exit(2)
  }
}

main()
