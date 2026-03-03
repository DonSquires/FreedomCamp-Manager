import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
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
