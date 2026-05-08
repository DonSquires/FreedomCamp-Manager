import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { HOMELESS_UI_STATUSES, isHomelessForUi } from '@/lib/homelessStatus'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { toast } from 'sonner'
import type { Vehicle } from '@/types'

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

      const photoColumn = await (async () => {
        const candidates: Array<'photo_url' | 'image_url' | 'photo'> = ['photo_url', 'image_url', 'photo']
        for (const col of candidates) {
          const { error } = await (supabase.from('observations') as any).select(`observation_id, ${col}`).limit(1)
          if (!error) return col
        }
        return null
      })()

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
