import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveSessionDiagnostics } from './useLiveSessionDiagnostics'

const {
  recordLiveSessionDiagnosticMock,
  drainLiveSessionDiagnosticsMock,
  liveSessionDiagnosticsIngestMock,
} = vi.hoisted(() => ({
  recordLiveSessionDiagnosticMock: vi.fn(),
  drainLiveSessionDiagnosticsMock: vi.fn(() => []),
  liveSessionDiagnosticsIngestMock: vi.fn(async () => ({})),
}))

const authState = {
  user: {
    id: 'user-1',
    role: 'officer' as const,
    organization_id: 'org-1',
  },
}

const RETRY_BACKOFF_MS = 60_000
const FLUSH_INTERVAL_MS = 15_000

let locationState = {
  pathname: '/portal-selection',
  search: '',
  hash: '',
}

vi.mock('react-router-dom', () => ({
  useLocation: () => locationState,
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => authState,
}))

vi.mock('@/lib/edgeFunctions', () => ({
  edgeFunctions: {
    liveSessionDiagnosticsIngest: liveSessionDiagnosticsIngestMock,
  },
}))

vi.mock('@/hooks/useFeedbackCapture', () => ({
  getFeedbackSnapshot: () => ({
    currentPage: '/portal-selection',
    navigationHistory: [],
    recentUserActions: [],
    consoleErrors: [],
    browserInfo: {},
    capturedAt: new Date().toISOString(),
    appVersion: 'test',
  }),
}))

vi.mock('@/lib/liveSessionDiagnostics', () => ({
  getLiveSessionDiagnosticsSessionId: () => 'session-id',
  getLiveSessionPttSnapshot: () => null,
  drainLiveSessionDiagnostics: drainLiveSessionDiagnosticsMock,
  recordLiveSessionDiagnostic: recordLiveSessionDiagnosticMock,
}))

describe('useLiveSessionDiagnostics', () => {
  beforeEach(() => {
    locationState = {
      pathname: '/portal-selection',
      search: '',
      hash: '',
    }
    recordLiveSessionDiagnosticMock.mockReset()
    drainLiveSessionDiagnosticsMock.mockClear()
    liveSessionDiagnosticsIngestMock.mockClear()
    vi.useRealTimers()
  })

  it('does not emit session_observer_unmounted on route changes', () => {
    const { rerender, unmount } = renderHook(() => useLiveSessionDiagnostics())

    locationState = {
      pathname: '/field-officer',
      search: '',
      hash: '',
    }
    rerender()

    const routeChangeUnmountCalls = recordLiveSessionDiagnosticMock.mock.calls.filter(
      (call) => call[0] === 'session_observer_unmounted',
    )
    expect(routeChangeUnmountCalls).toHaveLength(0)

    unmount()

    const finalUnmountCalls = recordLiveSessionDiagnosticMock.mock.calls.filter(
      (call) => call[0] === 'session_observer_unmounted',
    )
    expect(finalUnmountCalls).toHaveLength(1)
  })

  it('backs off interval flush retries after an ingest failure', async () => {
    vi.useFakeTimers()
    drainLiveSessionDiagnosticsMock.mockReturnValue([{
      event_type: 'route_changed',
      route_path: '/reports-hub',
      title: 'Reports Hub',
      details: {},
      occurred_at: new Date().toISOString(),
    }])
    liveSessionDiagnosticsIngestMock.mockResolvedValue({ data: null, error: 'offline' })

    renderHook(() => useLiveSessionDiagnostics())
    await act(async () => {
      await Promise.resolve()
    })
    liveSessionDiagnosticsIngestMock.mockClear()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS - FLUSH_INTERVAL_MS)
    })
    expect(liveSessionDiagnosticsIngestMock).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS)
    })
    expect(liveSessionDiagnosticsIngestMock).toHaveBeenCalledTimes(1)
  })

  it('backs off interval flush retries after an ingest exception', async () => {
    vi.useFakeTimers()
    drainLiveSessionDiagnosticsMock.mockReturnValue([{
      event_type: 'route_changed',
      route_path: '/reports-hub',
      title: 'Reports Hub',
      details: {},
      occurred_at: new Date().toISOString(),
    }])
    liveSessionDiagnosticsIngestMock.mockRejectedValue(new Error('network'))

    renderHook(() => useLiveSessionDiagnostics())
    await act(async () => {
      await Promise.resolve()
    })
    liveSessionDiagnosticsIngestMock.mockClear()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS - FLUSH_INTERVAL_MS)
    })
    expect(liveSessionDiagnosticsIngestMock).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS)
    })
    expect(liveSessionDiagnosticsIngestMock).toHaveBeenCalledTimes(1)
  })
})
