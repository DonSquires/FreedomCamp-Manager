import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { HOMELESS_UI_STATUSES, isHomelessForUi, normalizeHomelessStatus } from '@/lib/homelessStatus'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { getObservationPhotoUrl, getVehiclePhotoUrl } from '@/lib/photoUtils'
import { toast } from 'sonner'
import type { Vehicle } from '@/types'

// ─── useVehicleListQuery ──────────────────────────────────────────────────────

export interface VehicleListItem {
  vehicle_id: string
  source?: 'canonical' | 'observations'
  plate_number: string
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_year: number | null
  vehicle_color: string | null
  self_contained: boolean
  self_contained_expiry: string | null
  homeless_status: string | null
  is_exempt: boolean
  is_flagged: boolean
  flagged_reason: string | null
  enforcement_count: number
  last_enforcement_at: string | null
  profile_photo: string | null
  total_observations: number
  total_breaches: number
}

export interface VehicleQueryDebug {
  rawOrgId: string | null
  resolvedOrgId: string | null
  rawZoneId: string | null
  resolvedZoneId: string | null
  scopedObservationCount: number
  primaryCanonicalCount: number
  fallbackCanonicalCount: number
  synthesizedCount: number
}

type VehicleStatusFilter = 'all' | 'compliant' | 'breaches' | 'homeless' | 'exempt' | 'flagged'

interface UseVehicleListQueryOptions {
  effectiveOrganizationId: string | null
  zoneId: string | null
  dateFrom: string | null
  dateTo: string | null
  statusFilter: VehicleStatusFilter
  searchQuery: string
}

