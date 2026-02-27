/**
 * Custom Hook: useFlaggedVehicles
 * Watchlist vehicles requiring special attention
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface FlaggedVehicle {
  id: string
  organization_id: string
  plate_number: string
  last_known_site: string | null
  date_recorded: string | null
  vehicle_description: string | null
  name_contact: string | null
  confirmed_homeless: boolean
  notes: string | null
  priority: 'low' | 'medium' | 'high' | 'critical'
  is_active: boolean
  created_by: string
  created_at: string
  updated_at: string
  attachments: any[]
  created_by_user: {
    first_name: string
    last_name: string
  }
}

interface CreateFlaggedVehicleInput {
  plate_number: string
  last_known_site?: string
  date_recorded?: string
  vehicle_description?: string
  name_contact?: string
  confirmed_homeless?: boolean
  notes?: string
  priority?: 'low' | 'medium' | 'high' | 'critical'
  attachments?: any[]
}

interface UpdateFlaggedVehicleInput {
  last_known_site?: string
  vehicle_description?: string
  name_contact?: string
  confirmed_homeless?: boolean
  notes?: string
  priority?: 'low' | 'medium' | 'high' | 'critical'
  is_active?: boolean
}

export function useFlaggedVehicles(options?: {
  organizationId?: string
  priority?: string
  isActive?: boolean
  plateNumber?: string
}) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Fetch flagged vehicles
  const query = useQuery({
    queryKey: ['flagged-vehicles', options],
    queryFn: async () => {
      let query = supabase
        .from('flagged_vehicles')
        .select(`
          *,
          created_by_user:user_profiles(first_name, last_name)
        `)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })

      // Organization scoping
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      } else if (options?.organizationId) {
        query = query.eq('organization_id', options.organizationId)
      }

      // Filters
      if (options?.priority) {
        query = query.eq('priority', options.priority)
      }
      if (options?.isActive !== undefined) {
        query = query.eq('is_active', options.isActive)
      }
      if (options?.plateNumber) {
        query = query.ilike('plate_number', `%${options.plateNumber}%`)
      }

      const { data, error } = await query

      if (error) {
        toast.error('Failed to load flagged vehicles')
        throw error
      }

      return data as FlaggedVehicle[]
    },
  })

  // Create flagged vehicle mutation
  const createFlaggedVehicle = useMutation({
    mutationFn: async (input: CreateFlaggedVehicleInput) => {
      const { data, error } = await supabase
        .from('flagged_vehicles')
        .insert({
          organization_id: user?.organization_id,
          created_by: user?.id,
          plate_number: input.plate_number,
          last_known_site: input.last_known_site,
          date_recorded: input.date_recorded,
          vehicle_description: input.vehicle_description,
          name_contact: input.name_contact,
          confirmed_homeless: input.confirmed_homeless || false,
          notes: input.notes,
          priority: input.priority || 'medium',
          attachments: input.attachments || [],
          is_active: true,
        })
        .select()
        .single()

      if (error) {
        toast.error('Failed to flag vehicle')
        throw error
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flagged-vehicles'] })
      toast.success('Vehicle flagged successfully')
    },
  })

  // Update flagged vehicle mutation
  const updateFlaggedVehicle = useMutation({
    mutationFn: async ({ id, ...updates }: UpdateFlaggedVehicleInput & { id: string }) => {
      const { error } = await supabase
        .from('flagged_vehicles')
        .update(updates)
        .eq('id', id)

      if (error) {
        toast.error('Failed to update flagged vehicle')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flagged-vehicles'] })
      toast.success('Flagged vehicle updated')
    },
  })

  // Toggle active status mutation
  const toggleActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('flagged_vehicles')
        .update({ is_active: !isActive })
        .eq('id', id)

      if (error) {
        toast.error('Failed to update status')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flagged-vehicles'] })
      toast.success('Status updated')
    },
  })

  // Delete flagged vehicle mutation
  const deleteFlaggedVehicle = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('flagged_vehicles')
        .delete()
        .eq('id', id)

      if (error) {
        toast.error('Failed to delete flagged vehicle')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flagged-vehicles'] })
      toast.success('Flagged vehicle removed')
    },
  })

  return {
    flaggedVehicles: query.data,
    isLoading: query.isLoading,
    error: query.error,
    createFlaggedVehicle,
    updateFlaggedVehicle,
    toggleActive,
    deleteFlaggedVehicle,
  }
}

// Hook to check if specific plate is flagged
export function useIsFlagged(plateNumber?: string) {
  const { flaggedVehicles, isLoading } = useFlaggedVehicles({
    plateNumber,
    isActive: true,
  })

  return {
    isFlagged: flaggedVehicles && flaggedVehicles.length > 0,
    flaggedRecord: flaggedVehicles?.[0],
    isLoading,
  }
}

// Hook for active watchlist
export function useActiveWatchlist() {
  return useFlaggedVehicles({ isActive: true })
}
