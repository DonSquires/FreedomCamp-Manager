/**
 * Custom Hook: usePersonRecords
 * Person observation records (non-vehicle freedom campers)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface PersonRecord {
  id: string
  full_name: string
  date_of_birth: string | null
  contact_email: string | null
  contact_phone: string | null
  address: string | null
  homeless_status: string | null
  homeless_confirmed_at: string | null
  homeless_confirmed_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
  confirmer?: {
    first_name: string
    last_name: string
  }
}

interface PersonObservation {
  id: string
  person_id: string
  organization_id: string
  zone_id: string
  observed_by: string
  observed_at: string
  gps_latitude: number | null
  gps_longitude: number | null
  notes: string | null
  attachments: any[]
  created_at: string
}

interface CreatePersonRecordInput {
  full_name: string
  date_of_birth?: string
  contact_email?: string
  contact_phone?: string
  address?: string
  homeless_status?: string
  notes?: string
}

interface CreatePersonObservationInput {
  person_id: string
  zone_id: string
  gps_latitude?: number
  gps_longitude?: number
  notes?: string
  attachments?: any[]
}

export function usePersonRecords(options?: {
  homelessStatus?: 'claimed' | 'confirmed' | 'none'
  dateFrom?: string
  dateTo?: string
}) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Fetch person records
  const query = useQuery({
    queryKey: ['person-records', options],
    queryFn: async () => {
      let query = (supabase
        .from('person_records') as any)
        .select('*')
        .order('created_at', { ascending: false })

      // Filters
      if (options?.homelessStatus === 'confirmed') {
        query = query.not('homeless_confirmed_at', 'is', null)
      } else if (options?.homelessStatus === 'claimed') {
        query = query.eq('homeless_status', 'claimed')
      } else if (options?.homelessStatus === 'none') {
        query = query.is('homeless_status', null)
      }
      if (options?.dateFrom) {
        query = query.gte('created_at', options.dateFrom)
      }
      if (options?.dateTo) {
        query = query.lte('created_at', options.dateTo)
      }

      const { data, error } = await query

      if (error) {
        toast.error('Failed to load person records')
        throw error
      }

      return data as PersonRecord[]
    },
  })

  // Create person record mutation
  const createPersonRecord = useMutation({
    mutationFn: async (input: CreatePersonRecordInput) => {
      const { data, error } = await (supabase
        .from('person_records') as any)
        .insert({
          full_name: input.full_name,
          date_of_birth: input.date_of_birth,
          contact_email: input.contact_email,
          contact_phone: input.contact_phone,
          address: input.address,
          homeless_status: input.homeless_status,
          notes: input.notes,
        })
        .select()
        .single()

      if (error) {
        toast.error('Failed to create person record')
        throw error
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person-records'] })
      toast.success('Person record created')
    },
  })

  // Confirm homeless status mutation
  const confirmHomelessStatus = useMutation({
    mutationFn: async ({ id, confirmed }: { id: string; confirmed: boolean }) => {
      const { error } = await (supabase.from('person_records') as any)
        .update({
          homeless_status: confirmed ? 'confirmed' : null,
          homeless_confirmed_by: confirmed ? user?.id : null,
          homeless_confirmed_at: confirmed ? new Date().toISOString() : null,
        })
        .eq('id', id)

      if (error) {
        toast.error('Failed to update homeless status')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person-records'] })
      toast.success('Homeless status updated')
    },
  })

  // Update person record mutation
  const updatePersonRecord = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PersonRecord> & { id: string }) => {
      const { error } = await (supabase.from('person_records') as any)
        .update(updates)
        .eq('id', id)

      if (error) {
        toast.error('Failed to update person record')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person-records'] })
      toast.success('Person record updated')
    },
  })

  // Delete person record mutation
  const deletePersonRecord = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase
        .from('person_records') as any)
        .delete()
        .eq('id', id)

      if (error) {
        toast.error('Failed to delete person record')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person-records'] })
      toast.success('Person record deleted')
    },
  })

  return {
    persons: query.data,
    isLoading: query.isLoading,
    error: query.error,
    createPersonRecord,
    confirmHomelessStatus,
    updatePersonRecord,
    deletePersonRecord,
  }
}

// Hook for person observations
export function usePersonObservations(personId: string | null) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['person-observations', personId],
    queryFn: async () => {
      if (!personId) return []

      const { data, error } = await supabase
        .from('person_observations')
        .select(`
          *,
          zone:zones(name),
          observer:user_profiles!person_observations_recorded_by_fkey(first_name, last_name)
        `)
        .eq('person_id', personId)
        .order('recorded_at', { ascending: false })

      if (error) {
        toast.error('Failed to load observations')
        throw error
      }

      return data as unknown as PersonObservation[]
    },
    enabled: !!personId,
  })

  // Create observation mutation
  const createObservation = useMutation({
    mutationFn: async (input: CreatePersonObservationInput) => {
      const { data, error } = await (supabase
        .from('person_observations') as any)
        .insert({
          person_id: input.person_id,
          organization_id: user?.organization_id,
          zone_id: input.zone_id,
          observed_by: user?.id,
          observed_at: new Date().toISOString(),
          gps_latitude: input.gps_latitude,
          gps_longitude: input.gps_longitude,
          notes: input.notes,
          attachments: input.attachments || [],
        })
        .select()
        .single()

      if (error) {
        toast.error('Failed to create observation')
        throw error
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person-observations'] })
      toast.success('Observation recorded')
    },
  })

  return {
    observations: query.data,
    isLoading: query.isLoading,
    createObservation,
  }
}

// Hook for homeless persons
export function useHomelessPersons() {
  return usePersonRecords({ homelessStatus: 'confirmed' })
}