export function useVehicleListQuery(options: UseVehicleListQueryOptions) {
  const { effectiveOrganizationId, zoneId, dateFrom, dateTo, statusFilter, searchQuery } = options

  return useQuery({
    queryKey: ['vehicles', effectiveOrganizationId, zoneId, dateFrom, dateTo, statusFilter, searchQuery],
    queryFn: async () => {
      const debug: VehicleQueryDebug = {
        rawOrgId: effectiveOrganizationId,
        resolvedOrgId: null,
        rawZoneId: zoneId,
        resolvedZoneId: null,
        scopedObservationCount: 0,
        primaryCanonicalCount: 0,
        fallbackCanonicalCount: 0,
        synthesizedCount: 0,
      }

      try {

      const isUuid = (value: string | null) =>
        !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

      const isAllLike = (value: string | null) => {
        if (!value) return true
        const normalized = value.trim().toLowerCase()
        return (
          !normalized ||
          normalized === '__all__' ||
          normalized === 'all' ||
          normalized === 'all zones' ||
          normalized === 'all organisations' ||
          normalized === 'null' ||
          normalized === 'undefined'
        )
      }

      const resolveScopeOrgId = async (rawOrgId: string | null) => {
        if (isAllLike(rawOrgId)) return null
        if (isUuid(rawOrgId)) return rawOrgId

        const normalized = rawOrgId!.replace(/\s*\(current\)\s*$/i, '').trim()
        if (!normalized) return null

        const { data, error } = await (supabase.from('organizations') as any)
          .select('id, name')
          .ilike('name', `%${normalized}%`)
          .limit(1)

        if (error) throw error
        return data?.[0]?.id ?? null
      }

      const resolveScopeZoneId = async (rawZoneId: string | null, scopeOrgId: string | null) => {
        if (isAllLike(rawZoneId)) return null
        if (isUuid(rawZoneId)) return rawZoneId

        const normalized = rawZoneId!.trim()
        if (!normalized) return null

        let zoneQuery = (supabase.from('zones') as any)
          .select('id, name, organization_id')
          .eq('is_active', true)
          .ilike('name', `%${normalized}%`)
          .limit(1)

        if (scopeOrgId) {
          zoneQuery = zoneQuery.eq('organization_id', scopeOrgId)
        }

        const { data, error } = await zoneQuery
        if (error) throw error
        return data?.[0]?.id ?? null
      }

      const scopeOrgId = await resolveScopeOrgId(effectiveOrganizationId)
      debug.resolvedOrgId = scopeOrgId
      const scopeZoneId = await resolveScopeZoneId(zoneId, scopeOrgId)
      debug.resolvedZoneId = scopeZoneId

      const startISO = dateFrom ? nzDateToUTCStart(dateFrom) : null
      const endISO = dateTo ? nzDateToUTCEnd(dateTo) : null

      const applyObservationScope = (query: any) => {
        if (scopeOrgId) query = query.eq('organization_id', scopeOrgId)
        if (scopeZoneId) query = query.eq('zone_id', scopeZoneId)
        if (startISO) query = query.gte('recorded_at', startISO)
        if (endISO) query = query.lte('recorded_at', endISO)
        return query
      }

      const normalizeVehicleRow = (row: any): VehicleListItem => {
        const plate = String(row?.plate_number ?? '').trim()
        return {
          vehicle_id: row?.vehicle_id ?? `canonical:${plate}`,
          source: 'canonical',
          plate_number: plate,
          vehicle_make: row?.vehicle_make ?? null,
          vehicle_model: row?.vehicle_model ?? null,
          vehicle_year: row?.vehicle_year ?? null,
          vehicle_color: row?.vehicle_color ?? null,
          self_contained: !!(row?.self_contained ?? false),
          self_contained_expiry: row?.self_contained_expiry ?? null,
          homeless_status: row?.homeless_status ?? null,
          is_exempt: !!(row?.is_exempt ?? false),
          is_flagged: !!(row?.is_flagged ?? false),
          flagged_reason: row?.flagged_reason ?? null,
          enforcement_count: Number(row?.enforcement_count ?? 0),
          last_enforcement_at: row?.last_enforcement_at ?? null,
          profile_photo: row?.profile_photo ?? null,
          total_observations: Number(row?.total_observations ?? 0),
          total_breaches: Number(row?.total_breaches ?? 0),
        }
      }

      const fetchScopedPlates = async (scopeOrgId: string | null, scopeZoneId: string | null) => {
        const obsQuery = applyObservationScope(supabase
          .from('observations')
          .select('plate_number')
          .neq('plate_number', 'PROCESSING...')
          .limit(10000))

        const { data: matchingObs, error: obsError } = await obsQuery
        if (obsError) throw obsError

        if ((scopeOrgId || scopeZoneId) && debug.scopedObservationCount === 0) {
          debug.scopedObservationCount = (matchingObs ?? []).length
        }

        return new Set(
          (matchingObs ?? [])
            .map((o: any) => o.plate_number)
            .filter((p: any) => p && typeof p === 'string' && p.trim()) as string[]
        )
      }

      const applyVehicleFilters = (query: any) => {
        query = query.order('plate_number', { ascending: true })

        if (searchQuery) {
          query = query.or(
            `plate_number.ilike.%${searchQuery}%,vehicle_make.ilike.%${searchQuery}%,vehicle_model.ilike.%${searchQuery}%`
          )
        }

        return query
      }

      const applyStatusFilterInMemory = (rows: VehicleListItem[]) => {
        if (statusFilter === 'compliant') {
          return rows.filter((v) => v.total_breaches === 0)
        }
        if (statusFilter === 'breaches') {
          return rows.filter((v) => v.total_breaches > 0 && !isHomelessForUi(v.homeless_status))
        }
        if (statusFilter === 'homeless') {
          return rows.filter((v) => isHomelessForUi(v.homeless_status))
        }
        if (statusFilter === 'exempt') {
          return rows.filter((v) => v.is_exempt)
        }
        if (statusFilter === 'flagged') {
          return rows.filter((v) => v.is_flagged)
        }
        return rows
      }

      const pickObservationPhotoColumn = async () => {
        const candidates: Array<'photo' | 'photo_url' | 'image_url'> = ['photo', 'photo_url', 'image_url']
        for (const col of candidates) {
          const { data, error } = await (supabase.from('observations') as any)
            .select(`plate_number, ${col}`)
            .not(col, 'is', null)
            .limit(1)
          if (!error && data && data.length > 0) return col
        }
        for (const col of candidates) {
          const { error } = await (supabase.from('observations') as any)
            .select(`plate_number, ${col}`)
            .limit(1)
          if (!error) return col
        }
        return null
      }

      const pickObservationSelfContainedColumn = async () => {
        const candidates: Array<'self_contained' | 'is_self_contained'> = ['self_contained', 'is_self_contained']
        for (const col of candidates) {
          const { error } = await (supabase.from('observations') as any)
            .select(`id, ${col}`)
            .limit(1)
          if (!error) return col
        }
        return null
      }

      let rows: VehicleListItem[] = []

      const hasScope = !!(scopeOrgId || scopeZoneId || startISO || endISO)

      if (hasScope) {
        const scopedPlates = await fetchScopedPlates(scopeOrgId, scopeZoneId)

        if (scopedPlates.size > 0) {
          const plateArr = Array.from(scopedPlates)
          for (let i = 0; i < plateArr.length; i += 200) {
            const chunk = plateArr.slice(i, i + 200)
            const { data, error } = await applyVehicleFilters(
              supabase.from('canonical_vehicles').select('*').in('plate_number', chunk)
            )
            if (error) throw error
            rows.push(...((data ?? []) as any[]).map(normalizeVehicleRow))
          }
          debug.primaryCanonicalCount = rows.length
        }
      } else {
        const { data, error } = await applyVehicleFilters(
          supabase.from('canonical_vehicles').select('*')
        )
        if (error) throw error
        rows = ((data ?? []) as any[]).map(normalizeVehicleRow)
        debug.primaryCanonicalCount = rows.length
      }

      if (rows.length === 0) {
        const synthPhotoColumn = await pickObservationPhotoColumn()
        const synthSelectParts = [
          'plate_number',
          'vehicle_make',
          'vehicle_model',
          'vehicle_year',
          'vehicle_color',
          'self_contained',
          'is_compliant',
          'recorded_at',
        ]
        if (synthPhotoColumn) synthSelectParts.push(synthPhotoColumn)

        let synthQuery = (supabase.from('observations') as any)
          .select(synthSelectParts.join(', '))
          .neq('plate_number', 'PROCESSING...')
          .order('recorded_at', { ascending: false })
          .limit(10000)

        synthQuery = applyObservationScope(synthQuery)

        const synth = await synthQuery
        if (synth.error) throw synth.error

        const byPlate = new Map<string, VehicleListItem>()

        for (const obs of (synth.data ?? []) as any[]) {
          const plate = (obs.plate_number || '').trim()
          if (!plate) continue

          const existing = byPlate.get(plate)
          const isBreach = obs.is_compliant === false

          if (!existing) {
            byPlate.set(plate, {
              vehicle_id: `obs:${plate}`,
              source: 'observations',
              plate_number: plate,
              vehicle_make: obs.vehicle_make ?? null,
              vehicle_model: obs.vehicle_model ?? null,
              vehicle_year: obs.vehicle_year ?? null,
              vehicle_color: obs.vehicle_color ?? null,
              self_contained: !!obs.self_contained,
              self_contained_expiry: null,
              homeless_status: null,
              is_exempt: false,
              is_flagged: false,
              flagged_reason: null,
              enforcement_count: 0,
              last_enforcement_at: null,
              profile_photo: getObservationPhotoUrl(obs),
              total_observations: 1,
              total_breaches: isBreach ? 1 : 0,
            })
            continue
          }

          existing.total_observations += 1
          if (isBreach) existing.total_breaches += 1
          if (!existing.profile_photo) {
            existing.profile_photo = getObservationPhotoUrl(obs)
          }
          if (!existing.vehicle_make && obs.vehicle_make) existing.vehicle_make = obs.vehicle_make
          if (!existing.vehicle_model && obs.vehicle_model) existing.vehicle_model = obs.vehicle_model
          if (!existing.vehicle_year && obs.vehicle_year) existing.vehicle_year = obs.vehicle_year
          if (!existing.vehicle_color && obs.vehicle_color) existing.vehicle_color = obs.vehicle_color
          existing.self_contained = existing.self_contained || !!obs.self_contained
        }

        rows = Array.from(byPlate.values())
        debug.synthesizedCount = rows.length

        if (searchQuery) {
          const term = searchQuery.toLowerCase()
          rows = rows.filter((v) =>
            v.plate_number.toLowerCase().includes(term) ||
            (v.vehicle_make || '').toLowerCase().includes(term) ||
            (v.vehicle_model || '').toLowerCase().includes(term)
          )
        }

      }

      if (rows.length === 0) {
        return rows
      }

      const metricsByPlate: Record<string, { total: number; breaches: number }> = {}
      const metricPlates = Array.from(new Set(rows.map((v) => v.plate_number).filter(Boolean)))

      for (let i = 0; i < metricPlates.length; i += 200) {
        const chunk = metricPlates.slice(i, i + 200)
        if (chunk.length === 0) continue

        const metricQuery = applyObservationScope(
          (supabase.from('observations') as any)
            .select('plate_number, is_compliant')
            .in('plate_number', chunk)
            .neq('plate_number', 'PROCESSING...')
            .limit(10000)
        )

        const { data: metricRows, error: metricError } = await metricQuery
        if (metricError) throw metricError

        for (const obs of metricRows ?? []) {
          const plate = String(obs.plate_number ?? '').trim()
          if (!plate) continue
          if (!metricsByPlate[plate]) {
            metricsByPlate[plate] = { total: 0, breaches: 0 }
          }
          metricsByPlate[plate].total += 1
          if (obs.is_compliant === false) {
            metricsByPlate[plate].breaches += 1
          }
        }
      }

      rows = rows
        .map((v) => {
          const metric = metricsByPlate[v.plate_number] ?? { total: 0, breaches: 0 }
          return {
            ...v,
            total_observations: metric.total,
            total_breaches: metric.breaches,
          }
        })
        .filter((v) => v.total_observations > 0)

      const uniquePlates = Array.from(
        new Set(rows.map((v) => v.plate_number).filter((plate) => !!plate && plate.trim()))
      )

      if (uniquePlates.length > 0) {
        const homelessByPlate: Record<string, string | null> = {}
        const exemptByPlate: Record<string, boolean> = {}
        const selfContainedByPlate: Record<string, boolean> = {}
        const selfContainedColumn = await pickObservationSelfContainedColumn()

        for (let i = 0; i < uniquePlates.length; i += 200) {
          const chunk = uniquePlates.slice(i, i + 200)

          let homelessQuery = (supabase.from('homeless_records') as any)
            .select('plate_number, status, organization_id, is_active, last_reported_at')
            .eq('is_active', true)
            .in('plate_number', chunk)
            .order('last_reported_at', { ascending: false })

          if (scopeOrgId) {
            homelessQuery = homelessQuery.eq('organization_id', scopeOrgId)
          }

          const { data: homelessRows } = await homelessQuery
          for (const row of homelessRows ?? []) {
            const plate = (row.plate_number || '').trim()
            if (!plate || homelessByPlate[plate] !== undefined) continue
            homelessByPlate[plate] = row.status ?? null
          }

          const { data: canonicalRows } = await (supabase.from('canonical_vehicles') as any)
            .select('plate_number, self_contained, is_exempt, homeless_status')
            .in('plate_number', chunk)

          for (const row of canonicalRows ?? []) {
            const plate = (row.plate_number || '').trim()
            if (!plate) continue
            if (homelessByPlate[plate] === undefined && row.homeless_status) {
              homelessByPlate[plate] = row.homeless_status
            }
            if (row.is_exempt === true) {
              exemptByPlate[plate] = true
            }
            if (row.self_contained === true) {
              selfContainedByPlate[plate] = true
            }
          }

          if (selfContainedColumn) {
            const selfContainedObsQuery = applyObservationScope((supabase.from('observations') as any)
              .select(`plate_number, ${selfContainedColumn}`)
              .in('plate_number', chunk)
              .eq(selfContainedColumn, true)
              .limit(10000))

            const { data: selfContainedObsRows } = await selfContainedObsQuery
            for (const row of selfContainedObsRows ?? []) {
              const plate = (row.plate_number || '').trim()
              if (plate) selfContainedByPlate[plate] = true
            }
          }
        }

        rows = rows.map((v) => {
          const enrichedHomelessStatus = homelessByPlate[v.plate_number] ?? v.homeless_status
          const homelessStatusNormalized = normalizeHomelessStatus(enrichedHomelessStatus)

          return {
            ...v,
            homeless_status: enrichedHomelessStatus,
            is_exempt:
              v.is_exempt ||
              !!exemptByPlate[v.plate_number] ||
              homelessStatusNormalized === 'confirmed',
            self_contained: v.self_contained || !!selfContainedByPlate[v.plate_number],
          }
        })
      }

      const missingPhotoPlates = rows
        .filter((v) => !getVehiclePhotoUrl(v))
        .map((v) => v.plate_number)

      if (missingPhotoPlates.length === 0) {
        return applyStatusFilterInMemory(rows)
      }

      const photoByPlate: Record<string, string> = {}
      const backfillPhotoColumn = await pickObservationPhotoColumn()
      if (!backfillPhotoColumn) {
        return rows
      }

      const allPhotoCols = new Set(['photo', 'photo_url', backfillPhotoColumn])
      const photoSelectCols = ['plate_number', ...allPhotoCols, 'recorded_at'].join(', ')

      const plateChunks: string[][] = []
      for (let i = 0; i < missingPhotoPlates.length; i += 200) {
        plateChunks.push(missingPhotoPlates.slice(i, i + 200))
      }

      for (const chunk of plateChunks) {
        let photoQuery = (supabase.from('observations') as any)
          .select(photoSelectCols)
          .in('plate_number', chunk)
          .not(backfillPhotoColumn, 'is', null)
          .order('recorded_at', { ascending: false })
          .limit(Math.max(300, chunk.length * 4))

        photoQuery = applyObservationScope(photoQuery)

        const { data: latestPhotos } = await photoQuery

        for (const row of latestPhotos ?? []) {
          const plate = row.plate_number as string | null
          if (!plate || photoByPlate[plate]) continue
          const resolved = getObservationPhotoUrl(row as any)
          if (resolved) photoByPlate[plate] = resolved
        }
      }

      const finalRows = rows.map((v) => ({
        ...v,
        profile_photo: getVehiclePhotoUrl(v, photoByPlate[v.plate_number] ?? null),
      }))

      return applyStatusFilterInMemory(finalRows)
      } catch (error: any) {
        const message =
          error?.message ||
          error?.error_description ||
          error?.details ||
          (typeof error === 'string' ? error : null) ||
          'Vehicle query failed'
        throw new Error(message)
      }
    },
    retry: 1,
  })
}

