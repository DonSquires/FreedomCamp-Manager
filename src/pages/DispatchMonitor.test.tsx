import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import DispatchMonitor from './DispatchMonitor'

const useQueryMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    user: {
      id: 'user-1',
      role: 'officer',
      organization_id: 'org-1',
    },
  }),
}))

vi.mock('@/stores/globalFiltersStore', () => ({
  useGlobalFiltersStore: () => ({
    organizationId: 'org-1',
  }),
}))

vi.mock('@/hooks/useOperationalCases', () => ({
  useFeatureFlag: () => ({
    data: false,
  }),
}))

vi.mock('@/components/features/AppLayout', () => ({
  AppLayout: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}))

vi.mock('@/components/features/GlobalFilterRibbon', () => ({
  GlobalFilterRibbon: () => <div data-testid="global-filter-ribbon" />,
}))

vi.mock('@/components/features/AsyncStateWrapper', () => ({
  AsyncStateWrapper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe('DispatchMonitor', () => {
  it('renders without crashing when stats are unavailable after loading', () => {
    useQueryMock
      .mockReturnValueOnce({ data: undefined, isLoading: false, refetch: vi.fn() })
      .mockReturnValueOnce({ data: undefined, isLoading: false })

    render(
      <MemoryRouter>
        <DispatchMonitor />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Dispatch Monitor' })).toBeInTheDocument()
    expect(screen.queryByText(/over sla/i)).not.toBeInTheDocument()
  })
})
