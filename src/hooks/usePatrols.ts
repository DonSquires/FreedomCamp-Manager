import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'
import { useOperationalOrganization } from '@/hooks/useOperationalOrganization'

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
  const { operationalOrganizationId } = useOperationalOrganization()
  const effectiveOrganizationId = organizationId ?? operationalOrganizationId

  return useQuery({
    queryKey: ['patrols', effectiveOrganizationId, zoneId, officerId, status],
    queryFn: async () => {
      let query = (supabase
        .from('patrols') as any)
        .select(`
          *,
          zone:zones(name),
          officer:user_profiles!patrols_assigned_to_fkey(first_name, last_name),
          patrol_route:patrol_routes!patrol_route_id(route_name)
        `)
        .order('created_at', { ascending: false })

      if (effectiveOrganizationId) {
        query = query.eq('organization_id', effectiveOrganizationId)
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
  const { operationalOrganizationId } = useOperationalOrganization()

  return useQuery({
    queryKey: ['patrol', patrolId, operationalOrganizationId],
    queryFn: async () => {
      let query = supabase
        .from('patrols')
        .select(`
          *,
          zone:zones(name),
          officer:user_profiles!patrols_officer_id_fkey(first_name, last_name, email)
        `)
        .eq('id', patrolId)

      if (operationalOrganizationId) {
        query = query.eq('organization_id', operationalOrganizationId)
      }

      const { data, error } = await query.single()

      if (error) throw error
      return data as unknown as PatrolWithDetails
    },
    enabled: !!patrolId,
  })
}

export function useStartPatrol() {
  const queryClient = useQueryClient()
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async (patrolId: string) => {
      let query = supabase
        .from('patrols')
        .update({ 
          status: 'in_progress',
          started_at: new Date().toISOString(),
          actual_start_time: new Date().toISOString(),
        })
        .eq('id', patrolId)

      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      }

      const { error } = await query

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
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async ({ patrolId, vehiclesChecked, breachesFound }: {
      patrolId: string
      vehiclesChecked: number
      breachesFound: number
    }) => {
      let query = supabase
        .from('patrols')
        .update({ 
          status: 'completed',
          ended_at: new Date().toISOString(),
          actual_end_time: new Date().toISOString(),
          vehicles_checked: vehiclesChecked,
          breaches_found: breachesFound
        })
        .eq('id', patrolId)

      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      }

      const { error } = await query

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
  const { operationalOrganizationId } = useOperationalOrganization()
  const effectiveOrganizationId = organizationId ?? operationalOrganizationId

  return useQuery({
    queryKey: ['patrol-stats', effectiveOrganizationId],
    queryFn: async () => {
      let query = supabase.from('patrols')
        .select('status, vehicles_checked, breaches_found', { count: 'exact' })

      if (effectiveOrganizationId) {
        query = query.eq('organization_id', effectiveOrganizationId)
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
  patrol_route_id?: string | null
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

      const { data: patrol, error } = await supabase.from('patrols')
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
          patrol_route_id: params.patrol_route_id ?? null,
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
          visit_order: idx,
        }))
        const { error: zoneError } = await supabase.from('patrol_schedule_zones')
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
  const { user } = useAuthStore()

  return useMutation({
    mutationFn: async (patrolId: string) => {
      let query = supabase
        .from('patrols')
        .update({ status: 'cancelled' })
        .eq('id', patrolId)

      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      }

      const { error } = await query
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

interface PatrolKPIBaseRow {
  id: string
  patrol_date: string | null
  status: Patrol['status']
  duration_minutes: number | null
  vehicles_checked: number | null
  breaches_found: number | null
  scheduled_start_time: string | null
  actual_start_time: string | null
  actual_end_time: string | null
  assigned_to: string | null
  zone_id: string | null
  officer: {
    first_name: string | null
    last_name: string | null
  } | null
}

function toIsoDate(value?: string | null) {
  return value?.split('T')[0] ?? null
}

function roundTo(value: number, decimals = 1) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function diffMinutes(start?: string | null, end?: string | null) {
  if (!start || !end) return null
  const startTime = new Date(start).getTime()
  const endTime = new Date(end).getTime()
  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime < startTime) return null
  return Math.round((endTime - startTime) / 60000)
}

function buildPatrolKPIFallback(
  rows: PatrolKPIBaseRow[],
  from: string | undefined,
  to: string | undefined,
): PatrolKPIs {
  const totalPatrols = rows.length
  const completed = rows.filter((row) => row.status === 'completed').length
  const scheduled = rows.filter((row) => row.status === 'scheduled').length
  const inProgress = rows.filter((row) => row.status === 'in_progress').length
  const cancelled = rows.filter((row) => row.status === 'cancelled').length
  const durationValues = rows
    .map((row) => row.duration_minutes ?? diffMinutes(row.actual_start_time, row.actual_end_time))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
  const totalDurationMinutes = durationValues.reduce((sum, value) => sum + value, 0)
  const totalVehiclesChecked = rows.reduce((sum, row) => sum + (row.vehicles_checked ?? 0), 0)
  const totalBreachesFound = rows.reduce((sum, row) => sum + (row.breaches_found ?? 0), 0)
  const totalSiteVisits = rows.filter((row) => !!row.zone_id).length
  const onTimeStarts = rows.filter((row) => {
    if (!row.scheduled_start_time || !row.actual_start_time) return false
    return new Date(row.actual_start_time).getTime() <= new Date(row.scheduled_start_time).getTime()
  }).length
  const lateStarts = rows.filter((row) => {
    if (!row.scheduled_start_time || !row.actual_start_time) return false
    return new Date(row.actual_start_time).getTime() > new Date(row.scheduled_start_time).getTime()
  }).length

  const officerMap = new Map<string, PatrolKPIs['officers'][number]>()
  for (const row of rows) {
    if (!row.assigned_to) continue
    const existing = officerMap.get(row.assigned_to) ?? {
      officer_id: row.assigned_to,
      officer_name: [row.officer?.first_name, row.officer?.last_name].filter(Boolean).join(' ') || 'Unassigned officer',
      total_patrols: 0,
      completed_patrols: 0,
      avg_duration_minutes: 0,
      vehicles_checked: 0,
      breaches_found: 0,
      shift_hours: 0,
      site_visits: 0,
    }

    existing.total_patrols += 1
    if (row.status === 'completed') existing.completed_patrols += 1
    existing.vehicles_checked += row.vehicles_checked ?? 0
    existing.breaches_found += row.breaches_found ?? 0
    if (row.zone_id) existing.site_visits += 1

    const duration = row.duration_minutes ?? diffMinutes(row.actual_start_time, row.actual_end_time)
    if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) {
      existing.avg_duration_minutes += duration
      existing.shift_hours += duration / 60
    }

    officerMap.set(row.assigned_to, existing)
  }

  const officers = Array.from(officerMap.values())
    .map((officer) => ({
      ...officer,
      avg_duration_minutes: officer.total_patrols > 0
        ? roundTo(officer.avg_duration_minutes / officer.total_patrols, 0)
        : 0,
      shift_hours: roundTo(officer.shift_hours, 1),
    }))
    .sort((left, right) => right.total_patrols - left.total_patrols)

  return {
    period_from: from ?? '',
    period_to: to ?? '',
    total_patrols: totalPatrols,
    completed,
    scheduled,
    in_progress: inProgress,
    cancelled,
    completion_rate: totalPatrols > 0 ? roundTo((completed / totalPatrols) * 100, 1) : 0,
    avg_duration_minutes: durationValues.length > 0 ? roundTo(totalDurationMinutes / durationValues.length, 0) : 0,
    total_vehicles_checked: totalVehiclesChecked,
    total_breaches_found: totalBreachesFound,
    total_site_visits: totalSiteVisits,
    avg_site_visit_minutes: totalSiteVisits > 0 ? roundTo(totalDurationMinutes / totalSiteVisits, 0) : 0,
    total_shift_hours: roundTo(totalDurationMinutes / 60, 1),
    on_time_starts: onTimeStarts,
    late_starts: lateStarts,
    punctuality_rate: onTimeStarts + lateStarts > 0 ? roundTo((onTimeStarts / (onTimeStarts + lateStarts)) * 100, 1) : 0,
    officers,
  }
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

      let fallbackQuery = (supabase.from('patrols') as any)
        .select(`
          id,
          patrol_date,
          status,
          duration_minutes,
          vehicles_checked,
          breaches_found,
          scheduled_start_time,
          actual_start_time,
          actual_end_time,
          assigned_to,
          zone_id,
          officer:user_profiles!patrols_assigned_to_fkey(first_name, last_name)
        `)
        .eq('organization_id', user.organization_id)
        .order('patrol_date', { ascending: false })

      const fromDate = toIsoDate(options?.from)
      const toDate = toIsoDate(options?.to)

      if (fromDate) {
        fallbackQuery = fallbackQuery.gte('patrol_date', fromDate)
      }

      if (toDate) {
        fallbackQuery = fallbackQuery.lte('patrol_date', toDate)
      }

      if (options?.officerId) {
        fallbackQuery = fallbackQuery.eq('assigned_to', options.officerId)
      }

      const { data: fallbackRows, error: fallbackError } = await fallbackQuery.limit(1000)

      if (fallbackError) throw fallbackError
      return buildPatrolKPIFallback(
        (fallbackRows ?? []) as PatrolKPIBaseRow[],
        options?.from,
        options?.to,
      )
    },
    enabled: !!user?.organization_id,
  })
}