// ─── Legacy hook types ────────────────────────────────────────────────────────

interface UseVehiclesOptions {
  organizationId?: string | null
  zoneId?: string | null
  dateFrom?: string | null
  dateTo?: string | null
  userRole?: 'admin' | 'master' | 'officer' | 'admin_officer' | null
  userOrganizationId?: string | null
  searchQuery?: string
  statusFilter?: 'all' | 'compliant' | 'breaches' | 'homeless' | 'exempt'
}

interface UseVehicleDialogObservationsOptions {
  plateNumber?: string | null
  organizationId?: string | null
  zoneId?: string | null
  dateFrom?: string | null
  dateTo?: string | null
  enabled?: boolean
}

type ObservationPhotoColumn = 'photo_url' | 'image_url' | 'photo'

let vehicleDialogPhotoColumnCache: ObservationPhotoColumn | null | undefined

async function getVehicleDialogPhotoColumn() {
  if (vehicleDialogPhotoColumnCache !== undefined) return vehicleDialogPhotoColumnCache

  const candidates: ObservationPhotoColumn[] = ['photo_url', 'image_url', 'photo']
  for (const col of candidates) {
    const { error } = await (supabase.from('observations') as any).select(`observation_id, ${col}`).limit(1)
    if (!error) {
      vehicleDialogPhotoColumnCache = col
      return vehicleDialogPhotoColumnCache
    }
  }

  vehicleDialogPhotoColumnCache = null
  return vehicleDialogPhotoColumnCache
}

