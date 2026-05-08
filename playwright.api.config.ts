import { defineConfig } from '@playwright/test'
import { config as loadEnv } from 'dotenv'

// Load base env first, then local overrides for test runs.
loadEnv({ path: '.env' })
loadEnv({ path: '.env.local', override: true })
loadEnv({ path: '.env.playwright.local', override: true })

/**
 * Dedicated configuration for API-only Playwright tests.
 *
 * We intentionally avoid browser projects and local webServer startup here
 * because these tests call Supabase Edge Functions directly via HTTP.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
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
