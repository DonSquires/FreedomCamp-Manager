import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { Patrol } from '@/types'

interface UsePatrolsOptions {
  organizationId?: string | null
  officerId?: string | null
  status?: 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'all'
}

export function usePatrols(options: UsePatrolsOptions = {}) {
  const { organizationId, officerId, status = 'all' } = options

  return useQuery({
    queryKey: ['patrols', organizationId, officerId, status],
    queryFn: async () => {
      let query = supabase
        .from('patrols')
        .select(`
          *,
          officer:user_profiles!patrols_officer_id_fkey(full_name),
          zone:zones(name)
        `)
        .order('started_at', { ascending: false })

      if (organizationId) {
        query = query.eq('organization_id', organizationId)
      }

      if (officerId) {
        query = query.eq('officer_id', officerId)
      }

      if (status !== 'all') {
        query = query.eq('status', status)
      }

      const { data, error } = await query.limit(50)

      if (error) throw error
      return data as Patrol[]
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
          officer:user_profiles!patrols_officer_id_fkey(full_name),
          zone:zones(name)
        `)
        .eq('id', patrolId)
        .single()

      if (error) throw error
      return data as Patrol
    },
    enabled: !!patrolId,
  })
}

export function useStartPatrol() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (patrolId: string) => {
      const { error } = await supabase
        .from('patrols')
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
    mutationFn: async (patrolId: string) => {
      const { error } = await supabase
        .from('patrols')
        .update({ 
          status: 'completed',
          ended_at: new Date().toISOString()
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
      let query = supabase
        .from('patrols')
        .select('status', { count: 'exact' })

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
      }

      return stats
    },
  })
}
