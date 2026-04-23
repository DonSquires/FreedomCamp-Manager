/**
 * Network Throttle Fixture — PTT Latency Emulation
 *
 * Implements the "PTT Latency Emulation" pattern:
 * Forces the Playwright browser to run under throttled network conditions
 * so we can discover latency-sensitive bugs that are invisible on fast
 * office Wi-Fi but surface on mobile/field connections.
 *
 * Usage:
 *   import { test } from '../fixtures/network-profile'
 *   test('PTT still works on Slow 3G', async ({ page, throttle }) => {
 *     await throttle('slow3g')
 *     await page.goto('/team-chat')
 *     ...
 *   })
 *
 * Profiles mirror Chrome DevTools presets so results are reproducible.
 */

import { test as base, type Page, type CDPSession } from '@playwright/test'

export type NetworkProfile = 'online' | 'fast4g' | 'slow4g' | 'slow3g' | 'edge' | 'offline'

/** Chrome DevTools Protocol network conditions per emulation profile */
const PROFILES: Record<NetworkProfile, {
  offline: boolean
  downloadThroughput: number   // bytes/s  (-1 = unlimited)
  uploadThroughput: number     // bytes/s  (-1 = unlimited)
  latency: number              // ms
}> = {
  online:  { offline: false, downloadThroughput: -1,              uploadThroughput: -1,              latency: 0   },
  fast4g:  { offline: false, downloadThroughput: 4 * 1024 * 1024, uploadThroughput: 3 * 1024 * 1024, latency: 20  },
  slow4g:  { offline: false, downloadThroughput: 1.5 * 1024 * 1024, uploadThroughput: 750 * 1024,    latency: 40  },
  slow3g:  { offline: false, downloadThroughput: 500 * 1024,      uploadThroughput: 500 * 1024,      latency: 400 },
  edge:    { offline: false, downloadThroughput: 240 * 1024,      uploadThroughput: 200 * 1024,      latency: 840 },
  offline: { offline: true,  downloadThroughput: 0,               uploadThroughput: 0,               latency: 0   },
}

export type ThrottleFn = (profile: NetworkProfile) => Promise<void>

interface NetworkFixtures {
  /** CDP session attached to the current page context */
  cdpSession: CDPSession
  /** Apply a named network throttle profile to the current page */
  throttle: ThrottleFn
}

/**
 * Extended test fixture that provides CDP-based network throttling.
 * Automatically resets to 'online' conditions after each test.
 */
export const test = base.extend<NetworkFixtures>({
  cdpSession: async ({ page }, use) => {
    const session = await page.context().newCDPSession(page)
    await use(session)
    // Restore full-speed networking after the test
    await session.send('Network.emulateNetworkConditions', PROFILES.online).catch(() => {
      // Session may already be closed if the page navigated away — safe to ignore
    })
    await session.detach().catch(() => {})
  },

  throttle: async ({ cdpSession }, use) => {
    const fn: ThrottleFn = async (profile) => {
      const conditions = PROFILES[profile]
      if (!conditions) throw new Error(`Unknown network profile "${profile}". Valid: ${Object.keys(PROFILES).join(', ')}`)
      await cdpSession.send('Network.enable', {})
      await cdpSession.send('Network.emulateNetworkConditions', conditions)
    }
    await use(fn)
  },
})

export { expect } from '@playwright/test'

/**
 * Helper: wrap a test block with a specific throttle profile and restore after.
 * Suitable for non-fixture usage from existing test files.
 *
 * @example
 *   test('PTT slow3g', withThrottle(async ({ page }) => { ... }, 'slow3g'))
 */
export async function applyNetworkThrottle(page: Page, profile: NetworkProfile): Promise<() => Promise<void>> {
  const session = await page.context().newCDPSession(page)
  await session.send('Network.enable', {})
  await session.send('Network.emulateNetworkConditions', PROFILES[profile])
  // Returns a cleanup/restore function
  return async () => {
    await session.send('Network.emulateNetworkConditions', PROFILES.online).catch(() => {})
    await session.detach().catch(() => {})
  }
}
