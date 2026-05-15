import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAccessControlCaseTimeline } from './useAccessControlC2'

const fromMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function createQueryBuilder(result: { data?: any[]; error?: Error | null }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: result.data ?? [], error: result.error ?? null }),
      }),
    }),
  }
}

describe('useAccessControlCaseTimeline degraded mode', () => {
  beforeEach(() => {
    fromMock.mockReset()
  })

  it('returns full timeline and non-degraded status when all domain queries succeed', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'access_control_incidents') return createQueryBuilder({ data: [{ id: 'inc-1' }] })
      if (table === 'access_entries') return createQueryBuilder({ data: [{ id: 'ent-1' }] })
      if (table === 'person_id_documents') return createQueryBuilder({ data: [{ id: 'doc-1' }] })
      if (table === 'site_risk_assessments') return createQueryBuilder({ data: [{ id: 'risk-1' }] })
      throw new Error(`Unexpected table: ${table}`)
    })

    const { result } = renderHook(() => useAccessControlCaseTimeline('case-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({
      incidents: [{ id: 'inc-1' }],
      entries: [{ id: 'ent-1' }],
      documents: [{ id: 'doc-1' }],
      assessments: [{ id: 'risk-1' }],
      degraded: false,
      degradedSources: [],
    })
  })

  it('degrades gracefully when risk assessment query is unavailable', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'access_control_incidents') return createQueryBuilder({ data: [{ id: 'inc-1' }] })
      if (table === 'access_entries') return createQueryBuilder({ data: [{ id: 'ent-1' }] })
      if (table === 'person_id_documents') return createQueryBuilder({ data: [{ id: 'doc-1' }] })
      if (table === 'site_risk_assessments') return createQueryBuilder({ error: new Error('risk service unavailable') })
      throw new Error(`Unexpected table: ${table}`)
    })

    const { result } = renderHook(() => useAccessControlCaseTimeline('case-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({
      incidents: [{ id: 'inc-1' }],
      entries: [{ id: 'ent-1' }],
      documents: [{ id: 'doc-1' }],
      assessments: [],
      degraded: true,
      degradedSources: ['site_risk_assessments'],
    })
  })
})
