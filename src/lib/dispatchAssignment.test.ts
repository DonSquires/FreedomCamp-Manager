import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
}))

import {
  selectDispatchResourceWithReason,
  type LoiForDispatch,
  type DispatchJobContext,
} from '@/lib/dispatchAssignment'

type QueryResult<T> = Promise<{ data: T; error: null }>

function mockZonesAndRules(zones: any[], rules: any[]) {
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'zones') {
      let eqCalls = 0
      const builder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(() => {
          eqCalls += 1
          if (eqCalls >= 2) {
            return Promise.resolve({ data: zones, error: null }) as QueryResult<any[]>
          }
          return builder
        }),
      }
      return builder
    }

    if (table === 'zone_dispatch_resource_rules') {
      const builder: any = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn(() => Promise.resolve({ data: rules, error: null }) as QueryResult<any[]>),
      }
      return builder
    }

    throw new Error(`Unexpected table requested: ${table}`)
  })
}

describe('dispatchAssignment fallback behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns fallback candidate for no-GPS LOI when address token matches zone name', async () => {
    mockZonesAndRules(
      [
        {
          id: 'zone-1',
          name: 'Nelson Central',
          location_lat: -41.27,
          location_lng: 173.28,
          radius_meters: 500,
          geometry: null,
        },
      ],
      [
        {
          zone_id: 'zone-1',
          dispatch_resource_id: 'res-1',
          priority: 1,
          job_type_code: null,
          day_of_week: null,
          time_from: null,
          time_to: null,
          dispatch_resource: {
            callsign: 'ALPHA-1',
            display_name: 'Alpha Unit',
            resource_type: 'patrol',
            auto_dispatch_enabled: true,
            shift_start_time: null,
            shift_end_time: null,
            active_days: null,
            is_active: true,
          },
        },
      ],
    )

    const loi: LoiForDispatch = {
      id: 'loi-1',
      gps_lat: null,
      gps_lng: null,
      display_address: '10 Hardy St, Nelson 7010',
    }

    const ctx: DispatchJobContext = {
      job_type_code: 'noise_complaint',
      organization_id: 'org-1',
      suburb: 'Nelson',
      postcode: '7010',
    }

    const result = await selectDispatchResourceWithReason(loi, ctx)

    expect(result.candidate).toBeTruthy()
    expect(result.candidate?.selection_reason).toBe('fallback_radius')
    expect(result.candidate?.dispatch_resource_id).toBe('res-1')
  })

  it('returns fallback candidate via nearest-zone logic when strict zone match fails', async () => {
    mockZonesAndRules(
      [
        {
          id: 'zone-near',
          name: 'Near Zone',
          location_lat: -41.2705,
          location_lng: 173.284,
          radius_meters: 10,
          geometry: null,
        },
        {
          id: 'zone-far',
          name: 'Far Zone',
          location_lat: -41.5,
          location_lng: 173.5,
          radius_meters: 10,
          geometry: null,
        },
      ],
      [
        {
          zone_id: 'zone-near',
          dispatch_resource_id: 'res-near',
          priority: 2,
          job_type_code: null,
          day_of_week: null,
          time_from: null,
          time_to: null,
          dispatch_resource: {
            callsign: 'NEAR-2',
            display_name: 'Near Unit',
            resource_type: 'patrol',
            auto_dispatch_enabled: true,
            shift_start_time: null,
            shift_end_time: null,
            active_days: null,
            is_active: true,
          },
        },
      ],
    )

    const loi: LoiForDispatch = {
      id: 'loi-2',
      gps_lat: -41.27,
      gps_lng: 173.284,
    }

    const ctx: DispatchJobContext = {
      job_type_code: 'alarm_response',
      organization_id: 'org-1',
    }

    const result = await selectDispatchResourceWithReason(loi, ctx)

    expect(result.candidate).toBeTruthy()
    expect(result.candidate?.selection_reason).toBe('fallback_radius')
    expect(result.candidate?.dispatch_resource_id).toBe('res-near')
  })
})
