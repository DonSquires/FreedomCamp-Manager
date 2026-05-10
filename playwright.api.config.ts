import { defineConfig } from '@playwright/test'
import { config as loadEnv } from 'dotenv'

// Load base env first, then local overrides for test runs.
loadEnv({ path: '.env' })
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env.playwright.local' })

/**
 * Dedicated configuration for API-only Playwright tests.
 *
 * We intentionally avoid browser projects and local webServer startup here
 * because these tests call Supabase Edge Functions directly via HTTP.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Keep API mode constrained to API-focused specs and avoid browser/UI suites.
  testMatch: ['**/*api*.spec.ts'],
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
