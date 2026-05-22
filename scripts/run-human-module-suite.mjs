#!/usr/bin/env node

import { spawn } from 'node:child_process'
import process from 'node:process'

function normalizeGrepArgs(args) {
  const normalized = [...args]

  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] !== '--grep') continue

    const value = normalized[index + 1]
    if (!value || !value.includes('›')) continue

    normalized[index + 1] = value
      .split('›')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('.*')
  }

  return normalized
}

function run(command, args) {
  const chromiumPathCandidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean)

  const chromiumExecutablePath = chromiumPathCandidates[0] || ''

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      env: {
        ...process.env,
        PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK: process.env.PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK || '1',
        PLAYWRIGHT_SKIP_ROLE_ASSERTIONS: process.env.PLAYWRIGHT_SKIP_ROLE_ASSERTIONS || '1',
        PLAYWRIGHT_REUSE_EXISTING_SERVER: process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER || '1',
        ...(chromiumExecutablePath ? { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: chromiumExecutablePath } : {}),
      },
      cwd: process.cwd(),
    })

    child.on('close', (code) => {
      resolve(code ?? 1)
    })

    child.on('error', () => {
      resolve(1)
    })
  })
}

async function main() {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const passthroughArgs = normalizeGrepArgs(process.argv.slice(2))
  const specs = [
    'tests/e2e/human-module-interaction.spec.ts',
    'tests/e2e/module-route-access.spec.ts',
    'tests/e2e/module-e2e-comprehensive.spec.ts',
    'tests/e2e/ui-comprehensive.spec.ts',
    'tests/e2e/crm-business-crossover.spec.ts',
    'tests/e2e/client-portal-isolation.spec.ts',
  ]

  const args = [
    'playwright',
    'test',
    ...specs,
    '--project', 'chromium',
    '--project', 'Mobile Chrome',
    ...passthroughArgs,
  ]

  const exitCode = await run(command, args)
  process.exit(exitCode)
}

main().catch(() => process.exit(1))
