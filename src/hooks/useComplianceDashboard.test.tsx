import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComplianceBreachObservations } from './useComplianceDashboard'

const fromMock = vi.fn()

vi.mock('@/lib/homelessStatus', () => ({
  HOMELESS_UI_STATUSES: ['confirmed', 'claimed'],
}))

vi.mock('@/lib/timezone', () => ({
  nzDateToUTCStart: () => '2026-05-16T00:00:00.000Z',
  nzDateToUTCEnd: () => '2026-05-16T23:59:59.999Z',
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

type QueryResult = {
  data: any[]
  count: number | null
  error: any
}

function createQuery(result: QueryResult) {
  const query: any = {
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    lte: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(() => query),
    ilike: vi.fn(() => query),
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return query
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useComplianceBreachObservations', () => {
  beforeEach(() => {
    fromMock.mockReset()
  })

  it('uses observation_id as row id when joined observations query succeeds', async () => {
    const joinedResult = createQuery({
      data: [{
        observation_id: 'obs-1',
        plate_number: 'ABC123',
        recorded_at: '2026-05-16T01:00:00.000Z',
        breach_type: 'overstay',
        breach_reason: 'Too many nights',
        zones: { name: 'Zone 1' },
        organizations: { name: 'Org 1' },
      }],
      count: 1,
      error: null,
    })

    fromMock.mockImplementation((table: string) => {
      if (table !== 'observations') throw new Error(`Unexpected table: ${table}`)
      return {
        select: vi.fn(() => joinedResult),
      }
    })

    const { result } = renderHook(() => useComplianceBreachObservations({
      dateFrom: '2026-05-16',
      dateTo: '2026-05-16',
    }), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({
      rows: [{
        id: 'obs-1',
        plate_number: 'ABC123',
        recorded_at: '2026-05-16T01:00:00.000Z',
        breach_type: 'overstay',
        breach_reason: 'Too many nights',
        zones: { name: 'Zone 1' },
        organizations: { name: 'Org 1' },
      }],
      total: 1,
    })
  })

  it('falls back to plain observations query and still uses observation_id for ids', async () => {
    const joinedFailure = createQuery({
      data: [],
      count: 0,
      error: { message: 'relation does not exist' },
    })
    const plainSuccess = createQuery({
      data: [{
        observation_id: 'obs-2',
        plate_number: 'XYZ987',
        recorded_at: '2026-05-16T02:00:00.000Z',
        breach_type: 'overstay',
        breach_reason: null,
        zone_id: 'zone-1',
      }],
      count: 1,
      error: null,
    })

    const zonesInMock = vi.fn().mockResolvedValue({
      data: [{ id: 'zone-1', name: 'Zone 1' }],
      error: null,
    })

    const observationsSelectMock = vi.fn()
      .mockReturnValueOnce(joinedFailure)
      .mockReturnValueOnce(plainSuccess)

    fromMock.mockImplementation((table: string) => {
      if (table === 'observations') {
        return {
          select: observationsSelectMock,
        }
      }

      if (table === 'zones') {
        return {
          select: vi.fn(() => ({ in: zonesInMock })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const { result } = renderHook(() => useComplianceBreachObservations({
      dateFrom: '2026-05-16',
      dateTo: '2026-05-16',
    }), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({
      rows: [{
        id: 'obs-2',
        plate_number: 'XYZ987',
        recorded_at: '2026-05-16T02:00:00.000Z',
        breach_type: 'overstay',
        breach_reason: null,
        zones: { name: 'Zone 1' },
        organizations: null,
      }],
      total: 1,
    })
    expect(zonesInMock).toHaveBeenCalledWith('id', ['zone-1'])
  })
})