export function useVehicleDialogObservations(options: UseVehicleDialogObservationsOptions) {
  const {
    plateNumber,
    organizationId,
    zoneId,
    dateFrom,
    dateTo,
    enabled = true,
  } = options

  return useQuery({
    queryKey: ['vehicle-dialog-obs', plateNumber, organizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase
        .from('observations')
        .select('observation_id, recorded_at, is_compliant, breach_type, nights_stayed_this_month, organization_id, zone_id, recorded_by')
        .eq('plate_number', plateNumber!)
        .order('recorded_at', { ascending: false })
        .limit(100)

      if (organizationId) q = q.eq('organization_id', organizationId)
      if (zoneId) q = q.eq('zone_id', zoneId)
      if (dateFrom) q = q.gte('recorded_at', nzDateToUTCStart(dateFrom))
      if (dateTo) q = q.lte('recorded_at', nzDateToUTCEnd(dateTo))

      const { data: baseRows, error: baseError } = await q
      if (baseError) throw baseError

      const obsRows = (baseRows || []) as any[]
      if (obsRows.length === 0) return []

      const zoneIds = Array.from(new Set(obsRows.map((o: any) => o.zone_id).filter(Boolean)))
      const orgIds = Array.from(new Set(obsRows.map((o: any) => o.organization_id).filter(Boolean)))

      let zoneNames: Record<string, string> = {}
      if (zoneIds.length > 0) {
        const { data: z } = await (supabase.from('zones') as any).select('id, name').in('id', zoneIds)
        zoneNames = Object.fromEntries((z || []).map((row: any) => [row.id, row.name]))
      }

      let orgNames: Record<string, string> = {}
      if (orgIds.length > 0) {
        const { data: o } = await (supabase.from('organizations') as any).select('id, name').in('id', orgIds)
        orgNames = Object.fromEntries((o || []).map((row: any) => [row.id, row.name]))
      }

      const photoColumn = await getVehicleDialogPhotoColumn()

      let photosById: Record<string, string | null> = {}
      if (photoColumn) {
        const ids = obsRows.map((o: any) => o.observation_id).filter(Boolean)
        if (ids.length > 0) {
          const { data: p } = await (supabase.from('observations') as any)
            .select(`observation_id, ${photoColumn}`)
            .in('observation_id', ids)
          photosById = Object.fromEntries(
            (p || []).map((row: any) => [row.observation_id, row[photoColumn] ?? null])
          )
        }
      }

      return obsRows.map((row: any) => ({
        ...row,
        zone: row.zone_id ? { id: row.zone_id, name: zoneNames[row.zone_id] || 'Unknown Zone' } : null,
        org: row.organization_id
          ? { name: orgNames[row.organization_id] || 'Unknown Org' }
          : null,
        photo_url: photosById[row.observation_id] ?? null,
      }))
    },
    enabled: enabled && !!plateNumber,
  })
}

