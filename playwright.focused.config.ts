/**
 * playwright.focused.config.ts
 *
 * Runs only the tests that are:
 *   (a) highest-risk during the UI/UX rebuild (nav, deep-functional, tender, ui-comprehensive), or
 *   (b) known to catch real regressions quickly.
 *
 * Skipped (run separately / already green):
 *   - api-response.spec.ts           → use test:api
 *   - multi-org-rls.spec.ts          → backend-only, slow, not UI-sensitive
 *   - org-isolation-api.spec.ts      → backend-only
 *   - ptt-*.spec.ts                  → PTT infra tests, not nav-sensitive
 *   - nzscv-integration.spec.ts      → external proxy dependency
 *   - motorweb-integration.spec.ts   → external proxy dependency
 *   - offline-queue.spec.ts          → service-worker scope
 *   - realtime-updates.spec.ts       → Supabase realtime infra
 *   - pwa-features.spec.ts           → PWA/service-worker scope
 *   - production-readiness-audit.spec.ts → slow meta audit
 *   - asset-management-scan.spec.ts  → scan hardware dependency
 *
 * Run with: bun run test:focused
 */

import { existsSync } from 'node:fs'
import { config as loadEnv } from 'dotenv'
import { defineConfig, devices } from '@playwright/test'

loadEnv({ path: '.env' })
loadEnv({ path: '.env.local', override: true })
loadEnv({ path: '.env.playwright.local', override: true })

const chromiumPath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((c) => !!c && existsSync(c))

const launchOptions = {
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
}

const baseURL =
  process.env.PLAYWRIGHT_FOCUSED_BASE_URL ||
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.DEFAULT_PLAYWRIGHT_BASE_URL ||
  'http://localhost:4173'

const ignoreHTTPSErrors = process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS !== '0'

export default defineConfig({
  testDir: './tests/e2e',

  // Only the specs that matter for nav/UX rebuild validation and recent regression risk.
  testMatch: [
    'deep-functional.spec.ts',
    'ui-comprehensive.spec.ts',
    'tender-workspace.spec.ts',
    'role-matrix-smoke.spec.ts',
    'module-route-access.spec.ts',
    'route-restoration-smoke.spec.ts',
    'enforcement-route-restoration-smoke.spec.ts',
    'officer-portal-walkthrough.spec.ts',
    'capability-overview.spec.ts',
  ],

  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90000,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/focused', open: 'never' }],
  ],

  use: {
    baseURL,
    ignoreHTTPSErrors,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15000,
    launchOptions,
  },

  // Single Chromium project — fast, no cross-browser overhead.
  // Cross-browser is handled by the deep-functional cross-browser workflow on CI.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions,
      },
    },
  ],
})
