import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface Patrol {
  id: string
  officer_id: string
  zone_id: string
  organization_id: string
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  started_at: string | null
  ended_at: string | null
  vehicles_checked: number
  breaches_found: number
  description: string | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  recurrence: 'none' | 'daily' | 'weekly' | 'fortnightly' | 'monthly'
  scheduled_start_time: string | null
  scheduled_end_time: string | null
  actual_start_time: string | null
  actual_end_time: string | null
  duration_minutes: number | null
  shift_id: string | null
  patrol_date: string
  shift: string
  assigned_to: string | null
  notes: string | null
  notification_sent: boolean
  officer_accepted: boolean | null
  officer_declined: boolean
  created_at: string
}

interface PatrolWithDetails extends Patrol {
  zone: {
    name: string
  }
  officer: {
    first_name: string
    last_name: string
  }
}

interface UsePatrolsOptions {
  organizationId?: string | null
  zoneId?: string | null
  officerId?: string | null
  status?: Patrol['status'] | 'all'
}

export function usePatrols(options: UsePatrolsOptions = {}) {
  const { organizationId, zoneId, officerId, status = 'all' } = options

  return useQuery({
    queryKey: ['patrols', organizationId, zoneId, officerId, status],
    queryFn: async () => {
      let query = supabase
        .from('patrols')
        .select(`
          *,
          zone:zones(name),
          officer:user_profiles(first_name, last_name)
        `)
        .order('created_at', { ascending: false })

      if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }

      if (officerId) {
        query = query.eq('officer_id', officerId)
      }

      if (status !== 'all') {
        query = query.eq('status', status)
      }

      const { data, error } = await query.limit(100)

      if (error) throw error
      return data as unknown as PatrolWithDetails[]
    },
  })
}

export function usePatrol(patrolId: string) {
  return useQuery({
    queryKey: ['patrol', patrolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patrols')
        .select(`
          *,
          zone:zones(name),
          officer:user_profiles(first_name, last_name, email)
        `)
        .eq('id', patrolId)
        .single()

      if (error) throw error
      return data as unknown as PatrolWithDetails
    },
    enabled: !!patrolId,
  })
}

export function useStartPatrol() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (patrolId: string) => {
      const { error } = await (supabase.from('patrols') as any)
        .update({ 
          status: 'in_progress',
          started_at: new Date().toISOString()
        })
        .eq('id', patrolId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patrols'] })
      toast.success('Patrol started')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to start patrol')
    },
  })
}

export function useCompletePatrol() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ patrolId, vehiclesChecked, breachesFound }: {
      patrolId: string
      vehiclesChecked: number
      breachesFound: number
    }) => {
      const { error } = await (supabase.from('patrols') as any)
        .update({ 
          status: 'completed',
          ended_at: new Date().toISOString(),
          vehicles_checked: vehiclesChecked,
          breaches_found: breachesFound
        })
        .eq('id', patrolId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patrols'] })
      toast.success('Patrol completed')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to complete patrol')
    },
  })
}

export function usePatrolStats(organizationId?: string | null) {
  return useQuery({
    queryKey: ['patrol-stats', organizationId],
    queryFn: async () => {
      let query = (supabase.from('patrols') as any)
        .select('status, vehicles_checked, breaches_found', { count: 'exact' })

      if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      const { data, error, count } = await query

      if (error) throw error

      const stats = {
        total: count || 0,
        scheduled: data?.filter(p => p.status === 'scheduled').length || 0,
        inProgress: data?.filter(p => p.status === 'in_progress').length || 0,
        completed: data?.filter(p => p.status === 'completed').length || 0,
        totalVehiclesChecked: data?.reduce((sum, p) => sum + (p.vehicles_checked || 0), 0) || 0,
        totalBreachesFound: data?.reduce((sum, p) => sum + (p.breaches_found || 0), 0) || 0,
      }

      return stats
    },
  })
}

// ─── Patrol Schedule Management ──────────────────────────────────────────

interface CreateScheduleParams {
  zone_id: string
  patrol_date: string
  shift: string
  assigned_to: string | null
  scheduled_start_time?: string | null
  scheduled_end_time?: string | null
  description?: string | null
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  recurrence?: 'none' | 'daily' | 'weekly' | 'fortnightly' | 'monthly'
  notes?: string | null
  zone_ids?: string[]
}

/** Create a patrol schedule and optionally assign multiple zones */
export function useCreatePatrolSchedule() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: CreateScheduleParams) => {
      if (!user?.organization_id) throw new Error('No organization')

      const { data: patrol, error } = await (supabase.from('patrols') as any)
        .insert({
          organization_id: user.organization_id,
          zone_id: params.zone_id,
          patrol_date: params.patrol_date,
          shift: params.shift,
          assigned_to: params.assigned_to,
          scheduled_start_time: params.scheduled_start_time ?? null,
          scheduled_end_time: params.scheduled_end_time ?? null,
          description: params.description ?? null,
          priority: params.priority ?? 'normal',
          recurrence: params.recurrence ?? 'none',
          notes: params.notes ?? null,
          status: 'scheduled',
        })
        .select('id')
        .single()

      if (error) throw error

      // Insert zone route if multiple zones provided
      if (params.zone_ids && params.zone_ids.length > 0) {
        const rows = params.zone_ids.map((zId, idx) => ({
          patrol_id: patrol.id,
          zone_id: zId,
          visit_order: idx + 1,
        }))
        const { error: zoneError } = await (supabase.from('patrol_schedule_zones') as any)
          .insert(rows)
        if (zoneError) console.error('Failed to insert schedule zones:', zoneError)
      }

      return patrol
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patrols'] })
      queryClient.invalidateQueries({ queryKey: ['patrol-stats'] })
      toast.success('Patrol schedule created')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create patrol schedule')
    },
  })
}

/** Cancel a scheduled patrol */
export function useCancelPatrol() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (patrolId: string) => {
      const { error } = await (supabase.from('patrols') as any)
        .update({ status: 'cancelled' })
        .eq('id', patrolId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patrols'] })
      queryClient.invalidateQueries({ queryKey: ['patrol-stats'] })
      toast.success('Patrol cancelled')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to cancel patrol')
    },
  })
}

// ─── Patrol KPIs ─────────────────────────────────────────────────────────

interface PatrolKPIs {
  period_from: string
  period_to: string
  total_patrols: number
  completed: number
  scheduled: number
  in_progress: number
  cancelled: number
  completion_rate: number
  avg_duration_minutes: number
  total_vehicles_checked: number
  total_breaches_found: number
  total_site_visits: number
  avg_site_visit_minutes: number
  total_shift_hours: number
  on_time_starts: number
  late_starts: number
  punctuality_rate: number
  officers: {
    officer_id: string
    officer_name: string
    total_patrols: number
    completed_patrols: number
    avg_duration_minutes: number
    vehicles_checked: number
    breaches_found: number
    shift_hours: number
    site_visits: number
  }[]
}

/** Fetch patrol KPIs from the server-side RPC */
export function usePatrolKPIs(options?: {
  from?: string
  to?: string
  officerId?: string | null
}) {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['patrol-kpis', user?.organization_id, options],
    queryFn: async () => {
      if (!user?.organization_id) return null

      const params: any = { p_organization_id: user.organization_id }
      if (options?.from) params.p_from = options.from
      if (options?.to) params.p_to = options.to
      if (options?.officerId) params.p_officer_id = options.officerId

      const { data, error } = await (supabase as any).rpc('get_patrol_kpis', params)

      if (error) throw error
      return data as PatrolKPIs
    },
    enabled: !!user?.organization_id,
  })
}