export function useVehicles(options: UseVehiclesOptions = {}) {
  const {
    organizationId,
    zoneId,
    dateFrom,
    dateTo,
    userRole,
    userOrganizationId,
    searchQuery = '',
    statusFilter = 'all',
  } = options

  return useQuery({
    queryKey: ['vehicles', organizationId, zoneId, dateFrom, dateTo, userRole, userOrganizationId, statusFilter, searchQuery],
    queryFn: async () => {
      const effectiveOrganizationId =
        organizationId || (userRole !== 'master' ? userOrganizationId || null : null)

      let query = supabase
        .from('canonical_vehicles')
        .select('*')
        .order('plate_number', { ascending: true })

      if (effectiveOrganizationId || zoneId || dateFrom || dateTo) {
        let matchingObservationsQuery = supabase
          .from('observations')
          .select('plate_number')
          

        if (effectiveOrganizationId) {
          matchingObservationsQuery = matchingObservationsQuery.eq('organization_id', effectiveOrganizationId)
        }
        if (zoneId) {
          matchingObservationsQuery = matchingObservationsQuery.eq('zone_id', zoneId)
        }
        if (dateFrom) {
          matchingObservationsQuery = matchingObservationsQuery.gte('recorded_at', nzDateToUTCStart(dateFrom))
        }
        if (dateTo) {
          matchingObservationsQuery = matchingObservationsQuery.lte('recorded_at', nzDateToUTCEnd(dateTo))
        }

        const { data: matchingObservations, error: matchingObsError } = await matchingObservationsQuery
        if (matchingObsError) throw matchingObsError

        const plateRows = (matchingObservations ?? []) as Array<{ plate_number: string | null }>
        const matchingPlates = [...new Set(plateRows.map((o) => o.plate_number).filter(Boolean) as string[])]
        if (matchingPlates.length === 0) return [] as Vehicle[]

        query = query.in('plate_number', matchingPlates)
      }

      if (searchQuery) {
        query = query.or(`plate_number.ilike.%${searchQuery}%,vehicle_make.ilike.%${searchQuery}%,vehicle_model.ilike.%${searchQuery}%`)
      }

      if (statusFilter === 'compliant') {
        query = query.eq('total_breaches', 0)
      } else if (statusFilter === 'breaches') {
        query = query.gt('total_breaches', 0)
      } else if (statusFilter === 'homeless') {
        query = query.in('homeless_status', HOMELESS_UI_STATUSES)
      } else if (statusFilter === 'exempt') {
        query = query.eq('is_exempt', true)
      }

      const { data, error } = await query
      
      if (error) throw error
      return data as Vehicle[]
    },
  })
}

