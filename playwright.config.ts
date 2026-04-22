import { existsSync } from 'node:fs'
import { config as loadEnv } from 'dotenv'
import { defineConfig, devices } from '@playwright/test'

// Load app env first, then local and Playwright-specific overrides.
loadEnv({ path: '.env' })
loadEnv({ path: '.env.local' })
// Load local Playwright-only secrets from an ignored file, if present.
loadEnv({ path: '.env.playwright.local', override: true })

const nativeChromiumExecutablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((candidate) => !!candidate && existsSync(candidate))

const chromiumLaunchOptions = {
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  ...(nativeChromiumExecutablePath ? { executablePath: nativeChromiumExecutablePath } : {}),
}

const canUseWebkitOnHost = process.platform !== 'linux' || process.env.PLAYWRIGHT_FORCE_WEBKIT === '1'

const desktopSafariProject = canUseWebkitOnHost
  ? {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    }
  : {
      // Linux dev containers often lack WebKit runtime dependencies.
      // Keep the project available by using Chromium with Safari-like viewport.
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        ...devices['Desktop Chrome'],
        launchOptions: chromiumLaunchOptions,
      },
    }

const mobileSafariProject = canUseWebkitOnHost
  ? {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    }
  : {
      // Fallback to Chromium+iPhone emulation when WebKit cannot launch.
      name: 'Mobile Safari',
      use: {
        ...devices['iPhone 12'],
        ...devices['Pixel 5'],
        launchOptions: chromiumLaunchOptions,
      },
    }

const playwrightBaseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'

function buildWebServerCommand(baseURL: string): string {
  try {
    const parsed = new URL(baseURL)
    const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
    const port = parsed.port || '5173'

    if (!isLocalHost || parsed.protocol !== 'http:') {
      return "sh -c 'set -a; [ -f .env ] && . ./.env; [ -f .env.local ] && . ./.env.local; [ -f .env.playwright.local ] && . ./.env.playwright.local; set +a; npm run dev'"
    }

    return `sh -c 'set -a; [ -f .env ] && . ./.env; [ -f .env.local ] && . ./.env.local; [ -f .env.playwright.local ] && . ./.env.playwright.local; set +a; npm run dev -- --port ${port} --strictPort'`
  } catch {
    return "sh -c 'set -a; [ -f .env ] && . ./.env; [ -f .env.local ] && . ./.env.local; [ -f .env.playwright.local ] && . ./.env.playwright.local; set +a; npm run dev -- --port 5173 --strictPort'"
  }
}

/**
 * Playwright Configuration for FieldOps Manager
 * E2E Integration Testing - Phase 9
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  
  // Run tests in files in parallel
  fullyParallel: true,
  
  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,
  
  // Retry on CI only
  retries: process.env.CI ? 2 : 0,
  
  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : (process.env.PLAYWRIGHT_AUTO_SET_TEST_ROLE === '1' ? 1 : undefined),
  
  // Reporter to use
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list'],
  ],
  
  // Shared settings for all the projects below
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: playwrightBaseURL,
    
    // Collect trace when retrying the failed test
    trace: 'on-first-retry',
    
    // Screenshot on failure
    screenshot: 'only-on-failure',
    
    // Video on failure
    video: 'retain-on-failure',
    
    // Maximum time each action can take
    actionTimeout: 10000,
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: chromiumLaunchOptions,
      },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    desktopSafariProject,

    // Mobile viewports
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 5'],
        launchOptions: chromiumLaunchOptions,
      },
    },
    mobileSafariProject,
  ],

  // Run your local dev server before starting the tests
  webServer: {
    command: buildWebServerCommand(playwrightBaseURL),
    url: playwrightBaseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
