import { defineConfig } from '@playwright/test'

/**
 * Dedicated configuration for API-only Playwright tests.
 *
 * We intentionally avoid browser projects and local webServer startup here
 * because these tests call Supabase Edge Functions directly via HTTP.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'api-response.spec.ts',
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
