#!/usr/bin/env node

import { spawn } from 'node:child_process'
import process from 'node:process'

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      cwd: process.cwd(),
      env: {
        ...process.env,
        PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK: process.env.PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK || '1',
        PLAYWRIGHT_SKIP_ROLE_ASSERTIONS: process.env.PLAYWRIGHT_SKIP_ROLE_ASSERTIONS || '1',
        PLAYWRIGHT_REUSE_EXISTING_SERVER: process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER || '1',
      },
    })

    child.on('close', (code) => resolve(code ?? 1))
    child.on('error', () => resolve(1))
  })
}

async function main() {
  const bobAssist = 'node'
  const bobAssistScript = 'scripts/run-test-with-bob-assist.mjs'

  const opsRegex = [
    'CRM Module',
    'Specialised Portals',
    'Face Recognition',
    'Vehicle Management',
    'Bob Assistant',
    'bob assistant studio loads',
    'bob intake queue loads',
    'live plan reviews page loads',
    'bob ui review page loads',
    'identity verification page loads',
    'spatial compliance page loads',
    'Compliance Recalculation',
    'System Diagnostics',
    'Data Management',
    'admin data hub loads',
    'import data page loads',
    'intel approvals page loads',
    'compliance page loads',
    'CRM.*Business Management Crossover',
    'Client Portal Isolation',
  ].join('|')

  const opsExit = await run(bobAssist, [
    bobAssistScript,
    '--',
    'node',
    'scripts/run-human-module-suite.mjs',
    '--grep',
    opsRegex,
  ])

  if (opsExit !== 0) {
    process.exit(opsExit)
  }

  const routeRestoreExit = await run(bobAssist, [
    bobAssistScript,
    '--',
    'npx',
    'playwright',
    'test',
    'tests/e2e/route-restoration-smoke.spec.ts',
    '--project',
    'chromium',
  ])

  if (routeRestoreExit !== 0) {
    process.exit(routeRestoreExit)
  }

  const bobAnalysisExit = await run(bobAssist, [
    bobAssistScript,
    '--',
    'npx',
    'playwright',
    'test',
    'tests/e2e/tender-workspace.spec.ts',
    '--project',
    'chromium',
    '--grep',
    'Run Bob Analysis',
  ])

  if (bobAnalysisExit !== 0) {
    process.exit(bobAnalysisExit)
  }

  const hasInferenceAuth =
    Boolean(String(process.env.API_TEST_BEARER_TOKEN || '').trim()) ||
    (Boolean(String(process.env.API_TEST_EMAIL || '').trim()) &&
      Boolean(String(process.env.API_TEST_PASSWORD || '').trim()))

  if (!hasInferenceAuth) {
    console.log('[bob-assisted-core-suite] Skipping inference API check: missing API_TEST_BEARER_TOKEN or API_TEST_EMAIL/API_TEST_PASSWORD')
    process.exit(0)
  }

  const inferenceExit = await run(bobAssist, [
    bobAssistScript,
    '--',
    'npx',
    'playwright',
    'test',
    'tests/e2e/api-response.spec.ts',
    '--grep',
    'check-services-health returns a JSON response',
  ])

  process.exit(inferenceExit)
}

main().catch((error) => {
  console.error('[bob-assisted-core-suite] Unexpected error:', error?.message || error)
  process.exit(1)
})
