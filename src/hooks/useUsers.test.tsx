import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUpdateUser } from './useUsers'

const updateUserProfileMock = vi.fn()
const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {},
}))

vi.mock('@/lib/edgeFunctions', () => ({
  edgeFunctions: {
    updateUserProfile: (...args: unknown[]) => updateUserProfileMock(...args),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useUpdateUser', () => {
  beforeEach(() => {
    updateUserProfileMock.mockReset()
    toastSuccessMock.mockReset()
    toastErrorMock.mockReset()
  })

  it('uses the canonical manage-user update path', async () => {
    updateUserProfileMock.mockResolvedValue({ data: { ok: true }, error: null })
    const { result } = renderHook(() => useUpdateUser(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.mutateAsync({
        userId: 'user-1',
        updates: {
          first_name: 'Jane',
          last_name: 'Doe',
          organization_id: 'org-1',
        },
      })
    })

    expect(updateUserProfileMock).toHaveBeenCalledWith({
      user_id: 'user-1',
      payload: {
        first_name: 'Jane',
        last_name: 'Doe',
        organization_id: 'org-1',
      },
    })
    expect(toastSuccessMock).toHaveBeenCalledWith('User updated successfully')
  })
})
