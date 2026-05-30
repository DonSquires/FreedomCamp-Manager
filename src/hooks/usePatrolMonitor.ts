import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

export function useLivePatrols(options: { orgId?: string; zoneFilter?: string; dateFrom?: string; dateTo?: string }) {
  const { user } = useAuthStore()
  const { orgId, zoneFilter, dateFrom, dateTo } = options

  return useQuery({
    queryKey: ['live-patrols', orgId, zoneFilter, dateFrom, dateTo],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]

      let patrolsData: any[] | null = null
      let queryError: any = null

      {
        let query = (supabase.from('patrols') as any)
          .select(`
            id,
            status,
            patrol_date,
            shift,
            notes,
            organization_id,
            assigned_to,
            created_at,
            updated_at,
            zone:zones(id, name),
            officer:user_profiles!patrols_assigned_to_fkey(id, first_name, last_name, phone),
            patrol_route:patrol_routes!patrol_route_id(route_name)
          `)
          .in('status', ['in_progress', 'scheduled', 'completed'])
          .order('created_at', { ascending: false })

        if (user?.role !== 'master' && user?.role !== 'grand_master' && user?.organization_id) {
          query = query.eq('organization_id', user.organization_id)
        } else if (orgId) {
          query = query.eq('organization_id', orgId)
        }

        if (zoneFilter) {
          query = query.eq('zone_id', zoneFilter)
        }

        if (dateFrom) {
          query = query.gte('patrol_date', dateFrom)
        } else {
          query = query.gte('patrol_date', today)
        }
        if (dateTo) {
          query = query.lte('patrol_date', dateTo)
        } else {
          query = query.lte('patrol_date', today)
        }

        const result = await query
        if (!result.error) {
          patrolsData = result.data
        } else {
          queryError = result.error
        }
      }

      if (queryError) {
        let query = (supabase.from('patrols') as any)
          .select(`
            id,
            status,
            patrol_date,
            shift,
            notes,
            organization_id,
            assigned_to,
            created_at,
            updated_at,
            zone_id
          `)
          .in('status', ['in_progress', 'scheduled', 'completed'])
          .order('created_at', { ascending: false })

        if (user?.role !== 'master' && user?.role !== 'grand_master' && user?.organization_id) {
          query = query.eq('organization_id', user.organization_id)
        } else if (orgId) {
          query = query.eq('organization_id', orgId)
        }

        if (zoneFilter) {
          query = query.eq('zone_id', zoneFilter)
        }

        if (dateFrom) {
          query = query.gte('patrol_date', dateFrom)
        } else {
          query = query.gte('patrol_date', today)
        }
        if (dateTo) {
          query = query.lte('patrol_date', dateTo)
        } else {
          query = query.lte('patrol_date', today)
        }

        const result = await query
        if (result.error) throw result.error
        patrolsData = result.data

        const zoneIds = [...new Set((patrolsData ?? []).filter((p: any) => p.zone_id && !p.zone).map((p: any) => p.zone_id))]
        const officerIds = [...new Set((patrolsData ?? []).filter((p: any) => p.assigned_to && !p.officer).map((p: any) => p.assigned_to))]

        let zoneMap: Record<string, any> = {}
        let officerMap: Record<string, any> = {}

        if (zoneIds.length > 0) {
          const { data: zones } = await (supabase.from('zones') as any).select('id, name').in('id', zoneIds)
          zoneMap = Object.fromEntries((zones ?? []).map((z: any) => [z.id, z]))
        }
        if (officerIds.length > 0) {
          const { data: officers } = await (supabase.from('user_profiles') as any)
            .select('id, first_name, last_name, phone')
            .in('id', officerIds)
          officerMap = Object.fromEntries((officers ?? []).map((o: any) => [o.id, o]))
        }

        for (const patrol of patrolsData ?? []) {
          if (patrol.zone_id && !patrol.zone) {
            patrol.zone = zoneMap[patrol.zone_id] || { id: patrol.zone_id, name: 'Unknown Zone' }
          }
          if (patrol.assigned_to && !patrol.officer) {
            patrol.officer = officerMap[patrol.assigned_to] || { id: patrol.assigned_to, first_name: 'Unknown', last_name: 'Officer', phone: null }
          }
        }
      }

      if (!patrolsData || patrolsData.length === 0) return []

      const validPatrols = (patrolsData ?? []).filter((p: any) => p.officer?.id)

      const enrichedPatrols = await Promise.all(
        validPatrols.map(async (patrol: any) => {
          const { count: vehiclesChecked } = await (supabase.from('observations') as any)
            .select('*', { count: 'exact', head: true })
            .eq('recorded_by', patrol.officer.id)
            .gte('recorded_at', patrol.created_at || today)

          const { data: latestActivity } = await (supabase.from('officer_activity_log') as any)
            .select('gps_latitude, gps_longitude, recorded_at')
            .eq('user_id', patrol.officer.id)
            .gte('recorded_at', patrol.created_at || today)
            .order('recorded_at', { ascending: false })
            .limit(1)
            .single()

          const startTime = patrol.status === 'in_progress' ? new Date(patrol.updated_at || patrol.created_at) : new Date()
          const now = new Date()
          const durationMs = now.getTime() - startTime.getTime()
          const durationMinutes = Math.floor(durationMs / 60000)

          return {
            ...(patrol as any),
            _vehicles_checked: vehiclesChecked || 0,
            _duration_minutes: durationMinutes,
            _last_gps_update: (latestActivity as any)?.recorded_at || null,
            _last_gps_lat: (latestActivity as any)?.gps_latitude || null,
            _last_gps_lng: (latestActivity as any)?.gps_longitude || null,
          }
        })
      )

      return enrichedPatrols
    },
    refetchInterval: 15000,
  })
}

