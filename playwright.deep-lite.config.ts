import { defineConfig, devices } from '@playwright/test'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env' })
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env.playwright.local' })

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium'
const ignoreHTTPSErrors = process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS !== '0'
const launchOptions = {
  executablePath,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
}

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  // Deep functional browser projects are integration-heavy and can have
  // occasional transient timing/network variance in CI.
  retries: process.env.CI ? 2 : 0,
  timeout: 90000,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || process.env.DEFAULT_PLAYWRIGHT_BASE_URL || 'https://fcmanager.co.nz',
    ignoreHTTPSErrors,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    launchOptions,
  },
  projects: [
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions,
      },
    },
    {
      name: 'Mobile Safari',
      use: {
        ...devices['Pixel 5'],
        launchOptions,
      },
    },
  ],
})
