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
  organization_id: string
  zone_id: string
  user_id: string
  full_name: string
  date_of_birth: string | null
  id_verified: boolean
  homeless_claimed: boolean
  homeless_confirmed: boolean
  homeless_confirmed_by: string | null
  homeless_confirmed_at: string | null
  location_lat: number | null
  location_lng: number | null
  notes: string | null
  attachments: any[]
  recorded_at: string
  created_at: string
  zone: {
    name: string
  }
  recorded_by_user: {
    first_name: string
    last_name: string
  }
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
  zone_id: string
  full_name: string
  date_of_birth?: string
  id_verified?: boolean
  homeless_claimed?: boolean
  location_lat?: number
  location_lng?: number
  notes?: string
  attachments?: any[]
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
  organizationId?: string
  zoneId?: string
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
      let query = supabase
        .from('person_records')
        .select(`
          *,
          zone:zones(name),
          recorded_by_user:user_profiles!person_records_user_id_fkey(first_name, last_name),
          confirmer:user_profiles!person_records_homeless_confirmed_by_fkey(first_name, last_name)
        `)
        .order('recorded_at', { ascending: false })

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
      if (options?.homelessStatus === 'claimed') {
        query = query.eq('homeless_claimed', true)
      } else if (options?.homelessStatus === 'confirmed') {
        query = query.eq('homeless_confirmed', true)
      } else if (options?.homelessStatus === 'none') {
        query = query.eq('homeless_claimed', false).eq('homeless_confirmed', false)
      }
      if (options?.dateFrom) {
        query = query.gte('recorded_at', options.dateFrom)
      }
      if (options?.dateTo) {
        query = query.lte('recorded_at', options.dateTo)
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
          organization_id: user?.organization_id,
          user_id: user?.id,
          zone_id: input.zone_id,
          full_name: input.full_name,
          date_of_birth: input.date_of_birth,
          id_verified: input.id_verified || false,
          homeless_claimed: input.homeless_claimed || false,
          location_lat: input.location_lat,
          location_lng: input.location_lng,
          notes: input.notes,
          attachments: input.attachments || [],
          recorded_at: new Date().toISOString(),
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
      const { error } = await supabase
        .from('person_records')
        .update({
          homeless_confirmed: confirmed,
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
      const { error } = await supabase
        .from('person_records')
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
      const { error } = await supabase
        .from('person_records')
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
          observer:user_profiles!person_observations_observed_by_fkey(first_name, last_name)
        `)
        .eq('person_id', personId)
        .order('observed_at', { ascending: false })

      if (error) {
        toast.error('Failed to load observations')
        throw error
      }

      return data as PersonObservation[]
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
