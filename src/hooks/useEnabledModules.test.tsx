import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEnabledModules } from './useEnabledModules'

const authState = {
  user: {
    id: 'user-1',
    role: 'admin' as const,
    organization_id: 'org-1',
  },
}

const rpcMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => authState,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useEnabledModules', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    fromMock.mockReset()
    authState.user.role = 'admin'
    authState.user.organization_id = 'org-1'
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to core-only access when subscriptions cannot be verified', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('rpc unavailable') })
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          in: async () => ({ data: null, error: new Error('table unavailable') }),
        }),
      }),
    })

    const { result } = renderHook(() => useEnabledModules(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.modules).toEqual([
      {
        moduleId: 'core',
        moduleName: 'Core Platform (CRM Hub)',
        status: 'active',
        licensedSeats: null,
        currentSeats: 0,
      },
    ])
    expect(result.current.enabledModuleIds).toEqual(['core'])
    expect(result.current.isModuleEnabled('parking')).toBe(false)
  })
})