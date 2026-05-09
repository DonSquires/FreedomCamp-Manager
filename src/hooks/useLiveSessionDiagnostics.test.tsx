import { renderHook } from '@testing-library/react'
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
})
