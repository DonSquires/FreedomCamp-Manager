/**
 * Bob Mock Fixture — Edge Function Response Stubs
 *
 * Provides a Playwright fixture that intercepts all Bob-related Supabase
 * Edge Function requests and returns deterministic stub responses.
 *
 * Usage:
 *   import { test } from '../fixtures/bob-mock'
 *   test('Bob responds with grounded text', async ({ page, mockBob }) => {
 *     await mockBob({ text: 'Patrol complete at Eastbourne Reserve.' })
 *     await page.goto('/bob-assistant')
 *     ...
 *   })
 */

import { test as base, type Page, type Route } from '@playwright/test'

export interface BobMockOptions {
  /** Text content to return in the streaming response body */
  text?: string
  /** Override the HTTP status code (default 200) */
  status?: number
  /** Extra JSON fields merged into the `choices[0].delta` payload */
  extra?: Record<string, unknown>
}

const DEFAULT_RESPONSE_TEXT =
  'Acknowledged. Patrol logged at the requested zone. No active breaches detected.'

function buildStreamChunk(text: string, extra: Record<string, unknown> = {}): string {
  const payload = {
    id: 'mock-bob-chunk',
    object: 'chat.completion.chunk',
    choices: [
      {
        delta: { role: 'assistant', content: text, ...extra },
        index: 0,
        finish_reason: null,
      },
    ],
  }
  return `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`
}

interface BobMockFixtures {
  /**
   * Intercepts onspace-ai-chat, ask-bob, and grandmaster-studio edge function
   * routes and fulfils them with a controlled stub response.
   */
  mockBob: (opts?: BobMockOptions) => Promise<void>
}

/**
 * Extended test fixture with Bob edge-function mocking.
 * Routes are automatically restored after each test.
 */
export const test = base.extend<BobMockFixtures>({
  mockBob: async ({ page }, use) => {
    const registeredRoutes: string[] = []

    const applyMock = async (opts: BobMockOptions = {}) => {
      const text = opts.text ?? DEFAULT_RESPONSE_TEXT
      const status = opts.status ?? 200
      const extra = opts.extra ?? {}

      const bobRoutePatterns = [
        '**/functions/v1/onspace-ai-chat',
        '**/functions/v1/ask-bob',
        '**/functions/v1/grandmaster-studio',
      ]

      for (const pattern of bobRoutePatterns) {
        registeredRoutes.push(pattern)
        await page.route(pattern, (route: Route) => {
          route.fulfill({
            status,
            contentType: 'text/event-stream; charset=utf-8',
            headers: {
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'Access-Control-Allow-Origin': '*',
            },
            body: buildStreamChunk(text, extra),
          })
        })
      }
    }

    await use(applyMock)

    // Clean up: unroute all interceptors after the test
    for (const pattern of registeredRoutes) {
      await page.unroute(pattern).catch(() => {
        // Page may have been closed — safe to ignore
      })
    }
  },
})

export { expect } from '@playwright/test'
