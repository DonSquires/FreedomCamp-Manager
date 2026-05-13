/**
 * Patrol module hooks
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { Patrol, PatrolFilter } from './types'

export function usePatrols(filter?: PatrolFilter) {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['patrols', user?.id, filter],
    queryFn: async (): Promise<Patrol[]> => {
      if (!user) throw new Error('Not authenticated')

      let query = supabase
        .from('patrols')
        .select(
          `
          id, organization_id, assigned_to, zone_id, status,
          scheduled_start_time, scheduled_end_time, 
          started_at, ended_at, duration_minutes,
          notes, created_at, updated_at,
          user_profiles!assigned_to(first_name,last_name),
          zones!zone_id(name)
        `
        )
        .eq('organization_id', user.organization_id)
        .order('scheduled_start_time', { ascending: false })

      // Apply filters
      if (filter?.status) query = query.eq('status', filter.status)
      if (filter?.assigned_to) query = query.eq('assigned_to', filter.assigned_to)
      if (filter?.zone_id) query = query.eq('zone_id', filter.zone_id)
      if (filter?.date_from) query = query.gte('scheduled_start_time', filter.date_from)
      if (filter?.date_to) query = query.lte('scheduled_start_time', filter.date_to)

      const { data, error } = await query.limit(100)

      if (error) throw error

      return (data || []).map((row: any) => ({
        id: row.id,
        organization_id: row.organization_id,
        assigned_to: row.assigned_to,
        officer_name: row.user_profiles ? `${row.user_profiles.first_name || ''} ${row.user_profiles.last_name || ''}`.trim() || 'Unassigned' : 'Unassigned',
        zone_id: row.zone_id,
        zone_name: row.zones?.name || 'No Zone',
        status: row.status,
        scheduled_start_time: row.scheduled_start_time,
        scheduled_end_time: row.scheduled_end_time,
        started_at: row.started_at,
        ended_at: row.ended_at,
        duration_minutes: row.duration_minutes,
        notes: row.notes,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))
    },
    staleTime: 30000,
  })
}

export function usePatrolDetail(patrolId: string) {
  const { user } = useAuthStore()

  return useQuery({
    queryKey: ['patrol-detail', patrolId],
    queryFn: async (): Promise<Patrol | null> => {
      if (!user || !patrolId) return null

      const { data, error } = await supabase
        .from('patrols')
        .select(
          `
          id, organization_id, assigned_to, zone_id, status,
          scheduled_start_time, scheduled_end_time,
          started_at, ended_at, duration_minutes,
          notes, created_at, updated_at,
          user_profiles!assigned_to(first_name,last_name),
          zones!zone_id(name)
        `
        )
        .eq('id', patrolId)
        .eq('organization_id', user.organization_id)
        .single()

      if (error) throw error
      if (!data) return null

      return {
        id: data.id,
        organization_id: data.organization_id,
        assigned_to: data.assigned_to,
          officer_name: data.user_profiles ? `${data.user_profiles.first_name || ''} ${data.user_profiles.last_name || ''}`.trim() : 'Unassigned',
        zone_id: data.zone_id,
        zone_name: data.zones?.name || 'No Zone',
        status: data.status,
        scheduled_start_time: data.scheduled_start_time,
        scheduled_end_time: data.scheduled_end_time,
        started_at: data.started_at,
        ended_at: data.ended_at,
        duration_minutes: data.duration_minutes,
        notes: data.notes,
        created_at: data.created_at,
        updated_at: data.updated_at,
      }
    },
    staleTime: 30000,
    enabled: !!patrolId && !!user,
  })
}

export function useCreatePatrol() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (patrol: {
      zone_id: string
      patrol_date: string
      shift: string
      scheduled_start_time?: string | null
      scheduled_end_time?: string | null
      assigned_to?: string | null
      notes?: string | null
      description?: string | null
      priority?: string | null
    }) => {
      if (!user?.organization_id) {
        throw new Error('No organization available')
      }

      const { data, error } = await supabase
        .from('patrols')
        .insert({
          organization_id: user.organization_id,
          zone_id: patrol.zone_id,
          patrol_date: patrol.patrol_date,
          shift: patrol.shift,
          scheduled_start_time: patrol.scheduled_start_time ?? null,
          scheduled_end_time: patrol.scheduled_end_time ?? null,
          assigned_to: patrol.assigned_to ?? null,
          notes: patrol.notes ?? null,
          description: patrol.description ?? null,
          priority: patrol.priority ?? 'normal',
          status: 'scheduled',
        })
        .select('id')
        .single()

      if (error) throw error

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patrols'] })
      toast.success('Patrol scheduled')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to schedule patrol')
    },
  })
}

export function useUpdatePatrolStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ patrolId, status }: { patrolId: string; status: string }) => {
      const { error } = await supabase
        .from('patrols')
        .update({ status })
        .eq('id', patrolId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patrols'] })
      queryClient.invalidateQueries({ queryKey: ['patrol-detail'] })
    },
  })
}
