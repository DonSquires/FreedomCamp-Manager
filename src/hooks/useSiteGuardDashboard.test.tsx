import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSiteGuardDashboard, type NewIncidentData } from './useSiteGuardDashboard'

const authState = {
  user: {
    id: 'officer-1',
    organization_id: 'org-1',
  },
}

const fromMock = vi.fn()
const invalidateQueriesMock = vi.fn()

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => authState,
}))

vi.mock('@/lib/geofence', () => ({
  calculateDistance: () => 0,
}))

vi.mock('@/lib/timezone', () => ({
  nzNow: () => new Date('2026-05-15T10:00:00Z'),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  queryClient.invalidateQueries = invalidateQueriesMock as any

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function siteIncidentInsertBuilder(insertSpy: ReturnType<typeof vi.fn>) {
  const updateEqOrg = vi.fn().mockResolvedValue({ error: null })
  const updateEqId = vi.fn().mockReturnValue({ eq: updateEqOrg })

  const incidentsOrder = vi.fn().mockResolvedValue({ data: [], error: null })
  const incidentsGte = vi.fn().mockReturnValue({ order: incidentsOrder })
  const incidentsEqOrg = vi.fn().mockReturnValue({ gte: incidentsGte })
  const incidentsEqClient = vi.fn().mockReturnValue({ eq: incidentsEqOrg })

  return {
    insert: insertSpy,
    update: vi.fn().mockReturnValue({ eq: updateEqId }),
    select: vi.fn().mockReturnValue({
      eq: incidentsEqClient,
    }),
    __mocks: {
      updateEqId,
      updateEqOrg,
      incidentsEqClient,
      incidentsEqOrg,
    },
  }
}

describe('useSiteGuardDashboard C1 case linkage', () => {
  let siteEqIdMock: ReturnType<typeof vi.fn>
  let siteEqOrgMock: ReturnType<typeof vi.fn>
  let siteIncidentBuilder: ReturnType<typeof siteIncidentInsertBuilder>

  beforeEach(() => {
    fromMock.mockReset()
    invalidateQueriesMock.mockReset()

    siteEqOrgMock = vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })
    siteEqIdMock = vi.fn().mockReturnValue({ eq: siteEqOrgMock })

    const activeShiftQueryBuilder = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { case_id: 'case-123' },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }

    const siteIncidentInsertSpy = vi.fn().mockResolvedValue({ error: null })
    const emergencyInsertSpy = vi.fn().mockResolvedValue({ error: null })
    siteIncidentBuilder = siteIncidentInsertBuilder(siteIncidentInsertSpy)

    fromMock.mockImplementation((table: string) => {
      if (table === 'site_guard_shifts') return activeShiftQueryBuilder
      if (table === 'client_sites') {
        return {
          select: vi.fn().mockReturnValue({
            eq: siteEqIdMock,
          }),
        }
      }
      if (table === 'persons_of_interest') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                or: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'site_incidents') return siteIncidentBuilder
      if (table === 'emergency_assist_events') {
        return {
          insert: emergencyInsertSpy,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })
  })

  it('links created site incidents to active site_guard case', async () => {
    const { result } = renderHook(() => useSiteGuardDashboard('site-1'), {
      wrapper: createWrapper(),
    })

    const payload: NewIncidentData = {
      client_site_id: 'site-1',
      incident_type: 'trespass',
      severity: 'high',
      description: 'Subject entered restricted area',
      action_taken: 'Verbal direction to leave',
      subject_name: '',
      subject_description: '',
      subject_photos: [],
      police_notified: false,
      police_notified_at: null,
      police_event_number: '',
      police_officer_name: '',
      police_station: '',
      police_notes: '',
      camera_review_requested: false,
      camera_review_notes: '',
      gps_lat: null,
      gps_lng: null,
      location_description: '',
      poi_id: null,
      officer_shift_id: null,
      roster_shift_id: null,
    }

    await result.current.createIncident(payload)

    const siteIncidentInsertCalls = fromMock.mock.results
      .map((r) => r.value)
      .filter((b: any) => typeof b?.insert === 'function')
      .flatMap((b: any) => b.insert.mock?.calls ?? [])

    const siteIncidentPayload = siteIncidentInsertCalls.find((call: any[]) =>
      call?.[0] && Object.prototype.hasOwnProperty.call(call[0], 'incident_type'),
    )?.[0]

    expect(siteIncidentPayload).toBeTruthy()
    expect(siteIncidentPayload.case_id).toBe('case-123')

    await waitFor(() => {
      expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['siteGuardCaseTimeline'] })
    })
  })

  it('links emergency assist events to active site_guard case', async () => {
    const { result } = renderHook(() => useSiteGuardDashboard('site-1'), {
      wrapper: createWrapper(),
    })

    await result.current.triggerEmergencyAssist({
      assistType: 'emergency',
      severity: 'critical',
      description: 'Immediate assistance required',
    })

    const emergencyInsertCalls = fromMock.mock.results
      .map((r) => r.value)
      .filter((b: any) => typeof b?.insert === 'function')
      .flatMap((b: any) => b.insert.mock?.calls ?? [])

    const emergencyPayload = emergencyInsertCalls.find((call: any[]) =>
      call?.[0] && Object.prototype.hasOwnProperty.call(call[0], 'assist_type'),
    )?.[0]

    expect(emergencyPayload).toBeTruthy()
    expect(emergencyPayload.case_id).toBe('case-123')
    expect(emergencyPayload.client_site_id).toBe('site-1')

    await waitFor(() => {
      expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['siteGuardCaseTimeline', 'case-123'] })
      expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['emergencyAssists', 'org-1'] })
    })
  })

  it('applies organization filters on site and incident reads and POI-link writes', async () => {
    const { result } = renderHook(() => useSiteGuardDashboard('site-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(siteEqIdMock).toHaveBeenCalledWith('id', 'site-1')
      expect(siteEqOrgMock).toHaveBeenCalledWith('organization_id', 'org-1')
      expect(siteIncidentBuilder.__mocks.incidentsEqClient).toHaveBeenCalledWith('client_site_id', 'site-1')
      expect(siteIncidentBuilder.__mocks.incidentsEqOrg).toHaveBeenCalledWith('organization_id', 'org-1')
    })

    await result.current.linkPoiToIncident('incident-1', 'poi-1')

    expect(siteIncidentBuilder.__mocks.updateEqId).toHaveBeenCalledWith('id', 'incident-1')
    expect(siteIncidentBuilder.__mocks.updateEqOrg).toHaveBeenCalledWith('organization_id', 'org-1')
  })
})
