import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

export interface PatrolRouteInstance {
  id: string
  organization_id: string
  roster_shift_id: string | null
  patrol_id: string | null
  patrol_route_id: string
  patrol_route_name?: string | null
  officer_id: string | null
  planning_mode: 'baseline' | 'randomized' | 'dispatch_replan'
  plan_status: 'planned' | 'in_progress' | 'paused' | 'completed' | 'cancelled' | 'superseded'
  planned_start_time: string | null
  planned_end_time: string | null
  predicted_duration_minutes: number | null
  created_at: string
  updated_at: string
}

export interface PatrolRouteInstanceStop {
  id: string
  route_instance_id: string
  checkpoint_id: string | null
  zone_id: string | null
  stop_name: string
  is_mandatory: boolean
  sequence_no: number
  planned_arrival_window_start: string | null
  planned_arrival_window_end: string | null
  visit_status: 'pending' | 'arrived' | 'completed' | 'skipped' | 'failed'
}

export function usePatrolRouteInstances(filters?: { rosterShiftId?: string; patrolId?: string }) {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['patrol-route-instances', user?.organization_id, filters],
    queryFn: async () => {
      if (!user?.organization_id) return []

      let query = (supabase as any)
        .from('patrol_route_instances')
        .select('id, organization_id, roster_shift_id, patrol_id, patrol_route_id, officer_id, planning_mode, plan_status, planned_start_time, planned_end_time, predicted_duration_minutes, created_at, updated_at')
        .eq('organization_id', user.organization_id)
        .order('created_at', { ascending: false })

      if (filters?.rosterShiftId) query = query.eq('roster_shift_id', filters.rosterShiftId)
      if (filters?.patrolId) query = query.eq('patrol_id', filters.patrolId)

      const { data, error } = await query
      if (error) throw error
      return (data || []) as PatrolRouteInstance[]
    },
    enabled: !!user?.organization_id,
  })
}

export function usePatrolRouteInstanceStops(routeInstanceId?: string) {
  return useQuery({
    queryKey: ['patrol-route-instance-stops', routeInstanceId],
    queryFn: async () => {
      if (!routeInstanceId) return []
      const { data, error } = await (supabase as any)
        .from('patrol_route_instance_stops')
        .select('id, route_instance_id, checkpoint_id, zone_id, stop_name, is_mandatory, sequence_no, planned_arrival_window_start, planned_arrival_window_end, visit_status')
        .eq('route_instance_id', routeInstanceId)
        .order('sequence_no')
      if (error) throw error
      return (data || []) as PatrolRouteInstanceStop[]
    },
    enabled: !!routeInstanceId,
  })
}

export function useOfficerActiveRouteInstance() {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['officer-active-patrol-route-instance', user?.id, user?.organization_id],
    queryFn: async () => {
      if (!user?.id || !user?.organization_id) return null

      const { data, error } = await (supabase as any)
        .from('patrol_route_instances')
        .select(`
          id,
          organization_id,
          roster_shift_id,
          patrol_id,
          patrol_route_id,
          officer_id,
          planning_mode,
          plan_status,
          planned_start_time,
          planned_end_time,
          predicted_duration_minutes,
          created_at,
          updated_at,
          patrol_routes(route_name)
        `)
        .eq('organization_id', user.organization_id)
        .eq('officer_id', user.id)
        .in('plan_status', ['planned', 'in_progress', 'paused'])
        .order('created_at', { ascending: false })
        .limit(1)

      if (error) throw error

      const row = (data?.[0] ?? null) as any
      if (!row) return null

      return {
        id: row.id,
        organization_id: row.organization_id,
        roster_shift_id: row.roster_shift_id,
        patrol_id: row.patrol_id,
        patrol_route_id: row.patrol_route_id,
        patrol_route_name: row.patrol_routes?.route_name ?? null,
        officer_id: row.officer_id,
        planning_mode: row.planning_mode,
        plan_status: row.plan_status,
        planned_start_time: row.planned_start_time,
        planned_end_time: row.planned_end_time,
        predicted_duration_minutes: row.predicted_duration_minutes,
        created_at: row.created_at,
        updated_at: row.updated_at,
      } as PatrolRouteInstance
    },
    enabled: !!user?.id && !!user?.organization_id,
    refetchInterval: 30_000,
  })
}

export function useUpdatePatrolRouteStopStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      stopId,
      routeInstanceId,
      status,
    }: {
      stopId: string
      routeInstanceId: string
      status: 'arrived' | 'completed'
    }) => {
      const now = new Date().toISOString()
      const updatePayload: Record<string, unknown> = { visit_status: status }

      if (status === 'arrived') {
        updatePayload.actual_arrival_at = now
      }
      if (status === 'completed') {
        updatePayload.actual_arrival_at = now
        updatePayload.actual_departure_at = now
      }

      const { error: updateStopError } = await (supabase as any)
        .from('patrol_route_instance_stops')
        .update(updatePayload)
        .eq('id', stopId)
        .eq('route_instance_id', routeInstanceId)

      if (updateStopError) throw updateStopError

      const { data: stops, error: fetchStopsError } = await (supabase as any)
        .from('patrol_route_instance_stops')
        .select('visit_status')
        .eq('route_instance_id', routeInstanceId)

      if (fetchStopsError) throw fetchStopsError

      const stopRows = (stops ?? []) as Array<{ visit_status: string }>
      const hasOpenStops = stopRows.some((row) => ['pending', 'arrived'].includes(row.visit_status))

      if (hasOpenStops) {
        const { error: progressError } = await (supabase as any)
          .from('patrol_route_instances')
          .update({ plan_status: 'in_progress' })
          .eq('id', routeInstanceId)
          .in('plan_status', ['planned', 'paused', 'in_progress'])

        if (progressError) throw progressError
      } else {
        const { error: completeError } = await (supabase as any)
          .from('patrol_route_instances')
          .update({
            plan_status: 'completed',
            actual_end_time: now,
          })
          .eq('id', routeInstanceId)

        if (completeError) throw completeError
      }

      return { status }
    },
    onSuccess: ({ status }) => {
      queryClient.invalidateQueries({ queryKey: ['officer-active-patrol-route-instance'] })
      queryClient.invalidateQueries({ queryKey: ['patrol-route-instances'] })
      queryClient.invalidateQueries({ queryKey: ['patrol-route-instance-stops'] })
      toast.success(status === 'arrived' ? 'Stop marked as arrived' : 'Stop completed')
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to update stop status')
    },
  })
}

export function useGeneratePatrolRouteInstance() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ rosterShiftId, forceRegenerate = false }: { rosterShiftId: string; forceRegenerate?: boolean }) => {
      const { data, error } = await (supabase as any)
        .rpc('generate_patrol_route_instance', {
          p_roster_shift_id: rosterShiftId,
          p_force_regenerate: forceRegenerate,
          p_created_by: null,
        })

      if (error) throw error
      return data as { status: string; route_instance_id: string; stops_created?: number }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patrol-route-instances'] })
      queryClient.invalidateQueries({ queryKey: ['patrol-route-instance-stops'] })
      toast.success('Patrol route plan generated')
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to generate patrol route plan')
    },
  })
}
