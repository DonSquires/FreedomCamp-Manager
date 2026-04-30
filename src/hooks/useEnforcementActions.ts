/**
 * Custom Hook: useEnforcementActions
 * Enforcement workflow management (warnings → notices → tows)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface EnforcementAction {
  id: string
  organization_id: string
  zone_id: string
  plate_number: string | null
  action_type: 'warning' | 'notice_to_vacate' | 'tow_request' | 'referral'
  status: 'pending' | 'assigned' | 'completed' | 'cancelled'
  notes: string | null
  created_at: string
  assigned_to: string | null
  assigned_at: string | null
  assigned_by: string | null
  completed_by: string | null
  completed_at: string | null
  completion_outcome: string | null
  completion_notes: string | null
  observation_id: string | null
  breach_status: string
}

interface CreateActionInput {
  zone_id: string
  plate_number?: string
  action_type: 'warning' | 'notice_to_vacate' | 'tow_request' | 'referral'
  observation_id?: string
  notes?: string
}

interface AssignActionInput {
  id: string
  assigned_to: string
}

interface CompleteActionInput {
  id: string
  outcome: 'complied' | 'escalated' | 'cancelled'
  notes?: string
}

export function useEnforcementActions(options?: {
  organizationId?: string
  zoneId?: string
  actionType?: string
  status?: string
  assignedTo?: string
  dateFrom?: string
  dateTo?: string
}) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Fetch enforcement actions
  const query = useQuery({
    queryKey: ['enforcement-actions', options],
    queryFn: async () => {
      let query = supabase
        .from('enforcement_actions')
        .select(`
          *,
          zone:zones(name),
          created_by_user:user_profiles!enforcement_actions_created_by_fkey(first_name, last_name),
          assigned_user:user_profiles!enforcement_actions_assigned_to_fkey(first_name, last_name),
          completed_user:user_profiles!enforcement_actions_completed_by_fkey(first_name, last_name)
        `)
        .order('created_at', { ascending: false })

      // Organization scoping
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (options?.organizationId) {
        query = query.eq('organization_id', options.organizationId)
      }

      // Filters
      if (options?.zoneId) {
        query = query.eq('zone_id', options.zoneId)
      }
      if (options?.actionType && options.actionType !== 'all') {
        query = query.eq('action_type', options.actionType)
      }
      if (options?.status && options.status !== 'all') {
        query = query.eq('status', options.status)
      }
      if (options?.assignedTo) {
        query = query.eq('assigned_to', options.assignedTo)
      }
      if (options?.dateFrom) {
        query = query.gte('created_at', options.dateFrom)
      }
      if (options?.dateTo) {
        query = query.lte('created_at', options.dateTo)
      }

      const { data, error } = await query

      if (error) {
        toast.error('Failed to load enforcement actions')
        throw error
      }

      return data as EnforcementAction[]
    },
  })

  // Create action mutation
  const createAction = useMutation({
    mutationFn: async (input: CreateActionInput) => {
      const { data, error } = await (supabase
        .from('enforcement_actions') as any)
        .insert({
          organization_id: user?.organization_id,
          created_by: user?.id,
          zone_id: input.zone_id,
          plate_number: input.plate_number,
          action_type: input.action_type,
          observation_id: input.observation_id,
          notes: input.notes,
          status: 'pending',
    onError: (err: any) => {
      console.error(err)
      toast.error(err?.message || 'Operation failed')
    },
        })
        .select()
        .single()

      if (error) {
        toast.error('Failed to create enforcement action')
        throw error
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enforcement-actions'] })
      toast.success('Enforcement action created')
    },
  })

  // Assign action mutation
  const assignAction = useMutation({
    mutationFn: async ({ id, assigned_to }: AssignActionInput) => {
      const { error } = await supabase.from('enforcement_actions')
        .update({
          assigned_to,
          assigned_at: new Date().toISOString(),
          assigned_by: user?.id,
          status: 'assigned',
    onError: (err: any) => {
      console.error(err)
      toast.error(err?.message || 'Operation failed')
    },
        })
        .eq('id', id)

      if (error) {
        toast.error('Failed to assign action')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enforcement-actions'] })
      toast.success('Action assigned successfully')
    },
  })

  // Assign to self mutation
  const assignToSelf = useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error('User not authenticated')

      const { error } = await supabase.from('enforcement_actions')
        .update({
          assigned_to: user.id,
          assigned_at: new Date().toISOString(),
          assigned_by: user.id,
          status: 'assigned',
    onError: (err: any) => {
      console.error(err)
      toast.error(err?.message || 'Operation failed')
    },
        })
        .eq('id', id)

      if (error) {
        toast.error('Failed to assign to self')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enforcement-actions'] })
      toast.success('Action assigned to you')
    },
  })

  // Complete action mutation
  const completeAction = useMutation({
    mutationFn: async ({ id, outcome, notes }: CompleteActionInput) => {
      const { error } = await supabase.from('enforcement_actions')
        .update({
          status: 'completed',
          completion_outcome: outcome,
          completion_notes: notes,
          completed_by: user?.id,
          completed_at: new Date().toISOString(),
    onError: (err: any) => {
      console.error(err)
      toast.error(err?.message || 'Operation failed')
    },
        })
        .eq('id', id)

      if (error) {
        toast.error('Failed to complete action')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enforcement-actions'] })
      toast.success('Action completed')
    },
  })

  return {
    actions: query.data,
    isLoading: query.isLoading,
    error: query.error,
    createAction,
    assignAction,
    assignToSelf,
    completeAction,
  }
}

// Hook for officer's assigned actions
export function useMyAssignedActions() {
  const { user } = useAuthStore()

  return useEnforcementActions({
    assignedTo: user?.id,
    status: 'assigned',
  })
}
