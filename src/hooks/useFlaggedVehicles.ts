/**
 * Custom Hook: useFlaggedVehicles
 * Watchlist vehicles requiring special attention
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

// Columns match migration 20260415000001_flagged_vehicles_missing_columns.sql
interface FlaggedVehicle {
  id: string
  organization_id: string | null
  plate_number: string
  reason: string | null
  priority: 'low' | 'medium' | 'high' | 'critical' | null
  flagged_by: string | null
  // Columns added by 20260415000001
  notes: string | null
  is_active: boolean
  last_known_site: string | null
  date_recorded: string | null
  vehicle_description: string | null
  name_contact: string | null
  confirmed_homeless: boolean
  created_by: string | null
  attachments: any  // jsonb array [{url, type, label}] — matches database.ts pattern
  created_at: string
  updated_at: string
  flagged_by_user: {
    first_name: string
    last_name: string
  } | null
}

interface CreateFlaggedVehicleInput {
  plate_number: string
  reason?: string
  priority?: 'low' | 'medium' | 'high' | 'critical'
  notes?: string
}

interface UpdateFlaggedVehicleInput {
  reason?: string
  priority?: 'low' | 'medium' | 'high' | 'critical'
  notes?: string
  is_active?: boolean
  last_known_site?: string | null
  name_contact?: string | null
  confirmed_homeless?: boolean
}

export function useFlaggedVehicles(options?: {
  organizationId?: string
  priority?: string
  plateNumber?: string
  activeOnly?: boolean
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
          flagged_by_user:user_profiles(first_name, last_name)
        `)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })

      // Only return active flags by default — is_active added by 20260415000001
      if (options?.activeOnly !== false) {
        query = query.eq('is_active', true)
      }

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
      const { data, error } = await (supabase
        .from('flagged_vehicles') as any)
        .insert({
          organization_id: user?.organization_id,
          flagged_by: user?.id,
          created_by: user?.id,
          plate_number: input.plate_number,
          reason: input.reason,
          priority: input.priority || 'medium',
          notes: input.notes,
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
      const { error } = await (supabase.from('flagged_vehicles') as any)
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

  // Soft-delete: set is_active = false instead of hard delete
  const deleteFlaggedVehicle = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('flagged_vehicles') as any)
        .update({ is_active: false })
        .eq('id', id)

      if (error) {
        toast.error('Failed to remove flagged vehicle')
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
    deleteFlaggedVehicle,
  }
}

// Hook to check if specific plate is flagged (active flags only)
export function useIsFlagged(plateNumber?: string) {
  const { flaggedVehicles, isLoading } = useFlaggedVehicles({
    plateNumber,
    activeOnly: true,
  })

  return {
    isFlagged: flaggedVehicles && flaggedVehicles.length > 0,
    flaggedRecord: flaggedVehicles?.[0],
    isLoading,
  }
}

// Hook for active watchlist (active flags only — default behaviour)
export function useActiveWatchlist() {
  return useFlaggedVehicles({ activeOnly: true })
}

