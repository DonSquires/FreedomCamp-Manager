/**
 * Custom Hook: useIncidents
 * Incident CRUD with legal holds and court-ready management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

interface Incident {
  id: string
  organization_id: string
  zone_id: string
  plate_number: string | null
  incident_type: string
  severity: string
  status: string
  description: string
  court_ready: boolean
  retention_hold: boolean
  retention_until: string | null
  approved_by: string | null
  approved_at: string | null
  happened_at: string
  created_at: string
  user_id: string
  photos: string[]
  photo_metadata_ids: string[]
}

interface CreateIncidentInput {
  zone_id: string
  plate_number?: string
  incident_type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  happened_at?: string
  photos?: string[]
  photo_metadata_ids?: string[]
  gps_latitude?: number
  gps_longitude?: number
}

interface UpdateIncidentInput {
  status?: string
  resolution_notes?: string
  court_ready?: boolean
  retention_hold?: boolean
}

export function useIncidents(options?: {
  organizationId?: string
  zoneId?: string
  severity?: string
  status?: string
  dateFrom?: string
  dateTo?: string
}) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Fetch incidents
  const query = useQuery({
    queryKey: ['incidents', options],
    queryFn: async () => {
      let query = supabase
        .from('incidents')
        .select(`
          id,
          organization_id,
          zone_id,
          plate_number,
          incident_type,
          severity,
          status,
          description,
          court_ready,
          retention_hold,
          retention_until,
          approved_by,
          approved_at,
          happened_at,
          created_at,
          user_id,
          photos,
          photo_metadata_ids,
          zone:zones(name),
          user_profile:user_profiles(first_name, last_name)
        `)
        .is('deleted_at', null)
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
      if (options?.severity) {
        query = query.eq('severity', options.severity)
      }
      if (options?.status) {
        query = query.eq('status', options.status)
      }
      if (options?.dateFrom) {
        query = query.gte('happened_at', options.dateFrom)
      }
      if (options?.dateTo) {
        query = query.lte('happened_at', options.dateTo)
      }

      const { data, error } = await query

      if (error) {
        toast.error('Failed to load incidents')
        throw error
      }

      return data as Incident[]
    },
  })

  // Create incident mutation
  const createIncident = useMutation({
    mutationFn: async (input: CreateIncidentInput) => {
      const { data, error } = await (supabase
        .from('incidents') as any)
        .insert({
          organization_id: user?.organization_id,
          user_id: user?.id,
          zone_id: input.zone_id,
          plate_number: input.plate_number,
          incident_type: input.incident_type,
          severity: input.severity,
          description: input.description,
          happened_at: input.happened_at || new Date().toISOString(),
          photos: input.photos || [],
          photo_metadata_ids: input.photo_metadata_ids || [],
          gps_latitude: input.gps_latitude,
          gps_longitude: input.gps_longitude,
          status: 'pending',
        })
        .select()
        .single()

      if (error) {
        toast.error('Failed to create incident')
        throw error
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success('Incident created successfully')
    },
  })

  // Update incident mutation
  const updateIncident = useMutation({
    mutationFn: async ({ id, ...updates }: UpdateIncidentInput & { id: string }) => {
      const { error } = await (supabase.from('incidents') as any)
        .update(updates)
        .eq('id', id)

      if (error) {
        toast.error('Failed to update incident')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success('Incident updated successfully')
    },
  })

  // Set legal hold mutation
  const setLegalHold = useMutation({
    mutationFn: async ({ id, enable }: { id: string; enable: boolean }) => {
      const retentionDate = enable
        ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
        : null

      const { error } = await (supabase.from('incidents') as any)
        .update({
          retention_hold: enable,
          retention_until: retentionDate,
        })
        .eq('id', id)

      if (error) {
        toast.error('Failed to update legal hold')
        throw error
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success(variables.enable ? 'Legal hold enabled' : 'Legal hold removed')
    },
  })

  // Mark court ready mutation
  const markCourtReady = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('incidents') as any)
        .update({
          court_ready: true,
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (error) {
        toast.error('Failed to mark as court-ready')
        throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] })
      toast.success('Marked as court-ready')
    },
  })

  return {
    incidents: query.data,
    isLoading: query.isLoading,
    error: query.error,
    createIncident,
    updateIncident,
    setLegalHold,
    markCourtReady,
  }
}

// Hook for single incident
export function useIncident(id: string | null) {
  return useQuery({
    queryKey: ['incident', id],
    queryFn: async () => {
      if (!id) return null

      const { data, error } = await supabase
        .from('incidents')
        .select(`
          *,
          zone:zones(name),
          user_profile:user_profiles(first_name, last_name),
          incident_attachments(*)
        `)
        .eq('id', id)
        .single()

      if (error) {
        toast.error('Failed to load incident')
        throw error
      }

      return data
    },
    enabled: !!id,
  })
}
