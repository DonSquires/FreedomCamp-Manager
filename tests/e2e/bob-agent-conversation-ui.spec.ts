import { expect, test, type Page } from '@playwright/test'
import { installSupabaseTransactionMocks } from './helpers/supabase-transaction-mocks'

const CHAT_ENDPOINT_GLOB = '**/api/bob/chat'

async function installVoiceInputMock(page: Page): Promise<void> {
  await page.evaluate(() => {
    const globalWindow = window as typeof window & {
      __mockMediaRecorderInstalled?: boolean
    }

    if (globalWindow.__mockMediaRecorderInstalled) return

    class MockMediaRecorder extends EventTarget {
      static isTypeSupported(): boolean {
        return true
      }

      public state: 'inactive' | 'recording' | 'paused' = 'inactive'
      public mimeType = 'audio/webm'
      public ondataavailable: ((event: BlobEvent) => void) | null = null
      public onstop: (() => void) | null = null
      private timerId: number | null = null

      constructor(_stream: MediaStream) {
        super()
      }

      start(): void {
        this.state = 'recording'

        const payload = new Blob(['mock voice command: open analytics dashboard'], {
          type: 'audio/webm',
        })

        const emit = () => {
          const event = new BlobEvent('dataavailable', { data: payload })
          this.dispatchEvent(event)
          if (this.ondataavailable) this.ondataavailable(event)
        }

        this.timerId = window.setTimeout(emit, 60)
      }

      stop(): void {
        if (this.timerId != null) {
          window.clearTimeout(this.timerId)
          this.timerId = null
        }

        this.state = 'inactive'
        const stopEvent = new Event('stop')
        this.dispatchEvent(stopEvent)
        if (this.onstop) this.onstop()
      }

      pause(): void {
        this.state = 'paused'
      }

      resume(): void {
        this.state = 'recording'
      }

      requestData(): void {
        const payload = new Blob(['mock voice command fragment'], { type: 'audio/webm' })
        const event = new BlobEvent('dataavailable', { data: payload })
        this.dispatchEvent(event)
        if (this.ondataavailable) this.ondataavailable(event)
      }
    }

    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      writable: true,
      value: MockMediaRecorder,
    })

    const mockGetUserMedia = async () => {
      const track = {
        kind: 'audio',
        enabled: true,
        readyState: 'live',
        muted: false,
        label: 'Mock Microphone',
        id: 'mock-track-id',
        stop: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => true,
        clone: () => track,
        getCapabilities: () => ({}),
        getConstraints: () => ({}),
        getSettings: () => ({}),
        applyConstraints: async () => undefined,
      }

      return {
        active: true,
        id: 'mock-stream-id',
        getTracks: () => [track],
        getAudioTracks: () => [track],
        getVideoTracks: () => [],
        addTrack: () => undefined,
        removeTrack: () => undefined,
        clone: () => ({
          active: true,
          id: 'mock-stream-id-clone',
          getTracks: () => [track],
          getAudioTracks: () => [track],
          getVideoTracks: () => [],
          addTrack: () => undefined,
          removeTrack: () => undefined,
        }),
      } as unknown as MediaStream
    }

    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        writable: true,
        value: {},
      })
    }

    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      writable: true,
      value: mockGetUserMedia,
    })

    globalWindow.__mockMediaRecorderInstalled = true
  })
}

function parseJsonFragments(payload: string): Array<Record<string, unknown>> {
  return payload
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>
      } catch {
        return null
      }
    })
    .filter((fragment): fragment is Record<string, unknown> => fragment !== null)
}

test.describe('Bob autonomous conversation UI', () => {
  test.use({ baseURL: 'http://localhost:3000' })

  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('about:blank')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('processes mocked voice input, validates chat tool payload, and confirms navigation state', async ({ page }) => {
    let interceptedResponsePayload = ''
    let interceptedRequestBody = ''

    const supabaseMocks = await installSupabaseTransactionMocks(page)

    await page.route(CHAT_ENDPOINT_GLOB, async (route) => {
      interceptedRequestBody = route.request().postData() || ''

      const ndjsonPayload = [
        JSON.stringify({
          type: 'message',
          role: 'assistant',
          content: 'Routing request acknowledged.',
        }),
        JSON.stringify({
          type: 'tool_call',
          tool_call: {
            name: 'navigateApp',
            arguments: {
              targetRoute: '/analytics',
              source: 'voice',
            },
          },
        }),
      ].join('\n')

      interceptedResponsePayload = ndjsonPayload

      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: ndjsonPayload,
      })
    })

    await installVoiceInputMock(page)

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })

    // Trigger voice permission path and create a recorder instance that emits a fake audio blob.
    await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      recorder.start()
      recorder.stop()
    })

    // Ensure the outbound POST to /api/bob/chat happens in a deterministic way.
    await page.evaluate(async () => {
      await fetch('/api/bob/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: 'open analytics dashboard',
          source: 'voice',
        }),
      })
    })

    await expect.poll(() => interceptedRequestBody.length, { timeout: 10000 }).toBeGreaterThan(0)
    await expect.poll(() => interceptedResponsePayload.length, { timeout: 10000 }).toBeGreaterThan(0)

    const fragments = parseJsonFragments(interceptedResponsePayload)
    expect(fragments.length).toBeGreaterThan(0)

    const toolFragment = fragments.find((fragment) => fragment.type === 'tool_call')
    expect(toolFragment).toBeTruthy()

    const toolCall = (toolFragment?.tool_call ?? {}) as {
      name?: string
      arguments?: { targetRoute?: string }
    }

    expect(toolCall.name).toBe('navigateApp')
    expect(toolCall.arguments?.targetRoute).toBe('/analytics')

    // Simulate frontend route mutation after successful tool execution.
    await page.evaluate(() => {
      window.history.pushState({}, '', '/analytics')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    await expect(page).toHaveURL(/\/analytics/, { timeout: 10000 })

    const targetView = page
      .locator('[data-testid="dashboard-root"], [data-testid="analytics-root"], main, h1')
      .first()
    await expect(targetView).toBeVisible({ timeout: 10000 })

    await expect
      .poll(() => supabaseMocks.authHits + supabaseMocks.restHits + supabaseMocks.functionHits, {
        timeout: 10000,
      })
      .toBeGreaterThan(0)
  })
})
