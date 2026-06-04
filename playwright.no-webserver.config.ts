import { existsSync } from 'node:fs'
import { config as loadEnv } from 'dotenv'
import { defineConfig, devices } from '@playwright/test'

loadEnv({ path: '.env' })
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env.playwright.local' })

const chromiumExecutablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((candidate) => !!candidate && existsSync(candidate))

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.DEFAULT_PLAYWRIGHT_BASE_URL ||
  'http://localhost:5173'

export default defineConfig({
  testDir: './tests',
  testMatch: ['e2e/**/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    ignoreHTTPSErrors: process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS !== '0',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
          ...(chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {}),
        },
      },
    },
  ],
})
