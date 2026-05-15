import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RadioCommsEventLog from './RadioCommsEventLog'

const authState = {
  user: {
    id: 'user-1',
    role: 'master' as const,
    organization_id: 'org-1',
  },
}

const rowsFixture = [
  {
    id: 'event-1',
    organization_id: 'org-1',
    case_id: 'case-1234-aaaa-bbbb-cccc-111111111111',
    officer_id: 'off-1',
    callsign: 'ALPHA-1',
    channel_scope: 'org:org-1',
    event_type: 'dispatch_escalated_to_radio' as const,
    degraded_mode: false,
    ptt_session_id: 'ptt-1',
    notes: 'Escalated to radio — callsign: ALPHA-1',
    event_timestamp: '2026-05-15T10:00:00Z',
    created_at: '2026-05-15T10:00:05Z',
    created_by: 'user-1',
  },
]

const fromMock = vi.fn((table: string) => {
  if (table === 'radio_comms_events') {
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: async () => ({ data: rowsFixture, error: null }),
    }
    return builder
  }

  return {
    select: () => ({
      order: async () => ({ data: [], error: null }),
      eq: () => ({
        order: async () => ({ data: [], error: null }),
      }),
    }),
  }
})

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => authState,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
  },
}))

vi.mock('@/components/features/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
        <RadioCommsEventLog />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RadioCommsEventLog', () => {
  beforeEach(() => {
    fromMock.mockClear()
  })

  it('renders the radio comms event row and expandable details', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: /radio comms event log/i })).toBeInTheDocument()
    expect(await screen.findByText('ALPHA-1')).toBeInTheDocument()
    expect(screen.getByText('dispatch escalated to radio')).toBeInTheDocument()

    fireEvent.click(screen.getByText('ALPHA-1'))

    await waitFor(() => {
      expect(screen.getByText('Escalated to radio — callsign: ALPHA-1')).toBeInTheDocument()
    })

    expect(within(screen.getByText(/case:/i).closest('td') as HTMLElement).getByText(/case-1234/i)).toBeInTheDocument()
  })
})