export function useVehicle(vehicleId: string) {
  return useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .single()

      if (error) throw error
      return data as Vehicle
    },
    enabled: !!vehicleId,
  })
}

export function useUpdateVehicle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ vehicleId, updates }: { vehicleId: string; updates: Partial<Vehicle> }) => {
      const { error } = await supabase.from('canonical_vehicles')
        .update(updates)
        .eq('vehicle_id', vehicleId)

      if (error) throw error
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['vehicle', variables.vehicleId] })
      toast.success('Vehicle updated successfully')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update vehicle')
    },
  })
}

export function useVehicleStats(organizationId?: string | null) {
  return useQuery({
    queryKey: ['vehicle-stats', organizationId],
    queryFn: async () => {
      let vehicleQuery: any = supabase.from('canonical_vehicles')
        .select('self_contained, total_breaches, homeless_status, is_exempt', { count: 'exact' })

      if (organizationId) {
        vehicleQuery = vehicleQuery.eq('organization_id', organizationId)
      }

      const { data, error, count } = await vehicleQuery

      if (error) throw error

      const stats = {
        total: count || 0,
        compliant: data?.filter(v => v.total_breaches === 0).length || 0,
        // Exclude homeless vehicles from breach count – they are breach-exempt under the FC Act
        breaches: data?.filter(v => v.total_breaches > 0 && !isHomelessForUi(v.homeless_status)).length || 0,
        selfContained: data?.filter(v => v.self_contained).length || 0,
        homeless: data?.filter(v => isHomelessForUi(v.homeless_status)).length || 0,
        exempt: data?.filter(v => v.is_exempt).length || 0,
      }

      return stats
    },
  })
}

