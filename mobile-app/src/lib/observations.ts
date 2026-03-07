import { supabase } from './supabase'

export interface ObservationListParams {
  dateFrom: string
  dateTo: string
  organizationId?: string | null
  zoneId?: string | null
  recordedBy?: string | null
  search?: string
  pageSize?: number
}

export interface ObservationListRow {
  id: string
  created_at: string
  recorded_at: string
  plate_number: string
  recorded_by: string
  officer_name: string
  zone_name: string
  is_compliant: boolean | null
  breach_type: string | null
  photo_url: string | null
  gps_latitude: number | null
  gps_longitude: number | null
}

export async function fetchAllObservations(params: ObservationListParams): Promise<ObservationListRow[]> {
  const pageSize = Math.max(1, Math.min(1000, params.pageSize ?? 500))
  let page = 1
  let total = Infinity
  const rows: ObservationListRow[] = []

  while (rows.length < total) {
    const { data, error } = await supabase.functions.invoke('observations-list', {
      body: {
        date_from: params.dateFrom,
        date_to: params.dateTo,
        organization_id: params.organizationId || null,
        zone_id: params.zoneId || null,
        recorded_by: params.recordedBy || null,
        search: params.search || '',
        page,
        page_size: pageSize,
        sort: [{ field: 'recorded_at', dir: 'desc' }],
      },
    })

    if (error) {
      throw new Error(error.message || 'Failed to fetch observations')
    }

    const payloadRows = (data?.rows || []) as ObservationListRow[]
    total = Number(data?.total || 0)
    rows.push(...payloadRows)

    if (payloadRows.length < pageSize) break
    page += 1

    // Safety guard against accidental infinite loops.
    if (page > 500) break
  }

  return rows
}
