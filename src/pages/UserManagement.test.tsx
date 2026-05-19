import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UserManagement from './UserManagement'

const fromMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    user: {
      id: 'officer-1',
      role: 'officer',
      organization_id: 'org-1',
    },
  }),
}))

vi.mock('@/components/features/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: any[]) => fromMock(...args),
    rpc: (...args: any[]) => rpcMock(...args),
  },
}))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UserManagement embedded />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('UserManagement', () => {
  beforeEach(() => {
    fromMock.mockClear()
    rpcMock.mockClear()
  })

  it('does not execute admin-only queries for non-admin users', async () => {
    renderPage()

    expect(await screen.findByText('Access Denied')).toBeInTheDocument()
    expect(fromMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })
})
