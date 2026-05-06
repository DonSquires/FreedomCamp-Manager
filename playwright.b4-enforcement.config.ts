import { defineConfig } from '@playwright/test'
import { config as loadEnv } from 'dotenv'

// Load base env first, then local overrides for test runs.
loadEnv({ path: '.env' })
loadEnv({ path: '.env.local', override: true })
loadEnv({ path: '.env.playwright.local', override: true })

/**
 * Dedicated configuration for the Phase B4 Enforcement Timeline gate tests.
 *
 * Mirrors playwright.api.config.ts (API-only, no browser projects, no webServer)
 * but restricts testMatch to the B4 enforcement spec so that the gate job can
 * discover and run it independently of the api-response suite.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'phase-b4-enforcement-timeline.spec.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30000,
  use: {
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'api',
    },
  ],
})