export function useUpdateVehicleDetails() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      plateNumber,
      details,
    }: {
      plateNumber: string
      details: { vehicle_make: string; vehicle_model: string; vehicle_year: number | null; vehicle_color: string }
    }) => {
      const { error } = await (supabase.from('canonical_vehicles') as any)
        .update({
          vehicle_make: details.vehicle_make,
          vehicle_model: details.vehicle_model,
          vehicle_year: details.vehicle_year ?? null,
          vehicle_color: details.vehicle_color,
        })
        .eq('plate_number', plateNumber)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      toast.success('Vehicle details enrichment complete')
    },
    onError: () => {
      toast.error('Failed to update vehicle data')
    },
  })
}

export function useToggleVehicleFlag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ plateNumber, newFlagged }: { plateNumber: string; newFlagged: boolean }) => {
      const { error } = await (supabase.from('canonical_vehicles') as any)
        .update({ is_flagged: newFlagged, flagged_at: newFlagged ? new Date().toISOString() : null })
        .eq('plate_number', plateNumber)
      if (error) throw error
      return { plateNumber, newFlagged }
    },
    onSuccess: ({ plateNumber, newFlagged }) => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      toast.success(newFlagged ? `${plateNumber} flagged` : `${plateNumber} unflagged`)
    },
    onError: () => {
      toast.error('Failed to update flag')
    },
  })
}