export function useActiveOfficerMonitor(options: { orgId?: string; patrols?: any[]; patrolsLoading?: boolean }) {
  const { user } = useAuthStore()
  const { orgId, patrols, patrolsLoading } = options

  return useQuery({
    queryKey: ['active-officers-welfare', orgId, patrols?.map((p: any) => p.officer.id).join(',')],
    queryFn: async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

      let query = (supabase.from('user_profiles') as any)
        .select('id, first_name, last_name, phone, organization_id, last_gps_latitude, last_gps_longitude, last_gps_accuracy, last_gps_update')
        .in('role', ['officer', 'admin_officer'])
        .eq('is_active', true)
        .not('last_gps_update', 'is', null)
        .gte('last_gps_update', twoHoursAgo)
        .order('last_gps_update', { ascending: false })

      if (user?.role !== 'master' && user?.role !== 'grand_master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (orgId) {
        query = query.eq('organization_id', orgId)
      }

      const { data: officerRows, error } = await query
      if (error) throw error
      if (!officerRows || officerRows.length === 0) return []

      const patrolOfficerIds = new Set((patrols ?? []).map((p: any) => p.officer.id))

      const today = new Date().toISOString().split('T')[0]
      const enriched = await Promise.all(
        (officerRows as any[]).map(async (o: any) => {
          const { count: scans } = await (supabase.from('observations') as any)
            .select('*', { count: 'exact', head: true })
            .eq('recorded_by', o.id)
            .gte('recorded_at', today)

          const { data: welfareAlerts } = await (supabase.from('officer_welfare_alerts') as any)
            .select('id')
            .eq('officer_id', o.id)
            .eq('status', 'pending')
            .limit(1)

          const hasAlert = (welfareAlerts ?? []).length > 0

          let welfareStatus: 'ok' | 'warning' | 'alert' = 'ok'
          if (hasAlert) {
            welfareStatus = 'alert'
          } else if (o.last_gps_update) {
            const minutesSinceGps = Math.floor((Date.now() - new Date(o.last_gps_update).getTime()) / 60000)
            if (minutesSinceGps > 30) welfareStatus = 'warning'
          }

          return {
            id: o.id,
            first_name: o.first_name,
            last_name: o.last_name,
            phone: o.phone,
            organization_id: o.organization_id,
            last_gps_latitude: o.last_gps_latitude,
            last_gps_longitude: o.last_gps_longitude,
            last_gps_accuracy: o.last_gps_accuracy,
            last_gps_update: o.last_gps_update,
            _vehicles_scanned_today: scans ?? 0,
            _welfare_status: welfareStatus,
            _has_patrol: patrolOfficerIds.has(o.id),
          }
        })
      )

      return enriched.filter((o: any) => !o._has_patrol)
    },
    enabled: !patrolsLoading,
    refetchInterval: 30000,
  })
}
